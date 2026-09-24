import { TICKET_RULES } from './constants';

export interface StagedTicket {
  normals: number[];
  /** null while a cleared/in-progress ticket is still missing its bonus ball
   * — only a fully-picked ticket (5 normals + 1 bonus) is ever sent on-chain,
   * see isTicketComplete. */
  bonus: number | null;
  isQuickPick: boolean;
}

/** Uniformly random ticket within the current epoch's ball ranges. */
export function generateQuickPick(normalMax: number, bonusMax: number): StagedTicket {
  const normals = new Set<number>();
  while (normals.size < TICKET_RULES.NORMALS_PER_TICKET) {
    normals.add(1 + Math.floor(Math.random() * normalMax));
  }
  return {
    normals: [...normals].sort((a, b) => a - b),
    bonus: 1 + Math.floor(Math.random() * bonusMax),
    isQuickPick: true,
  };
}

/** A freshly-cleared ticket row — kept in the staged list, but with no balls
 * picked yet, ready for manual reselection or a per-row quick-pick. */
export function emptyTicket(): StagedTicket {
  return { normals: [], bonus: null, isQuickPick: false };
}

/**
 * Mirrors buy_ticket's on-chain checks exactly (lib.rs): 5 unique normals,
 * strictly ascending, in-range; bonus in-range. Client-side validation is
 * pure UX — the program re-validates everything regardless.
 */
export function validateTicket(
  normals: number[],
  bonus: number | null,
  normalMax: number,
  bonusMax: number
): string | null {
  if (normals.length !== TICKET_RULES.NORMALS_PER_TICKET) return 'Pick exactly 5 numbers';
  if (bonus === null) return 'Pick 1 bonus number';
  if (new Set(normals).size !== normals.length) return 'Numbers must be unique';
  if (normals.some((n) => n < 1 || n > normalMax)) return `Numbers must be between 1 and ${normalMax}`;
  if (bonus < 1 || bonus > bonusMax) return `Bonus must be between 1 and ${bonusMax}`;
  return null;
}

/** True only for a fully-picked ticket (5 unique in-range normals + 1
 * in-range bonus) — the only shape ever allowed to reach buyTickets(). */
export function isTicketComplete(t: StagedTicket, normalMax: number, bonusMax: number): boolean {
  return validateTicket(t.normals, t.bonus, normalMax, bonusMax) === null;
}

export function sortedNormals(normals: number[]): number[] {
  return [...normals].sort((a, b) => a - b);
}
