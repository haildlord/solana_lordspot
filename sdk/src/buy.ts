import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { LordsPotError, explainOnChainError } from './errors';
import { buildBuyTicketInstruction } from './instructions';
import { getUserUsdcAta } from './pdas';
import type { ProtocolState } from './protocol';
import { calculateTotalCost } from './protocol';
import type { LordsPotSigner } from './signer';
import { assertTicketsValid, normalizeTickets, type Ticket } from './ticket';

/**
 * Solana's hard per-transaction wire limit. A transaction exceeding this is
 * rejected outright, so all chunking below exists to stay under it.
 */
const MAX_TX_BYTES = 1232;

/**
 * Safety margin left free in each transaction.
 *
 * Serialized size is computed exactly before sending, but the blockhash is
 * fetched fresh at send time and a signature is added after sizing, so a small
 * reserve avoids a transaction that measured fine locally failing at broadcast.
 */
const TX_SIZE_HEADROOM = 64;

export interface BuyTicketsOptions {
  /**
   * Priority fee in micro-lamports per compute unit. Raises the chance of
   * landing during congestion; costs a negligible amount of SOL.
   */
  priorityFeeMicroLamports?: number;
  /** Compute unit limit per transaction. A 65-ticket buy measures ~38k CU. */
  computeUnitLimit?: number;
}

export interface BuyTicketsResult {
  /** One signature per transaction sent — a large basket produces several. */
  signatures: string[];
  /** Total tickets purchased. */
  ticketCount: number;
  /** Total USDC base units spent (tickets + any relay fee). */
  totalCostUsdc: bigint;
}

/**
 * Splits a basket into instruction-sized chunks.
 *
 * Bounded by TWO independent limits, and the smaller always wins:
 *  1. `maxTicketsPerPurchase` — read live from chain, enforced by the program.
 *  2. Solana's 1232-byte transaction ceiling.
 *
 * The on-chain cap is authoritative but ADMIN-MUTABLE, so it is never assumed;
 * it is re-read on every call. The byte ceiling is fixed by the network.
 */
function chunkTickets(tickets: Ticket[], maxPerInstruction: number): Ticket[][] {
  const chunks: Ticket[][] = [];
  for (let i = 0; i < tickets.length; i += maxPerInstruction) {
    chunks.push(tickets.slice(i, i + maxPerInstruction));
  }
  return chunks;
}

/**
 * Measures a fully-built transaction rather than estimating it.
 *
 * `requireAllSignatures: false` lets an unsigned transaction serialize, but the
 * signature slot is still reserved in the wire format, so the measurement stays
 * honest.
 */
function serializedSize(tx: Transaction): number {
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
}

function buildTransaction(
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
  blockhash: string,
  lastValidBlockHeight: number,
  options: BuyTicketsOptions
): Transaction {
  const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight });
  if (options.computeUnitLimit !== undefined) {
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: options.computeUnitLimit }));
  }
  if (options.priorityFeeMicroLamports !== undefined) {
    tx.add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: options.priorityFeeMicroLamports,
      })
    );
  }
  for (const ix of instructions) tx.add(ix);
  return tx;
}

/**
 * Buys tickets, chunking, signing, and confirming as needed.
 *
 * PRE-FLIGHT CHECKS run before anything is signed, because every one of them
 * fails more cheaply here than as an on-chain revert the caller already paid for:
 *   - protocol not paused (it pauses briefly at each daily rollover)
 *   - every ticket valid against THIS epoch's ball ranges
 *   - buyer's USDC balance covers the full cost
 *
 * NOT ATOMIC ACROSS TRANSACTIONS. A basket larger than one transaction is sent
 * as several, and Solana has no cross-transaction atomicity: if the protocol
 * pauses (or the RPC fails) partway through, earlier transactions stay landed
 * and later ones fail. `signatures` therefore reports what actually succeeded,
 * and a thrown error still means some tickets may have been bought — always
 * reconcile against `getTickets()` rather than assuming all-or-nothing.
 */
export async function buyTickets(
  connection: Connection,
  signer: LordsPotSigner,
  tickets: Ticket[],
  state: ProtocolState,
  programId: PublicKey,
  usdcMint: PublicKey,
  options: BuyTicketsOptions = {}
): Promise<BuyTicketsResult> {
  if (state.isPaused) {
    throw new LordsPotError(
      'PROTOCOL_PAUSED',
      'LordsPot is paused right now — this happens briefly during the daily epoch rollover. Retry in a few minutes.'
    );
  }

  // Validate against LIVE epoch rules, not against anything cached or assumed.
  assertTicketsValid(tickets, { normalMax: state.normalMax, bonusMax: state.bonusMax });

  // The program requires strictly ascending normals; sort rather than reject, so
  // a caller cannot produce a valid-looking basket that reverts on-chain.
  const normalized = normalizeTickets(tickets);

  const totalCost = calculateTotalCost(normalized.length, state);

  // Balance pre-flight. Advisory only — the SPL transfer inside buy_ticket is
  // the real enforcement — but it turns "sign, send, revert, pay fees" into an
  // immediate, explanatory failure.
  const buyerAta = getUserUsdcAta(signer.publicKey, usdcMint);
  let balance = 0n;
  try {
    const res = await connection.getTokenAccountBalance(buyerAta);
    balance = BigInt(res.value.amount);
  } catch {
    // No ATA at all means no USDC — a legitimate zero, not a failure.
    balance = 0n;
  }
  if (balance < totalCost) {
    throw new LordsPotError(
      'INSUFFICIENT_USDC',
      `Not enough USDC. Need ${totalCost} base units, wallet holds ${balance}. ` +
        `(USDC uses 6 decimals, so 1000000 = $1.00.)`
    );
  }

  const chunks = chunkTickets(normalized, state.maxTicketsPerPurchase);
  const signatures: string[] = [];

  for (const chunk of chunks) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

    const ix = buildBuyTicketInstruction(chunk, {
      programId,
      usdcMint,
      buyer: signer.publicKey,
      feeRecipient: state.feeRecipient,
    });

    const tx = buildTransaction([ix], signer.publicKey, blockhash, lastValidBlockHeight, options);

    // Verify the real serialized size instead of trusting the chunking math.
    // If the on-chain cap is ever raised beyond what a transaction can carry,
    // this catches it here rather than as an opaque broadcast rejection.
    const size = serializedSize(tx);
    if (size > MAX_TX_BYTES - TX_SIZE_HEADROOM) {
      throw new LordsPotError(
        'TOO_MANY_TICKETS',
        `A chunk of ${chunk.length} tickets serializes to ${size} bytes, over Solana's ` +
          `${MAX_TX_BYTES}-byte limit (with ${TX_SIZE_HEADROOM} bytes reserved). ` +
          `The on-chain maxTicketsPerPurchase (${state.maxTicketsPerPurchase}) is too high for this transaction shape.`
      );
    }

    const signed = await signer.signTransaction(tx);

    let signature: string;
    try {
      signature = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
    } catch (err) {
      const logs = (err as { logs?: string[] })?.logs;
      const explained = explainOnChainError(logs);
      throw new LordsPotError(
        'TRANSACTION_FAILED',
        explained
          ? `Purchase failed: ${explained}` +
            (signatures.length > 0
              ? ` NOTE: ${signatures.length} earlier transaction(s) already landed and those tickets WERE bought.`
              : '')
          : `Purchase failed to send.` +
            (signatures.length > 0
              ? ` NOTE: ${signatures.length} earlier transaction(s) already landed and those tickets WERE bought.`
              : ''),
        err
      );
    }

    const confirmation = await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );
    if (confirmation.value.err) {
      throw new LordsPotError(
        'TRANSACTION_FAILED',
        `Purchase transaction ${signature} landed but failed: ${JSON.stringify(confirmation.value.err)}.` +
          (signatures.length > 0
            ? ` NOTE: ${signatures.length} earlier transaction(s) succeeded and those tickets WERE bought.`
            : '')
      );
    }

    signatures.push(signature);
  }

  return {
    signatures,
    ticketCount: normalized.length,
    totalCostUsdc: totalCost,
  };
}
