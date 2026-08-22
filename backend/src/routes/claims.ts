import { Router, Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import { prisma } from '../lib/db';
import { solanaService } from '../services/solanaService';
import { megapotService } from '../services/megapotService';

/**
 * Claim voucher API — the trusted half of the two-signature claim.
 *
 * SECURITY CONTRACT (mirrors the program's docs — the on-chain checks are
 * only as good as what this endpoint agrees to sign):
 *   1. `amount` is derived EXCLUSIVELY from our DB (sum of the wallet's
 *      CLAIMED_ON_BASE winnings). Nothing from the request body ever reaches
 *      the voucher except the wallet address itself.
 *
 * v1/v2 note: free-tier wins (isFreeTicketTier) are paid out as cash here for
 * now, same as any other winning ticket — the "redeem as a new ticket"
 * product flow is unbuilt, so there's nothing to gate them behind yet.
 * isFreeTicketTier itself is left untouched on the row (still set at
 * settlement) so a v2 redemption flow can pick these back out later without
 * re-deriving which wins were originally free-tier.
 *   2. ONE LIVE VOUCHER PER WALLET: while a PENDING voucher exists, the same
 *      voucher is returned (idempotent) — never a second one. This is what
 *      makes double-payment impossible and makes the endpoint grief-proof:
 *      requesting a voucher for someone else's wallet yields a transaction
 *      only THAT wallet can sign. No auth needed for correctness.
 *   3. Tickets are BOUND to the voucher row before signing (guarded update),
 *      so winnings harvested after issuance wait for the next voucher.
 *   4. The payout confirmer (chain-derived) is the only thing that moves a
 *      voucher out of PENDING — this route never guesses at chain state.
 */

const router = Router();

function parseWallet(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    return new PublicKey(raw).toBase58();
  } catch {
    return null;
  }
}

/** Wallet's live claimable position — powers the "Winnings $X / Free tickets N" UI. */
router.get('/summary', async (req: Request, res: Response) => {
  const wallet = parseWallet(req.query.wallet);
  if (!wallet) return res.status(400).json({ error: 'Invalid or missing wallet' });

  // New winnings stay invisible until their epoch's real ended_at + 10min has
  // passed, same gate as Results/Tickets — even if settlement+harvest already
  // finished. Historical PAID_OUT_ON_SOLANA totals aren't gated: claiming
  // itself requires seeing a claimable amount first, which is gated below, so
  // nothing can reach paid-out before the gate has already passed anyway.
  const revealedEpochIds = [...(await megapotService.getRevealedEpochIds())];

  const [cash, freeTickets, pendingVoucher, paidOut] = await Promise.all([
    // v1 stopgap: free-tier wins are included here (paid as cash) alongside
    // cash-tier wins — see the file-header note. freeTickets below is now
    // purely informational (these tickets are already counted in this sum).
    prisma.ticket.aggregate({
      _sum: { winAmount: true },
      where: {
        winStatus: 'CLAIMED_ON_BASE',
        payoutClaimId: null,
        relayOrder: { buyer: wallet, fulfillEpoch: { in: revealedEpochIds } },
      },
    }),
    prisma.ticket.count({
      where: {
        winStatus: 'CLAIMED_ON_BASE',
        isFreeTicketTier: true,
        relayOrder: { buyer: wallet, fulfillEpoch: { in: revealedEpochIds } },
      },
    }),
    prisma.payoutClaim.findFirst({
      where: { wallet, status: 'PENDING' },
      // No txSignature here: the user is the fee payer, so a PENDING voucher
      // has no signature yet — the confirmer discovers and stamps it only once
      // the transaction actually lands.
      select: { id: true, amountUsdc: true, createdAt: true },
    }),
    prisma.ticket.aggregate({
      _sum: { winAmount: true },
      where: { winStatus: 'PAID_OUT_ON_SOLANA', relayOrder: { buyer: wallet } },
    }),
  ]);

  return res.json({
    claimableUsdc: (cash._sum.winAmount ?? 0n).toString(),
    freeTickets,
    totalPaidOutUsdc: (paidOut._sum.winAmount ?? 0n).toString(),
    pendingVoucher: pendingVoucher
      ? {
          amountUsdc: pendingVoucher.amountUsdc.toString(),
          createdAt: pendingVoucher.createdAt,
        }
      : null,
  });
});

/** Issue (or idempotently re-serve) the wallet's claim voucher. */
router.post('/voucher', async (req: Request, res: Response) => {
  const wallet = parseWallet(req.body?.wallet);
  if (!wallet) return res.status(400).json({ error: 'Invalid or missing wallet' });

  // Courtesy gate — the program enforces this too, but a friendly 503 beats
  // an on-chain revert during the daily rollover window.
  if (await megapotService.isProtocolPaused()) {
    return res.status(503).json({ error: 'Claims are briefly paused during the epoch transition — retry shortly' });
  }

  // ONE LIVE VOUCHER: an unresolved PENDING voucher is returned as-is. Only
  // the confirmer retires it (CONFIRMED / EXPIRED / FAILED) — never this route.
  //
  // Keyed on lastValidBlockHeight, NOT txSignature: the user is the voucher's
  // fee payer now, so no signature exists at issuance (it is discovered later
  // by the confirmer). lastValidBlockHeight is what gets stamped the moment a
  // voucher is actually handed out, making it the correct "this one is live"
  // marker. Keying on txSignature here would match nothing and mint a second
  // live voucher per request — two independently-landable payouts for the same
  // tickets, since claim_winnings has no on-chain replay guard of its own.
  const existing = await prisma.payoutClaim.findFirst({
    where: { wallet, status: 'PENDING', lastValidBlockHeight: { not: null } },
  });

  if (existing) {
    return res.status(200).json({
      reused: true,
      claimId: existing.id,
      amountUsdc: existing.amountUsdc.toString(),
      note: 'A live voucher already exists — sign and submit the one you were given, or wait ~1 min for it to expire.',
    });
  }

  // Same reveal gate as /summary — a ticket from a not-yet-revealed epoch must
  // not become claimable here just because a user hits this endpoint directly;
  // otherwise the amount shown on /summary and what's actually claimable could
  // disagree.
  const revealedEpochIds = [...(await megapotService.getRevealedEpochIds())];

  // Create the claim row FIRST, then bind tickets with a guarded update —
  // concurrency-safe: two racing requests cannot bind the same ticket twice.
  const claim = await prisma.payoutClaim.create({ data: { wallet } });

  // v1 stopgap: bind free-tier wins into the voucher too — see file-header note.
  await prisma.ticket.updateMany({
    where: {
      winStatus: 'CLAIMED_ON_BASE',
      payoutClaimId: null,
      relayOrder: { buyer: wallet, fulfillEpoch: { in: revealedEpochIds } },
    },
    data: { payoutClaimId: claim.id },
  });

  const bound = await prisma.ticket.aggregate({
    _sum: { winAmount: true },
    where: { payoutClaimId: claim.id },
  });
  const amount = bound._sum.winAmount ?? 0n;

  if (amount <= 0n) {
    await prisma.payoutClaim.delete({ where: { id: claim.id } });
    return res.status(404).json({ error: 'Nothing to claim for this wallet' });
  }

  // PLAUSIBILITY CEILING — the last check before this service co-signs a
  // transfer of real funds.
  //
  // Everything upstream of here is trusted arithmetic: Megapot's prize-tier
  // payload → settlement's tier math → winAmount → this sum. A bad number
  // anywhere in that chain arrives looking exactly like a good one, and the
  // program would pay it out in good faith (its only other guard is vault
  // solvency, i.e. "can we afford it", not "is it sane"). The on-chain
  // max_claim_amount is the real enforcement; this mirrors it so the failure
  // surfaces as a logged alert and a clean 409 instead of an opaque revert.
  try {
    const onChain = await solanaService.getOnChainState();
    const ceiling = BigInt(onChain.maxClaimAmount.toString());

    if (amount > ceiling) {
      await prisma.ticket.updateMany({
        where: { payoutClaimId: claim.id },
        data: { payoutClaimId: null },
      });
      await prisma.payoutClaim.delete({ where: { id: claim.id } });

      console.error(
        `[ALERT][claims] Refused to sign an implausible payout for ${wallet}: ${amount} units exceeds the on-chain ceiling of ${ceiling}. ` +
        `This is a settlement/pricing bug, NOT a user action — the amount is derived entirely from our own DB. Investigate before raising the ceiling.`
      );
      return res.status(409).json({
        error: 'Claim amount exceeds the protocol payout ceiling — this has been flagged for review, please contact support.',
      });
    }
  } catch (err: any) {
    console.error('[claims] Could not read on-chain claim ceiling:', err?.message ?? err);
    await prisma.ticket.updateMany({
      where: { payoutClaimId: claim.id },
      data: { payoutClaimId: null },
    });
    await prisma.payoutClaim.delete({ where: { id: claim.id } });
    // Fail closed: unable to verify the ceiling means unable to justify signing.
    return res.status(503).json({ error: 'Unable to verify payout limits right now — try again shortly' });
  }

  try {
    const voucher = await solanaService.buildClaimVoucher(wallet, amount);

    await prisma.payoutClaim.update({
      where: { id: claim.id },
      data: {
        amountUsdc: amount,
        lastValidBlockHeight: BigInt(voucher.lastValidBlockHeight),
      },
    });

    console.log(`[claims] Voucher issued: ${wallet.slice(0, 8)}… → ${amount} units (valid to block ${voucher.lastValidBlockHeight})`);

    return res.status(201).json({
      reused: false,
      claimId: claim.id,
      amountUsdc: amount.toString(),
      transactionBase64: voucher.transactionBase64,
      lastValidBlockHeight: voucher.lastValidBlockHeight,
      note: 'Counter-sign with the winner wallet and submit within ~60s. The winner wallet pays the network fee.',
    });
  } catch (err: any) {
    // Signing failed — release everything immediately; nothing was handed out.
    await prisma.ticket.updateMany({
      where: { payoutClaimId: claim.id },
      data: { payoutClaimId: null },
    });
    await prisma.payoutClaim.delete({ where: { id: claim.id } });
    console.error('[claims] Voucher build failed:', err?.message ?? err);
    return res.status(500).json({ error: 'Failed to build claim voucher — try again' });
  }
});

export default router;
