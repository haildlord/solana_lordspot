import { prisma } from '../lib/db';
import { solanaService } from '../services/solanaService';
import { onShutdown } from '../lib/shutdown';

/**
 * The PAYOUT CONFIRMER — resolves issued claim vouchers using only the chain.
 *
 * Because the admin is the voucher's fee payer, the transaction signature is
 * known AT ISSUANCE (it's the admin's own signature). So this loop never
 * trusts a frontend callback: it polls getSignatureStatuses directly.
 *
 *   landed, no error → CONFIRMED, bound tickets → PAID_OUT_ON_SOLANA
 *   landed, errored  → FAILED, tickets released (claimable again)
 *   never landed and the block height passed lastValidBlockHeight + buffer
 *                    → EXPIRED, tickets released
 *
 * This is the OTHER half of the one-live-voucher rule: the claims route
 * refuses to issue a new voucher while one is PENDING; this loop is what
 * moves vouchers out of PENDING. Releases are safe because a voucher past
 * expiry can NEVER land later — Solana rejects transactions whose blockhash
 * has expired, permanently.
 */

const POLL_MS = 10_000;
// Extra confirmation depth past lastValidBlockHeight before declaring death —
// covers RPC nodes that are slightly behind the tip.
const EXPIRY_BUFFER_BLOCKS = 150n;
// A PENDING row with no signature means the route crashed mid-issuance;
// nothing was ever handed out, so release after a short grace period.
const UNSIGNED_GRACE_MS = 2 * 60_000;

async function confirmClaim(claimId: string, txSignature: string): Promise<void> {
  await prisma.$transaction([
    prisma.ticket.updateMany({
      where: { payoutClaimId: claimId, winStatus: 'CLAIMED_ON_BASE' },
      data: { winStatus: 'PAID_OUT_ON_SOLANA' },
    }),
    prisma.payoutClaim.update({
      where: { id: claimId },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), error: null },
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
  
  const pending = await prisma.payoutClaim.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  if (pending.length === 0) return;

  const connection = solanaService.getConnection();

  const signed = pending.filter((c) => c.txSignature !== null);

  const statuses = signed.length
    ? await connection.getSignatureStatuses(
        signed.map((c) => c.txSignature as string),
        { searchTransactionHistory: true }
      )
    : { value: [] as (null | { err: unknown; confirmationStatus?: string })[] };

  const currentHeight = BigInt(await connection.getBlockHeight('confirmed'));

  for (const claim of pending) {
    
    try {
      if (!claim.txSignature) {
        if (Date.now() - claim.createdAt.getTime() > UNSIGNED_GRACE_MS) { // * UNSIGNED_GRACE_MS : 2 Mins
          await releaseClaim(claim.id, 'EXPIRED', 'Voucher issuance crashed before signing — nothing was handed out');
        }
        continue;
      }

      const status = statuses.value[signed.findIndex((c) => c.id === claim.id)];

      if (status && status.err == null) {
        await confirmClaim(claim.id, claim.txSignature);
        continue;
      }

      if (status && status.err != null) {
        // Landed but errored (e.g. paused mid-flight, vault refill needed).
        // Funds did NOT move — safe to release for a fresh voucher.
        await releaseClaim(claim.id, 'FAILED', `Claim tx errored on-chain: ${JSON.stringify(status.err).slice(0, 500)}`);
        continue;
      }

      // Not found on-chain. Dead only once expiry is provably behind us.
      if (
        claim.lastValidBlockHeight !== null &&
        currentHeight > claim.lastValidBlockHeight + EXPIRY_BUFFER_BLOCKS
      ) {
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
