import { prisma } from '../lib/db';
import { solanaService } from '../services/solanaService';
import { onShutdown } from '../lib/shutdown';

/**
 * The PAYOUT CONFIRMER — resolves issued claim vouchers using only the chain.
 *
 * The user is the voucher's fee payer (so the protocol spends nothing on
 * claims), which means the transaction signature does NOT exist at issuance —
 * on Solana the tx signature IS the fee payer's signature. So this loop cannot
 * poll a known signature. Instead it DISCOVERS landed claims by walking the
 * admin key's signature history: the program requires the admin co-signature on
 * every claim_winnings, so that history is a complete record of every claim
 * that can possibly exist. A frontend that lies, or never calls back at all,
 * changes nothing here.
 *
 *   found, no error → CONFIRMED, bound tickets → PAID_OUT_ON_SOLANA
 *   found, errored  → FAILED, tickets released (funds never moved)
 *   not found and the block height passed lastValidBlockHeight + buffer
 *                   → EXPIRED, tickets released
 *
 * THE ONE FAILURE THIS MUST NOT HAVE is a false expiry: declaring a voucher
 * dead whose transaction actually landed would release its tickets to be
 * claimed a second time — a double payment. Three things prevent it:
 *
 *   1. The scan is bounded BY TIME, not by a cursor. It always walks back to
 *      the oldest live voucher's creation instant, so every transaction that
 *      could still belong to a pending voucher is necessarily inside the
 *      window. There is no watermark to go stale, and nothing to resume from
 *      incorrectly — the bound is recomputed from the pending set every tick.
 *   2. EVERY pending voucher is examined each tick, never a capped page.
 *   3. A FAILED SCAN EXPIRES NOTHING. If the RPC walk throws, the tick returns
 *      without touching a single row. "I didn't see it" and "it isn't there"
 *      are never conflated.
 *
 * Releases remain safe because a voucher past expiry can NEVER land later —
 * Solana rejects transactions whose blockhash has expired, permanently.
 */

const POLL_MS = 10_000;
// Extra confirmation depth past lastValidBlockHeight before declaring death —
// covers RPC nodes that are slightly behind the tip.
const EXPIRY_BUFFER_BLOCKS = 150n;
// A PENDING row with no lastValidBlockHeight means the route crashed
// mid-issuance; nothing was ever handed out, so release after a grace period.
const UNSIGNED_GRACE_MS = 2 * 60_000;
// Tolerance when comparing a claim's createdAt against a transaction's
// blockTime — validator clocks drift, and the two are recorded by different
// machines. Only used to reject clearly-older transactions (see below).
const CLOCK_SKEW_MS = 60_000;

async function confirmClaim(claimId: string, txSignature: string): Promise<void> {
  await prisma.$transaction([
    prisma.ticket.updateMany({
      where: { payoutClaimId: claimId, winStatus: 'CLAIMED_ON_BASE' },
      data: { winStatus: 'PAID_OUT_ON_SOLANA' },
    }),
    prisma.payoutClaim.update({
      where: { id: claimId },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), txSignature, error: null },
    }),
  ]);
  console.log(`[payout] ✅ Claim ${claimId} confirmed on-chain — ${txSignature}`);
}

async function releaseClaim(claimId: string, status: 'EXPIRED' | 'FAILED', reason: string): Promise<void> {
  await prisma.$transaction([
    prisma.ticket.updateMany({
      where: { payoutClaimId: claimId },
      data: { payoutClaimId: null }, // tickets become claimable in a fresh voucher
    }),
    prisma.payoutClaim.update({
      where: { id: claimId },
      data: { status, error: reason.slice(0, 2000) },
    }),
  ]);
  console.warn(`[payout] Claim ${claimId} → ${status}: ${reason.slice(0, 200)}`);
}

export async function runPayoutConfirmerTick(): Promise<void> {

  // NO `take` LIMIT — deliberately. The scan window below is derived from the
  // OLDEST pending voucher, so examining only a page of them would compute a
  // bound from rows it then ignores. The set is naturally small: vouchers live
  // ~60s.
  const pending = await prisma.payoutClaim.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  });

  if (pending.length === 0) return;

  const connection = solanaService.getConnection();

  // The completeness bound: the oldest live voucher's creation, minus clock
  // skew. A claim transaction cannot predate the voucher that authorized it,
  // so nothing older than this can belong to anything still pending. Ordering
  // is `createdAt: asc`, so pending[0] is the oldest.
  const notBeforeUnixTime = Math.floor((pending[0].createdAt.getTime() - CLOCK_SKEW_MS) / 1000);

  // ---- Chain sweep. If this throws, we resolve NOTHING this tick. ----
  let landed: Awaited<ReturnType<typeof solanaService.findLandedClaims>>;
  try {
    landed = await solanaService.findLandedClaims(notBeforeUnixTime);
  } catch (err) {
    // Deliberately bail out entirely rather than fall through to the expiry
    // branch below — an unscanned chain must never be read as an empty one.
    console.error('[payout] Chain sweep failed — resolving nothing this tick:', err);
    return;
  }

  // An incomplete sweep can still CONFIRM (finding a claim proves it landed),
  // but it must never EXPIRE — "I didn't finish looking" is not evidence of
  // absence, and acting on it would release tickets whose payout may already
  // have gone out. Vouchers simply stay PENDING until a sweep completes.
  if (!landed.complete) {
    console.error(
      '[ALERT][payout] Chain sweep hit its page ceiling before covering the full voucher window. ' +
      'Confirming only; no voucher will be expired this tick. If this repeats, the admin key has more ' +
      'traffic than the sweep can walk — raise MAX_PAGES in findLandedClaims or shorten the backlog.'
    );
  }

  // Group ALL of a wallet's landed claims, oldest-first — not just the newest.
  //
  // Keeping only the newest was a latent double-payment bug: if a wallet ever
  // had two claims of the SAME amount, both PayoutClaim rows would match that
  // one transaction. PayoutClaim.txSignature is @unique, so the second confirm
  // would throw, retry forever, then expire — releasing tickets that had in
  // fact already been paid, letting them be claimed a second time. Every
  // landed transaction is now consumed by AT MOST ONE claim row.
  const byWallet = new Map<string, (typeof landed.claims)[number][]>();
  for (const c of landed.claims) {
    const list = byWallet.get(c.wallet) ?? [];
    list.push(c);
    byWallet.set(c.wallet, list);
  }
  for (const list of byWallet.values()) list.sort((a, b) => a.slot - b.slot);

  // Signatures already spoken for — either by a claim resolved on an earlier
  // tick, or by an earlier claim in this same loop.
  const alreadyUsed = new Set(
    (
      await prisma.payoutClaim.findMany({
        where: { txSignature: { not: null } },
        select: { txSignature: true },
      })
    ).map((c) => c.txSignature as string)
  );

  const currentHeight = BigInt(await connection.getBlockHeight('confirmed'));

  for (const claim of pending) {

    try {
      // Find the oldest landed transaction that could belong to THIS voucher
      // and has not already been attributed to another one.
      const hit = (byWallet.get(claim.wallet) ?? []).find((c) => {
        // Never attribute one transaction to two claims — see alreadyUsed above.
        if (alreadyUsed.has(c.signature)) return false;

        // A transaction older than the voucher itself belongs to a PREVIOUS
        // claim by the same wallet — the same wallet claiming twice, possibly
        // for the very same amount. Matching it would confirm a voucher that
        // never landed AND mark its tickets paid with no money having moved.
        const isAfterIssuance =
          c.blockTime == null ||
          c.blockTime * 1000 >= claim.createdAt.getTime() - CLOCK_SKEW_MS;

        // Cross-check the exact amount this voucher was issued for. Also
        // naturally excludes a half-built row (amountUsdc still at its 0
        // default), since the program rejects a zero-amount claim outright.
        return isAfterIssuance && c.amount === claim.amountUsdc;
      });

      if (hit) {
        // Claim the signature immediately so no later iteration reuses it.
        alreadyUsed.add(hit.signature);
        if (hit.failed) {
          // Landed but errored (e.g. paused mid-flight, vault refill needed).
          // Funds did NOT move — safe to release for a fresh voucher.
          await releaseClaim(claim.id, 'FAILED', `Claim tx errored on-chain: ${hit.signature}`);
        } else {
          await confirmClaim(claim.id, hit.signature);
        }
        continue;
      }

      // Never handed out (route crashed before the voucher was built). Safe to
      // release regardless of scan completeness: no transaction was ever
      // produced, so there is nothing on chain that could have landed.
      if (claim.lastValidBlockHeight === null) {
        if (Date.now() - claim.createdAt.getTime() > UNSIGNED_GRACE_MS) { // * UNSIGNED_GRACE_MS : 2 Mins
          await releaseClaim(claim.id, 'EXPIRED', 'Voucher issuance crashed before signing — nothing was handed out');
        }
        continue;
      }

      if (!landed.complete) continue; // see the alert above — confirm-only tick

      // Not on-chain. Dead only once expiry is provably behind us — at which
      // point the transaction can never land, so releasing its tickets cannot
      // double-pay.
      if (currentHeight > claim.lastValidBlockHeight + EXPIRY_BUFFER_BLOCKS) {
        await releaseClaim(claim.id, 'EXPIRED', 'Voucher expired unused (blockhash passed lastValidBlockHeight)');
      }
      // else: still inside its validity window — user may yet submit. Wait.
    } catch (err) {
      console.error(`[payout] Error resolving claim ${claim.id}:`, err);
    }
  }
}

let intervalHandle: NodeJS.Timeout | null = null;
let tickInFlight = false;

export function startPayoutConfirmer(): void {
  if (intervalHandle) return; // singleton per process

  intervalHandle = setInterval(() => {
    if (tickInFlight) return;
    tickInFlight = true;
    runPayoutConfirmerTick()
      .catch((err) => console.error('[payout] Tick failed:', err))
      .finally(() => { tickInFlight = false; });
  }, POLL_MS); // * 10 Secs

  onShutdown('payout-confirmer', () => {
    if (intervalHandle) clearInterval(intervalHandle);
  });

  console.log(`[payout] Claim voucher confirmer online (every ${POLL_MS / 1000}s)`);
}
