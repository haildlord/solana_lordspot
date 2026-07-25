import { create } from 'zustand';
import type { StagedTicket } from '../solana/ticketUtils';

interface TicketBuilderState {
  stagedTickets: StagedTicket[];
  quickPickCount: number;
  manualNormals: number[];
  manualBonus: number | null;

  addTickets: (tickets: StagedTicket[]) => void;
  removeTicket: (index: number) => void;
  clearTickets: () => void;
  setQuickPickCount: (n: number) => void;
  toggleManualNormal: (n: number) => void;
  toggleManualBonus: (n: number) => void;
  resetManualPicker: () => void;
}

export const useTicketBuilderStore = create<TicketBuilderState>((set, get) => ({
  stagedTickets: [],
  quickPickCount: 1,
  manualNormals: [],
  manualBonus: null,

  addTickets: (tickets) => set((s) => ({ stagedTickets: [...s.stagedTickets, ...tickets] })),

  removeTicket: (index) =>
    set((s) => ({ stagedTickets: s.stagedTickets.filter((_, i) => i !== index) })),

  clearTickets: () => set({ stagedTickets: [] }),

  setQuickPickCount: (n) => set({ quickPickCount: Math.max(0, n) }),

  toggleManualNormal: (n) => {
    const { manualNormals } = get();
    if (manualNormals.includes(n)) {
      set({ manualNormals: manualNormals.filter((x) => x !== n) });
    } else if (manualNormals.length < 5) {
      set({ manualNormals: [...manualNormals, n].sort((a, b) => a - b) });
    }
  },

  toggleManualBonus: (n) => set((s) => ({ manualBonus: s.manualBonus === n ? null : n })),

  resetManualPicker: () => set({ manualNormals: [], manualBonus: null }),
}));
