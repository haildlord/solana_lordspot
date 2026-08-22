import { PublicKey } from '@solana/web3.js';

export const LORDSPOT_PROGRAM_ID = new PublicKey(import.meta.env.VITE_LORDSPOT_PROGRAM_ID);
export const USDC_MINT = new PublicKey(import.meta.env.VITE_USDC_MINT);

export const HELIUS_RPC_URL = `https://devnet.helius-rpc.com/?api-key=${import.meta.env.VITE_HELIUS_API_KEY}`;

/** Mirrors `buy_ticket`'s on-chain constraints exactly (lib.rs) — validate client-side before ever building a tx. */
export const TICKET_RULES = {
  NORMALS_PER_TICKET: 5,
  MAX_TICKETS_PER_TX: 100,
  /**
   * Must equal the on-chain `max_tickets_per_purchase`. Exceeding it reverts
   * with ExceedsMaxTicketsPerPurchase.
   *
   * Set by SOLANA'S TRANSACTION SIZE LIMIT, not by anything on Base. Measured
   * against real transactions: each ticket costs 10 bytes, and a bare
   * buy_ticket transaction hits Solana's 1232-byte packet ceiling at 75-78
   * tickets (70 once compute-budget instructions are added). 65 leaves real
   * headroom on that ceiling.
   *
   * This deliberately does NOT match the backend's Base chunk size any more.
   * The two limits answer different questions — how much fits in a Solana
   * transaction vs how much fits in a Base transaction — and the relayer
   * re-chunks independently, so tying them together only shrank what users
   * could buy for no benefit.
   */
  MAX_TICKETS_PER_IX: 65,
} as const;

export const USDC_DECIMALS = 6;

/**
 * Relay fee — DELIBERATELY ZERO.
 *
 * LordsPot is Megapot's referrer, earning ~10% of every $1 ticket plus a share
 * of winnings. Against ~$0.01 of Base gas per relayed ticket, that revenue is
 * roughly 10x the cost of doing the relay. Charging users a fee on top would
 * suppress the very volume that actually pays for the protocol — so it's set to
 * zero and the whole purchase is free beyond the ticket price itself.
 *
 * ENFORCED ON-CHAIN (LordsPotState.relay_fee_base / relay_fee_per_ticket).
 * These constants only quote the user; the program is the authority. The fee
 * MECHANISM is kept intact, not deleted: `set_relay_config` can raise it
 * without a redeploy if Base gas ever spikes past the break-even point
 * (~0.06 gwei, about 10x normal). If that happens, update these to match, or
 * the UI will quote less than the program charges and transactions will revert.
 */
export const RELAY_FEE_BASE_USDC = 0;
export const RELAY_FEE_PER_TICKET_USDC = 0;

/** Total relay fee for a purchase, matching the program's per-instruction charge exactly. */
export function calculateRelayFee(ticketCount: number): number {
  if (ticketCount <= 0) return 0;
  const instructions = Math.ceil(ticketCount / TICKET_RULES.MAX_TICKETS_PER_IX);
  return RELAY_FEE_BASE_USDC * instructions + RELAY_FEE_PER_TICKET_USDC * ticketCount;
}
