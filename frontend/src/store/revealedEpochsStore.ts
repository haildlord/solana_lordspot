import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface RevealedEpochsState {
  revealed: Record<string, boolean>;
  isRevealed: (wallet: string, epoch: number) => boolean;
  reveal: (wallet: string, epoch: number) => void;
}

/** Exported so components can read `revealed` directly without violating rules of hooks inside a .map(). */
export const keyFor = (wallet: string, epoch: number) => `${wallet}:${epoch}`;

/** Which settled draws a wallet has already clicked "Check Results" on — purely a display gate, not money-critical. */
export const useRevealedEpochsStore = create<RevealedEpochsState>()(
  persist(
    (set, get) => ({
      revealed: {},
      isRevealed: (wallet, epoch) => !!get().revealed[keyFor(wallet, epoch)],
      reveal: (wallet, epoch) =>
        set((s) => ({ revealed: { ...s.revealed, [keyFor(wallet, epoch)]: true } })),
    }),
    { name: 'lordspot-revealed-epochs' }
  )
);
