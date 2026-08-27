import { LordsPotError } from './errors';

/**
 * Thin HTTP client for the LordsPot API.
 *
 * The API is treated as UNTRUSTED for anything that affects signing. It reports
 * what it believes is claimable and hands over voucher bytes; every one of those
 * claims is independently verified against chain-derived values before a
 * signature is produced (see verifyVoucher.ts). Nothing here is a trust anchor.
 */

export interface ClaimSummary {
  /** Claimable now, in USDC base units (6 decimals). */
  claimableUsdc: bigint;
  /** Informational count of free-ticket-tier wins included in the sum above. */
  freeTickets: number;
  /** Lifetime total already paid out, in USDC base units. */
  totalPaidOutUsdc: bigint;
  /** Non-null when a voucher is already issued and awaiting signature/expiry. */
  pendingVoucher: { amountUsdc: bigint; createdAt: string } | null;
}

export interface VoucherResponse {
  reused: boolean;
  claimId: string;
  amountUsdc: bigint;
  /**
   * Base64 transaction — ONLY present on first issuance (`reused: false`).
   * A reused voucher deliberately does not re-serve its bytes, so a caller
   * cannot obtain two independently-signable copies of the same payout.
   */
  transactionBase64?: string;
  lastValidBlockHeight?: number;
  note: string;
}

/**
 * Lifecycle of a ticket. A partner narrating progress to a user should treat
 * these as three genuinely different moments, not one binary "done" flag.
 *
 * - `DRAW_PENDING` — bought, drawing hasn't revealed yet.
 * - `LOST` / `WON_UNCLAIMED` / `WON_FREE_TICKET` — graded.
 * - `CLAIMED_ON_BASE` — winnings harvested, now claimable on Solana.
 * - `PAID_OUT_ON_SOLANA` — paid.
 */
export type WinStatus =
  | 'DRAW_PENDING'
  | 'LOST'
  | 'WON_UNCLAIMED'
  | 'WON_FREE_TICKET'
  | 'CLAIMED_ON_BASE'
  | 'PAID_OUT_ON_SOLANA'
  | string;

export interface TicketRecord {
  id: string;
  /** This ticket's own numbers. */
  normalBalls: number[];
  bonusBall: number;
  winStatus: WinStatus;
  winAmountUsdc: bigint;
  /** True for tiers paid as a free ticket rather than cash. */
  isFreeTicketTier: boolean;
  purchaseEpoch: number | null;
  /** Epoch this ticket actually plays in (a deferred order fulfils later). */
  fulfillEpoch: number | null;
  orderStatus: string;
  purchasedAt: string | null;
  orderHash: string;
  /** The buyer's own Solana transaction. */
  txSignature: string;
  /**
   * The Base transaction that relayed THIS ticket into Megapot. Per-ticket, not
   * per-order: a large purchase relays across several Base transactions, so
   * tickets from one Solana purchase can carry different hashes. Null until
   * that ticket's batch confirms.
   */
  baseTxHash: string | null;

  /**
   * ---- Draw results. Null until the drawing is revealed. ----
   *
   * These are what make a "reveal" experience possible without any extra API:
   * compare `normalBalls`/`bonusBall` against `epochWinningNormals`/
   * `epochWinningBonusBall` locally and narrate the match however you like.
   *
   * Results stay null until the reveal window passes, even if settlement has
   * already finished internally — so a client cannot learn the outcome early by
   * polling faster.
   */
  epochWinningNormals: number[] | null;
  epochWinningBonusBall: number | null;
  /** When this ticket's drawing closes — the countdown target. */
  epochEndedAt: string | null;
  /** When the drawing was revealed. Null while still pending. */
  epochSettledAt: string | null;
}

const DEFAULT_TIMEOUT_MS = 15_000;

async function request<T>(
  baseUrl: string,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;

  // Always bound the wait — an SDK that can hang forever on a stalled socket is
  // a liveness bug in whatever agent embeds it.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...rest.headers },
    });
  } catch (err) {
    throw new LordsPotError(
      'API_ERROR',
      `Could not reach the LordsPot API at ${baseUrl}${path}` +
        ((err as Error)?.name === 'AbortError' ? ` (timed out after ${timeoutMs}ms).` : '.'),
      err
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new LordsPotError('API_ERROR', `LordsPot API returned non-JSON (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    const message = (body as { error?: string })?.error ?? `HTTP ${res.status}`;

    // Map the API's meaningful status codes onto specific error codes so callers
    // can branch on `err.code` instead of matching message text. Without this a
    // caller sees a generic API_ERROR for the ordinary "nothing to claim" case
    // and cannot distinguish it from a real outage.
    if (res.status === 404) {
      throw new LordsPotError('NOTHING_TO_CLAIM', message);
    }
    if (res.status === 503) {
      // The claims route returns 503 while the protocol is mid-rollover.
      throw new LordsPotError('PROTOCOL_PAUSED', message);
    }
    throw new LordsPotError('API_ERROR', `LordsPot API error: ${message}`);
  }
  return body as T;
}

/** Parses a decimal string into bigint, rejecting anything unexpected. */
function toBigInt(value: unknown, field: string): bigint {
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new LordsPotError('API_ERROR', `API returned an invalid value for "${field}": ${String(value)}`);
}

export async function getClaimSummary(baseUrl: string, wallet: string): Promise<ClaimSummary> {
  const raw = await request<{
    claimableUsdc: string;
    freeTickets: number;
    totalPaidOutUsdc: string;
    pendingVoucher: { amountUsdc: string; createdAt: string } | null;
  }>(baseUrl, `/v1/claims/summary?wallet=${encodeURIComponent(wallet)}`);

  return {
    claimableUsdc: toBigInt(raw.claimableUsdc, 'claimableUsdc'),
    freeTickets: raw.freeTickets ?? 0,
    totalPaidOutUsdc: toBigInt(raw.totalPaidOutUsdc, 'totalPaidOutUsdc'),
    pendingVoucher: raw.pendingVoucher
      ? {
          amountUsdc: toBigInt(raw.pendingVoucher.amountUsdc, 'pendingVoucher.amountUsdc'),
          createdAt: raw.pendingVoucher.createdAt,
        }
      : null,
  };
}

export async function requestVoucher(baseUrl: string, wallet: string): Promise<VoucherResponse> {
  const raw = await request<{
    reused: boolean;
    claimId: string;
    amountUsdc: string;
    transactionBase64?: string;
    lastValidBlockHeight?: number;
    note: string;
  }>(baseUrl, '/v1/claims/voucher', {
    method: 'POST',
    body: JSON.stringify({ wallet }),
  });

  const out: VoucherResponse = {
    reused: raw.reused,
    claimId: raw.claimId,
    amountUsdc: toBigInt(raw.amountUsdc, 'amountUsdc'),
    note: raw.note,
  };
  if (raw.transactionBase64 !== undefined) out.transactionBase64 = raw.transactionBase64;
  if (raw.lastValidBlockHeight !== undefined) out.lastValidBlockHeight = raw.lastValidBlockHeight;
  return out;
}

export async function getTickets(baseUrl: string, wallet: string): Promise<TicketRecord[]> {
  const raw = await request<{ tickets: Array<Record<string, unknown>> }>(
    baseUrl,
    `/v1/protocol/tickets?wallet=${encodeURIComponent(wallet)}`
  );

  return (raw.tickets ?? []).map((t) => ({
    id: String(t.id),
    normalBalls: (t.normalBalls as number[]) ?? [],
    bonusBall: (t.bonusBall as number) ?? 0,
    winStatus: String(t.winStatus ?? 'UNKNOWN'),
    winAmountUsdc: toBigInt(t.winAmountUsdc ?? '0', 'winAmountUsdc'),
    isFreeTicketTier: Boolean(t.isFreeTicketTier),
    purchaseEpoch: (t.purchaseEpoch as number | null) ?? null,
    fulfillEpoch: (t.fulfillEpoch as number | null) ?? null,
    orderStatus: String(t.orderStatus ?? 'UNKNOWN'),
    purchasedAt: (t.purchasedAt as string | null) ?? null,
    orderHash: String(t.orderHash ?? ''),
    txSignature: String(t.txSignature ?? ''),
    baseTxHash: (t.baseTxHash as string | null) ?? null,
    epochWinningNormals: (t.epochWinningNormals as number[] | null) ?? null,
    epochWinningBonusBall: (t.epochWinningBonusBall as number | null) ?? null,
    epochEndedAt: (t.epochEndedAt as string | null) ?? null,
    epochSettledAt: (t.epochSettledAt as string | null) ?? null,
  }));
}
