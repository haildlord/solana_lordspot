/**
 * Error taxonomy.
 *
 * Every failure mode gets a distinct, machine-checkable `code` so integrators can
 * branch on it (retry vs. surface to user vs. abort) instead of string-matching
 * messages. Messages are for humans and may change; codes are API and will not.
 */

export type LordsPotErrorCode =
  // --- configuration / environment ---
  | 'INVALID_CONFIG'
  | 'NETWORK_MISMATCH'
  | 'NETWORK_UNAVAILABLE'
  // --- input validation (caller's fault, never retry) ---
  | 'INVALID_TICKET'
  | 'TOO_MANY_TICKETS'
  | 'NO_TICKETS'
  // --- protocol state ---
  | 'PROTOCOL_PAUSED'
  | 'INSUFFICIENT_USDC'
  | 'INSUFFICIENT_SOL'
  | 'NOTHING_TO_CLAIM'
  | 'VOUCHER_ALREADY_PENDING'
  // --- the security-critical one ---
  | 'VOUCHER_VERIFICATION_FAILED'
  // --- transport ---
  | 'API_ERROR'
  | 'RPC_ERROR'
  | 'TRANSACTION_FAILED';

export class LordsPotError extends Error {
  readonly code: LordsPotErrorCode;
  /** Underlying error, when this wraps something thrown lower down. */
  readonly cause?: unknown;

  constructor(code: LordsPotErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'LordsPotError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
    // Restores prototype chain when compiled to ES5-era targets, so
    // `err instanceof LordsPotError` works for consumers regardless of their
    // own build settings.
    Object.setPrototypeOf(this, LordsPotError.prototype);
  }
}

/**
 * Raised when a claim voucher returned by the API does not match what this SDK
 * independently expects. Carries the failed assertion so an integrator can log
 * precisely what was wrong.
 *
 * THIS IS A SECURITY ALERT, NOT A TRANSIENT FAULT. It means the bytes handed to
 * us to sign were not a plain claim of the caller's own winnings. Never retry,
 * never sign anyway — surface it and stop.
 */
export class VoucherVerificationError extends LordsPotError {
  readonly assertion: string;

  constructor(assertion: string, detail: string) {
    super(
      'VOUCHER_VERIFICATION_FAILED',
      `Refusing to sign claim voucher — failed check "${assertion}": ${detail}. ` +
        `This transaction was NOT signed. Do not retry; report this immediately.`
    );
    this.name = 'VoucherVerificationError';
    this.assertion = assertion;
    Object.setPrototypeOf(this, VoucherVerificationError.prototype);
  }
}

/**
 * Maps the program's own error names (as they appear in transaction logs) to
 * something an integrator can act on. Anchor surfaces custom errors as opaque
 * numeric codes, but the human-readable name is present in the logs, so match
 * on that rather than on a code that could shift between IDL revisions.
 */
export function explainOnChainError(logs: string[] | null | undefined): string | null {
  if (!logs || logs.length === 0) return null;
  const joined = logs.join('\n');

  const known: Array<[string, string]> = [
    ['ProtocolPaused', 'The protocol is paused (this happens briefly during the daily epoch rollover). Retry in a few minutes.'],
    ['ExceedsMaxTicketsPerPurchase', 'Too many tickets in one instruction — the SDK chunks automatically, so this usually means the on-chain limit was lowered mid-flight. Retry.'],
    ['TooManyTickets', 'Ticket count exceeds the protocol hard ceiling.'],
    ['NoTicketsProvided', 'No tickets were provided.'],
    ['InvalidTicketLength', 'Each ticket must contain exactly 5 normal numbers.'],
    ['NormalBallOutOfBounds', 'A normal number is outside the range allowed for the current epoch. Re-read on-chain state — ball ranges change between epochs.'],
    ['BonusBallOutOfBounds', 'The bonus number is outside the range allowed for the current epoch.'],
    ['BallsNotSortedOrDuplicated', 'Normal numbers must be strictly ascending with no duplicates.'],
    ['ClaimExceedsMaxAmount', 'Claim exceeds the protocol payout ceiling. Contact LordsPot — this needs an admin to raise the limit.'],
    ['InsufficientVaultFunds', 'The protocol vault is temporarily short on USDC. Retry shortly.'],
    ['ConstraintDuplicateMutableAccount', 'Buyer and fee recipient resolve to the same account. This wallet cannot buy tickets.'],
  ];

  for (const [name, explanation] of known) {
    if (joined.includes(name)) return explanation;
  }
  return null;
}
