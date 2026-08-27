import type { TicketRecord } from './api';

/**
 * Comparing a ticket against the drawn numbers.
 *
 * Provided so integrators don't reimplement match-counting — the obvious naive
 * version (index-by-index comparison) is wrong, because normals are a SET: a
 * ticket holding [3,7,11] against a draw of [11,3,20] matches two numbers
 * regardless of position.
 *
 * This is presentation only. Actual prize grading happens off-chain against
 * Megapot's own tier table, and `winStatus` / `winAmountUsdc` on the ticket are
 * authoritative for what was won. Use this to narrate the reveal, never to
 * decide what someone is owed.
 */
export interface TicketMatch {
  /** How many of the 5 normal numbers matched (order-independent). */
  normalMatches: number;
  /** Whether the bonus number matched. */
  bonusMatch: boolean;
  /** Which of this ticket's normals hit — useful for highlighting a reveal. */
  matchedNormals: number[];
  /** Which missed. */
  missedNormals: number[];
}

/**
 * Compares a ticket to its drawing.
 *
 * Returns `null` when the draw hasn't revealed yet — the API withholds winning
 * numbers until the reveal window passes, so a null here means "not yet",
 * not "no match".
 */
export function getTicketMatch(ticket: TicketRecord): TicketMatch | null {
  const { epochWinningNormals, epochWinningBonusBall } = ticket;
  if (!epochWinningNormals || epochWinningBonusBall === null) return null;

  const winning = new Set(epochWinningNormals);
  const matchedNormals: number[] = [];
  const missedNormals: number[] = [];

  for (const n of ticket.normalBalls) {
    if (winning.has(n)) matchedNormals.push(n);
    else missedNormals.push(n);
  }

  return {
    normalMatches: matchedNormals.length,
    bonusMatch: ticket.bonusBall === epochWinningBonusBall,
    matchedNormals,
    missedNormals,
  };
}

/** True once this ticket's drawing has revealed and results are readable. */
export function isRevealed(ticket: TicketRecord): boolean {
  return ticket.epochWinningNormals !== null && ticket.epochSettledAt !== null;
}

/**
 * Milliseconds until this ticket's drawing closes; 0 once it has passed, and
 * null if the target isn't known yet. Handy for a countdown between a purchase
 * session and a later reveal session.
 */
export function timeUntilDraw(ticket: TicketRecord, now: Date = new Date()): number | null {
  if (!ticket.epochEndedAt) return null;
  const target = new Date(ticket.epochEndedAt).getTime();
  if (Number.isNaN(target)) return null;
  return Math.max(0, target - now.getTime());
}
