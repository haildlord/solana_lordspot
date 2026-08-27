import { Connection, PublicKey } from '@solana/web3.js';
import { LordsPotError } from './errors';
import { getLordsPotStatePda } from './pdas';

/**
 * Live protocol state, read straight from the program's own account.
 *
 * Read from CHAIN, never hardcoded and never taken from the API. Two reasons:
 *
 *  1. These values genuinely change. Ball ranges change at epoch rollover, and
 *     the admin can re-price fees or move the per-transaction cap at any time
 *     via set_relay_config. An SDK that baked in "65 tickets, 1..30" would start
 *     silently producing reverting transactions the day any of it moved.
 *  2. It removes the API from the trust path for anything that affects what gets
 *     signed. The server can tell us what it *thinks* is claimable; it does not
 *     get to tell us the rules.
 */
export interface ProtocolState {
  /** Highest allowed normal number this epoch. */
  normalMax: number;
  /** Highest allowed bonus number this epoch. */
  bonusMax: number;
  /** Price per ticket in USDC base units (6 decimals). */
  ticketPriceUsdc: bigint;
  /** Fixed relay fee per instruction, in USDC base units. Currently 0. */
  relayFeeBaseUsdc: bigint;
  /** Relay fee per ticket, in USDC base units. Currently 0. */
  relayFeePerTicketUsdc: bigint;
  /** Max tickets in ONE buy_ticket instruction. The SDK chunks to this. */
  maxTicketsPerPurchase: number;
  /** Ceiling on a single claim payout, in USDC base units. */
  maxClaimAmountUsdc: bigint;
  /** True while purchases and claims are frozen (daily epoch rollover). */
  isPaused: boolean;
  /** Current epoch number. */
  ongoingEpoch: bigint;
  /** The admin key that co-signs claim vouchers. */
  admin: PublicKey;
  /** Owner of the account relay fees are paid into. */
  feeRecipient: PublicKey;
}

/**
 * Byte offsets within LordsPotState, AFTER the 8-byte Anchor discriminator.
 *
 * Decoded by hand rather than through Anchor's client so the SDK does not need
 * an AnchorProvider (which wants a wallet) just to read public state. These
 * offsets are frozen by the on-chain layout — see the field-order comment in
 * lib.rs. If the program's struct ever changes, `version` below is the tripwire.
 */
const OFF = {
  normalMax: 0,
  bonusMax: 1,
  ticketPrice: 2,
  ongoingEpoch: 10,
  bump: 18,
  isPaused: 19,
  admin: 20,
  version: 52,
  relayFeeBase: 53,
  relayFeePerTicket: 61,
  feeRecipient: 69,
  maxTicketsPerPurchase: 101,
  maxClaimAmount: 102,
} as const;

/** Layout version this decoder understands. */
const SUPPORTED_STATE_VERSION = 2;
/** 8 discriminator + 238 field bytes. */
const MIN_STATE_LEN = 246;

function readU64LE(buf: Buffer, offset: number): bigint {
  return buf.readBigUInt64LE(offset);
}

export async function fetchProtocolState(
  connection: Connection,
  programId: PublicKey
): Promise<ProtocolState> {
  const pda = getLordsPotStatePda(programId);

  let account;
  try {
    account = await connection.getAccountInfo(pda);
  } catch (err) {
    throw new LordsPotError('RPC_ERROR', 'Failed to read LordsPot protocol state from the RPC.', err);
  }

  if (!account) {
    throw new LordsPotError(
      'RPC_ERROR',
      `LordsPot state account not found at ${pda.toBase58()}. ` +
        `This usually means the SDK is pointed at a cluster where LordsPot is not deployed.`
    );
  }

  if (account.data.length < MIN_STATE_LEN) {
    throw new LordsPotError(
      'RPC_ERROR',
      `LordsPot state account is ${account.data.length} bytes, expected at least ${MIN_STATE_LEN}. ` +
        `The on-chain program is likely older than this SDK — upgrade the program or downgrade the SDK.`
    );
  }

  const d = account.data.subarray(8); // strip discriminator

  const version = d[OFF.version];
  if (version !== SUPPORTED_STATE_VERSION) {
    throw new LordsPotError(
      'RPC_ERROR',
      `LordsPot state layout is v${version}, but this SDK understands v${SUPPORTED_STATE_VERSION}. ` +
        `Refusing to decode a layout it does not recognise — update lordspot-sdk.`
    );
  }

  return {
    normalMax: d[OFF.normalMax]!,
    bonusMax: d[OFF.bonusMax]!,
    ticketPriceUsdc: readU64LE(d, OFF.ticketPrice),
    ongoingEpoch: readU64LE(d, OFF.ongoingEpoch),
    isPaused: d[OFF.isPaused] === 1,
    admin: new PublicKey(d.subarray(OFF.admin, OFF.admin + 32)),
    relayFeeBaseUsdc: readU64LE(d, OFF.relayFeeBase),
    relayFeePerTicketUsdc: readU64LE(d, OFF.relayFeePerTicket),
    feeRecipient: new PublicKey(d.subarray(OFF.feeRecipient, OFF.feeRecipient + 32)),
    maxTicketsPerPurchase: d[OFF.maxTicketsPerPurchase]!,
    maxClaimAmountUsdc: readU64LE(d, OFF.maxClaimAmount),
  };
}

/**
 * Total cost of a purchase in USDC base units, matching the program's own
 * arithmetic exactly — including that the fixed relay fee is charged ONCE PER
 * INSTRUCTION, so a basket large enough to be chunked pays it per chunk.
 */
export function calculateTotalCost(ticketCount: number, state: ProtocolState): bigint {
  if (ticketCount <= 0) return 0n;
  const instructions = BigInt(Math.ceil(ticketCount / state.maxTicketsPerPurchase));
  const count = BigInt(ticketCount);
  return (
    count * state.ticketPriceUsdc +
    instructions * state.relayFeeBaseUsdc +
    count * state.relayFeePerTicketUsdc
  );
}
