import { LordsPotError } from './errors';

export const NORMALS_PER_TICKET = 5;

/** A single lottery ticket: 5 distinct normal numbers plus one bonus number. */
export interface Ticket {
  normals: number[];
  bonus: number;
}

/** Live protocol rules, read from chain — NEVER hardcoded. See protocol.ts. */
export interface TicketRules {
  normalMax: number;
  bonusMax: number;
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

/**
 * Validates one ticket against the CURRENT epoch's rules.
 *
 * Returns a human-readable reason, or null if valid. Kept as a return value
 * rather than a throw so callers can validate a whole basket and report every
 * problem at once instead of one per round-trip.
 *
 * Mirrors the on-chain checks in `buy_ticket` exactly. This is a fail-fast
 * convenience, never a security boundary — the program re-checks all of it. The
 * value is that a caller learns "number 31 is out of range this epoch" locally,
 * instead of paying for a transaction that reverts.
 */
export function validateTicket(ticket: Ticket, rules: TicketRules): string | null {
  if (!ticket || typeof ticket !== 'object') return 'Ticket must be an object';
  if (!Array.isArray(ticket.normals)) return 'normals must be an array';

  if (ticket.normals.length !== NORMALS_PER_TICKET) {
    return `Each ticket needs exactly ${NORMALS_PER_TICKET} normal numbers, got ${ticket.normals.length}`;
  }
  if (!ticket.normals.every(isPositiveInt)) {
    return 'Normal numbers must be positive whole numbers';
  }
  if (new Set(ticket.normals).size !== ticket.normals.length) {
    return 'Normal numbers must be unique (no duplicates)';
  }
  const outOfRange = ticket.normals.find((n) => n > rules.normalMax);
  if (outOfRange !== undefined) {
    return `Normal number ${outOfRange} is out of range — this epoch allows 1..${rules.normalMax}`;
  }
  if (!isPositiveInt(ticket.bonus)) {
    return 'Bonus must be a positive whole number';
  }
  if (ticket.bonus > rules.bonusMax) {
    return `Bonus number ${ticket.bonus} is out of range — this epoch allows 1..${rules.bonusMax}`;
  }
  return null;
}

/**
 * Validates a whole basket, throwing with EVERY problem listed rather than just
 * the first — a caller generating 200 tickets wants one report, not 200 retries.
 */
export function assertTicketsValid(tickets: Ticket[], rules: TicketRules): void {
  if (!Array.isArray(tickets) || tickets.length === 0) {
    throw new LordsPotError('NO_TICKETS', 'Provide at least one ticket.');
  }

  const problems: string[] = [];
  tickets.forEach((t, i) => {
    const reason = validateTicket(t, rules);
    if (reason) problems.push(`  ticket[${i}]: ${reason}`);
  });

  if (problems.length > 0) {
    throw new LordsPotError(
      'INVALID_TICKET',
      `${problems.length} of ${tickets.length} tickets are invalid:\n${problems.join('\n')}`
    );
  }
}

/**
 * The program requires normals STRICTLY ASCENDING. Sorting here rather than
 * making callers do it removes an easy way to produce a valid-looking basket
 * that reverts on-chain.
 *
 * Returns new objects — never mutates the caller's array.
 */
export function normalizeTickets(tickets: Ticket[]): Ticket[] {
  return tickets.map((t) => ({
    normals: [...t.normals].sort((a, b) => a - b),
    bonus: t.bonus,
  }));
}

/**
 * Generates a random valid ticket for the current epoch's rules ("quick pick").
 *
 * NOT cryptographically random, and it doesn't need to be — the draw's fairness
 * comes from Megapot, not from how a player picks numbers. Do not repurpose this
 * for anything security-sensitive.
 */
export function quickPick(rules: TicketRules): Ticket {
  if (rules.normalMax < NORMALS_PER_TICKET) {
    throw new LordsPotError(
      'INVALID_CONFIG',
      `normalMax (${rules.normalMax}) is below ${NORMALS_PER_TICKET}; cannot pick unique numbers.`
    );
  }
  const pool = Array.from({ length: rules.normalMax }, (_, i) => i + 1);
  // Partial Fisher-Yates: only shuffle the first NORMALS_PER_TICKET slots.
  for (let i = 0; i < NORMALS_PER_TICKET; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return {
    normals: pool.slice(0, NORMALS_PER_TICKET).sort((a, b) => a - b),
    bonus: 1 + Math.floor(Math.random() * rules.bonusMax),
  };
}
