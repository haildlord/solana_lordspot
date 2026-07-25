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
 *      CLAIMED_ON_BASE, non-free-ticket winnings). Nothing from the request
 *      body ever reaches the voucher except the wallet address itself.
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

  const [cash, freeTickets, pendingVoucher, paidOut] = await Promise.all([
    prisma.ticket.aggregate({
      _sum: { winAmount: true },
      where: {
        winStatus: 'CLAIMED_ON_BASE',
        isFreeTicketTier: false,
        payoutClaimId: null,
        relayOrder: { buyer: wallet },
      },
    }),
    prisma.ticket.count({
      where: {
        winStatus: 'CLAIMED_ON_BASE',
        isFreeTicketTier: true,
        relayOrder: { buyer: wallet },
      },
    }),
    prisma.payoutClaim.findFirst({
      where: { wallet, status: 'PENDING' },
      select: { id: true, amountUsdc: true, txSignature: true, createdAt: true },
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
          txSignature: pendingVoucher.txSignature,
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
  const existing = await prisma.payoutClaim.findFirst({
    where: { wallet, status: 'PENDING', txSignature: { not: null } },
  });
  
  if (existing) {
    return res.status(200).json({
      reused: true,
      claimId: existing.id,
      amountUsdc: existing.amountUsdc.toString(),
      txSignature: existing.txSignature,
      note: 'A live voucher already exists — sign and submit this one, or wait ~1 min for it to expire.',
    });
  }

  // Create the claim row FIRST, then bind tickets with a guarded update —
  // concurrency-safe: two racing requests cannot bind the same ticket twice.
  const claim = await prisma.payoutClaim.create({ data: { wallet } });

  await prisma.ticket.updateMany({
    where: {
      winStatus: 'CLAIMED_ON_BASE',
      isFreeTicketTier: false,
      payoutClaimId: null,
      relayOrder: { buyer: wallet },
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

  try {
    const voucher = await solanaService.buildClaimVoucher(wallet, amount);

    await prisma.payoutClaim.update({
      where: { id: claim.id },
      data: {
        amountUsdc: amount,
        txSignature: voucher.txSignature,
        lastValidBlockHeight: BigInt(voucher.lastValidBlockHeight),
      },
    });

    console.log(`[claims] Voucher issued: ${wallet.slice(0, 8)}… → ${amount} units, sig ${voucher.txSignature.slice(0, 12)}…`);

    return res.status(201).json({
      reused: false,
      claimId: claim.id,
      amountUsdc: amount.toString(),
      transactionBase64: voucher.transactionBase64,
      txSignature: voucher.txSignature,
      lastValidBlockHeight: voucher.lastValidBlockHeight,
      note: 'Counter-sign with the winner wallet and submit within ~60s.',
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
