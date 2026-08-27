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

export interface TicketRecord {
  id: string;
  normalBalls: number[];
  bonusBall: number;
  winStatus: string;
  winAmountUsdc: bigint;
  purchaseEpoch: number | null;
  fulfillEpoch: number | null;
  orderStatus: string;
  txSignature: string;
  baseTxHash: string | null;
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
    purchaseEpoch: (t.purchaseEpoch as number | null) ?? null,
    fulfillEpoch: (t.fulfillEpoch as number | null) ?? null,
    orderStatus: String(t.orderStatus ?? 'UNKNOWN'),
    txSignature: String(t.txSignature ?? ''),
    baseTxHash: (t.baseTxHash as string | null) ?? null,
  }));
}
