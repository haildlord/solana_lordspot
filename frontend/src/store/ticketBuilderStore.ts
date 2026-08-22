import { create } from 'zustand';
import { generateQuickPick, emptyTicket, type StagedTicket } from '../solana/ticketUtils';

/** Hard cap on tickets staged for a single purchase. Not about our own Base
 * batching (that already handles arbitrary volume by chunking) — it's here
 * because the wallet and Solana itself can't: a large enough purchase turns
 * into dozens of Solana transactions handed to one signAllTransactions call,
 * which real wallets either choke on or the user outright rejects, and by the
 * time signing finishes the earliest transactions' blockhash has often expired.
 *
 * At 65 tickets per transaction, 200 is FOUR transactions behind a single
 * wallet approval — well inside what wallets handle smoothly, and signed fast
 * enough that no blockhash goes stale. Raising it further is a wallet-UX
 * question, not a protocol one.
 *
 * Must stay equal to the LAST entry of QUICK_COUNTS in Home.tsx, so the biggest
 * one-tap option is always reachable rather than silently clamped.
 *
 * Sized generously on purpose: LordsPot earns Megapot referral revenue on every
 * ticket sold, so a bigger basket is straightforwardly better for the protocol.
 * Restricting how much someone can buy costs us money. */
export const MAX_STAGED_TICKETS = 200;

interface TicketBuilderState {
  stagedTickets: StagedTicket[];

  removeTicket: (index: number) => void;
  clearTickets: () => void;

  /** Grows or shrinks the staged list to exactly `n` tickets — growing
   * appends fresh quick-pick tickets, shrinking trims from the end. This is
   * the one entry point the count stepper/chips call: there's no separate
   * "Add" step anymore, changing the count IS staging. */
  syncStagedCount: (n: number, normalMax: number, bonusMax: number) => void;

  /** Regenerates one staged ticket's numbers in place — the editor's
   * per-row shuffle icon, and the quick-pick icon shown once a ticket has
   * been cleared. */
  shuffleTicket: (index: number, normalMax: number, bonusMax: number) => void;

  /** Empties one staged ticket's numbers (the row stays, its balls go blank)
   * so the user can reselect from scratch via the editor's ball grid. */
  clearTicketBalls: (index: number) => void;

  toggleTicketNormal: (index: number, n: number) => void;
  toggleTicketBonus: (index: number, n: number) => void;

  /** Editor's top-level "quick-pick all" — regenerates every staged ticket. */
  shuffleAllTickets: (normalMax: number, bonusMax: number) => void;

  /** Editor's top-level "clear all" — empties every ticket's balls, rows stay. */
  clearAllTicketBalls: () => void;
}

export const useTicketBuilderStore = create<TicketBuilderState>((set) => ({
  stagedTickets: [],

  removeTicket: (index) => set((s) => ({ stagedTickets: s.stagedTickets.filter((_, i) => i !== index) })),

  clearTickets: () => set({ stagedTickets: [] }),

  syncStagedCount: (n, normalMax, bonusMax) =>
    set((s) => {
      const target = Math.max(0, Math.min(n, MAX_STAGED_TICKETS));
      if (target === s.stagedTickets.length) return s;
      if (target < s.stagedTickets.length) {
        return { stagedTickets: s.stagedTickets.slice(0, target) };
      }
      const toAdd = Array.from({ length: target - s.stagedTickets.length }, () =>
        generateQuickPick(normalMax, bonusMax)
      );
      return { stagedTickets: [...s.stagedTickets, ...toAdd] };
    }),

  shuffleTicket: (index, normalMax, bonusMax) =>
    set((s) => ({
      stagedTickets: s.stagedTickets.map((t, i) => (i === index ? generateQuickPick(normalMax, bonusMax) : t)),
    })),

  clearTicketBalls: (index) =>
    set((s) => ({
      stagedTickets: s.stagedTickets.map((t, i) => (i === index ? emptyTicket() : t)),
    })),

  toggleTicketNormal: (index, n) =>
    set((s) => ({
      stagedTickets: s.stagedTickets.map((t, i) => {
        if (i !== index) return t;
        const has = t.normals.includes(n);
        if (has) return { ...t, normals: t.normals.filter((x) => x !== n), isQuickPick: false };
        if (t.normals.length >= 5) return t;
        return { ...t, normals: [...t.normals, n].sort((a, b) => a - b), isQuickPick: false };
      }),
    })),

  toggleTicketBonus: (index, n) =>
    set((s) => ({
      stagedTickets: s.stagedTickets.map((t, i) =>
        i === index ? { ...t, bonus: t.bonus === n ? null : n, isQuickPick: false } : t
      ),
    })),

  shuffleAllTickets: (normalMax, bonusMax) =>
    set((s) => ({
      stagedTickets: s.stagedTickets.map(() => generateQuickPick(normalMax, bonusMax)),
    })),

  clearAllTicketBalls: () =>
    set((s) => ({
      stagedTickets: s.stagedTickets.map(() => emptyTicket()),
    })),
}));
