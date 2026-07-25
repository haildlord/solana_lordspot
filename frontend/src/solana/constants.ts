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
