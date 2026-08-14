import { PublicKey } from '@solana/web3.js';

export const LORDSPOT_PROGRAM_ID = new PublicKey(import.meta.env.VITE_LORDSPOT_PROGRAM_ID);
export const USDC_MINT = new PublicKey(import.meta.env.VITE_USDC_MINT);

export const HELIUS_RPC_URL = `https://devnet.helius-rpc.com/?api-key=${import.meta.env.VITE_HELIUS_API_KEY}`;

/** Mirrors `buy_ticket`'s on-chain constraints exactly (lib.rs) — validate client-side before ever building a tx. */
export const TICKET_RULES = {
  NORMALS_PER_TICKET: 5,
  MAX_TICKETS_PER_TX: 100,
} as const;

export const USDC_DECIMALS = 6;

/**
 * Client-side relay fee — covers the real Base-network gas the relayer wallet
 * pays to forward each purchase to Megapot. Not enforced on-chain (the
 * program only cares about ticket_price); sized off real observed relay gas
 * (~$0.02 for 1 ticket, ~$0.11 for 10) with ~50% margin so it never runs at
 * a loss, structured as base + per-ticket rather than flat since the real
 * cost scales with ticket count too.
 */
export const RELAY_FEE_BASE_USDC = 15_000;
export const RELAY_FEE_PER_TICKET_USDC = 15_000;
