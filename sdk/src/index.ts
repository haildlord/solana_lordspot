import { Connection, PublicKey } from '@solana/web3.js';
import { getTickets as apiGetTickets, getClaimSummary, type ClaimSummary, type TicketRecord } from './api';
import { buyTickets as buyTicketsImpl, type BuyTicketsOptions, type BuyTicketsResult } from './buy';
import { claimWinnings as claimWinningsImpl, type ClaimResult } from './claim';
import { resolveConfig, type LordsPotConfigInput, type LordsPotNetwork } from './config';
import { createNetworkGuard } from './networkGuard';
import { calculateTotalCost, fetchProtocolState, type ProtocolState } from './protocol';
import type { LordsPotSigner } from './signer';
import { quickPick, type Ticket, type TicketRules } from './ticket';

export { LordsPotError, VoucherVerificationError, type LordsPotErrorCode } from './errors';
export { keypairSigner, type LordsPotSigner } from './signer';
export { quickPick, validateTicket, type Ticket, type TicketRules } from './ticket';
export { getTicketMatch, isRevealed, timeUntilDraw, type TicketMatch } from './reveal';
export type { ProtocolState } from './protocol';
export type { ClaimSummary, TicketRecord, WinStatus } from './api';
export type { BuyTicketsOptions, BuyTicketsResult } from './buy';
export type { ClaimResult } from './claim';
export type { LordsPotConfigInput, LordsPotNetwork } from './config';

/**
 * A configured LordsPot client.
 *
 * Every method that touches money verifies the connected RPC really serves the
 * declared cluster before doing anything (see networkGuard.ts) — so a stale
 * mainnet RPC in a "devnet" config fails loudly instead of spending real funds.
 */
export interface LordsPotClient {
  readonly network: LordsPotNetwork;
  readonly programId: PublicKey;
  readonly usdcMint: PublicKey;
  readonly connection: Connection;

  /** Live on-chain protocol state. Ball ranges change every epoch — re-read it. */
  getProtocolState(): Promise<ProtocolState>;

  /** A random valid ticket for the CURRENT epoch's rules. */
  quickPick(rules?: TicketRules): Promise<Ticket>;

  /** Total cost of N tickets in USDC base units, matching the program's math. */
  quoteCost(ticketCount: number): Promise<bigint>;

  /**
   * Buys tickets. Chunks, signs, and confirms automatically.
   *
   * NOT atomic across transactions — a large basket becomes several, and a
   * failure partway leaves earlier ones landed. See buy.ts.
   */
  buyTickets(
    signer: LordsPotSigner,
    tickets: Ticket[],
    options?: BuyTicketsOptions
  ): Promise<BuyTicketsResult>;

  /** All tickets for a wallet, with relay and settlement status. */
  getTickets(wallet: PublicKey | string): Promise<TicketRecord[]>;

  /** What a wallet can currently claim. */
  getClaimSummary(wallet: PublicKey | string): Promise<ClaimSummary>;

  /**
   * Claims all claimable winnings.
   *
   * The voucher is cryptographically verified against locally-derived values
   * BEFORE any signature is produced — a compromised API cannot get this SDK to
   * sign anything other than a plain claim of the signer's own winnings.
   */
  claimWinnings(signer: LordsPotSigner): Promise<ClaimResult>;
}

/**
 * Creates a LordsPot client.
 *
 * `network` is REQUIRED and never inferred — auto-detection is how someone
 * "tests" against mainnet and spends real money.
 *
 * @example
 * ```ts
 * import { createLordsPot, keypairSigner } from 'lordspot-sdk';
 *
 * const lordspot = createLordsPot({ network: 'devnet' });
 * const signer = keypairSigner(myKeypair);
 *
 * const state = await lordspot.getProtocolState();
 * const tickets = [await lordspot.quickPick(), await lordspot.quickPick()];
 * const { signatures } = await lordspot.buyTickets(signer, tickets);
 * ```
 */
export function createLordsPot(input: LordsPotConfigInput): LordsPotClient {
  const config = resolveConfig(input);
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const ensureNetwork = createNetworkGuard(connection, config);

  const toPubkey = (w: PublicKey | string): PublicKey =>
    typeof w === 'string' ? new PublicKey(w) : w;

  const loadState = async (): Promise<ProtocolState> => {
    await ensureNetwork();
    return fetchProtocolState(connection, config.programId);
  };

  return {
    network: config.network,
    programId: config.programId,
    usdcMint: config.usdcMint,
    connection,

    getProtocolState: loadState,

    async quickPick(rules?: TicketRules): Promise<Ticket> {
      // Falls back to live on-chain ranges so a caller can't accidentally
      // generate numbers valid for a previous epoch.
      const r = rules ?? (await loadState());
      return quickPick({ normalMax: r.normalMax, bonusMax: r.bonusMax });
    },

    async quoteCost(ticketCount: number): Promise<bigint> {
      return calculateTotalCost(ticketCount, await loadState());
    },

    async buyTickets(signer, tickets, options): Promise<BuyTicketsResult> {
      const state = await loadState();
      return buyTicketsImpl(
        connection,
        signer,
        tickets,
        state,
        config.programId,
        config.usdcMint,
        options ?? {}
      );
    },

    async getTickets(wallet): Promise<TicketRecord[]> {
      return apiGetTickets(config.apiUrl, toPubkey(wallet).toBase58());
    },

    async getClaimSummary(wallet): Promise<ClaimSummary> {
      return getClaimSummary(config.apiUrl, toPubkey(wallet).toBase58());
    },

    async claimWinnings(signer): Promise<ClaimResult> {
      const state = await loadState();
      return claimWinningsImpl(
        connection,
        signer,
        state,
        config.apiUrl,
        config.programId,
        config.usdcMint
      );
    },
  };
}
