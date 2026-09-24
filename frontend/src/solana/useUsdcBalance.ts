import { useQuery } from '@tanstack/react-query';
import type { PublicKey } from '@solana/web3.js';
import { readonlyConnection } from './program';
import { getUserUsdcAta } from './pdas';

/**
 * The connected wallet's USDC balance, in base units (6 decimals), read straight
 * from its associated token account.
 *
 * Returns 0n — not an error — when the ATA doesn't exist yet. A wallet that has
 * never held this USDC simply has no account, which is a legitimate "you have
 * nothing" rather than a failure, and it must not surface as a broken UI.
 *
 * Purely advisory: it decides whether the Buy button is enabled and what the UI
 * explains. The transfer inside buy_ticket is what actually enforces solvency,
 * so a stale balance here can never let an unaffordable purchase through — it
 * would just revert on-chain, exactly as it did before this existed.
 */
async function fetchUsdcBalance(owner: PublicKey): Promise<bigint> {
  const ata = getUserUsdcAta(owner);
  try {
    const res = await readonlyConnection.getTokenAccountBalance(ata);
    return BigInt(res.value.amount);
  } catch {
    // No ATA (or RPC hiccup) → treat as zero balance rather than failing the
    // query, so the button just stays disabled with a clear reason.
    return 0n;
  }
}

export function useUsdcBalance(owner: PublicKey | null | undefined) {
  return useQuery({
    queryKey: ['usdc-balance', owner?.toBase58() ?? null],
    queryFn: () => fetchUsdcBalance(owner!),
    enabled: !!owner,
    // Balance changes the moment a purchase lands, so keep this fresher than
    // the protocol state poll.
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}
