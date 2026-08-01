import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWallet } from '@solana/wallet-adapter-react';
import { getProtocolState, getAllTimeStats, getEpochs, getEpochWinners, getEpochWinnerDetail, getUserTickets } from './protocol';
import { getClaimSummary, postClaimVoucher } from './claims';

/** Live Megapot-mirrored state (prize pool, next draw, pause flag). Polled — this is the number users watch tick up. */
export function useProtocolState() {
  return useQuery({
    queryKey: ['protocol-state'],
    queryFn: getProtocolState,
    refetchInterval: 15_000,
  });
}

/** All-time totals — the "Real winners every day" strip at the top of Results. */
export function useAllTimeStats() {
  return useQuery({
    queryKey: ['all-time-stats'],
    queryFn: getAllTimeStats,
  });
}

/** Settled epoch history for Results, paged backwards from the newest epoch via `nextCursor`. */
export function useEpochs() {
  return useInfiniteQuery({
    queryKey: ['epochs'],
    queryFn: ({ pageParam }) => getEpochs(pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** Winners for one settled epoch, paged via `nextOffset`. */
export function useEpochWinners(megapotId: number | null) {
  return useInfiniteQuery({
    queryKey: ['epoch-winners', megapotId],
    queryFn: ({ pageParam }) => getEpochWinners(megapotId as number, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: megapotId !== null,
  });
}

/** One winner's individual tickets for one epoch — powers the winner-detail modal. */
export function useEpochWinnerDetail(megapotId: number | null, buyer: string | null) {
  return useQuery({
    queryKey: ['epoch-winner-detail', megapotId, buyer],
    queryFn: () => getEpochWinnerDetail(megapotId as number, buyer as string),
    enabled: megapotId !== null && buyer !== null,
  });
}

/** The connected wallet's own ticket history. Disabled until a wallet is connected. */
export function useMyTickets() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;

  return useQuery({
    queryKey: ['my-tickets', wallet],
    queryFn: () => getUserTickets(wallet as string),
    enabled: wallet !== null,
    refetchInterval: 20_000,
  });
}

/** The connected wallet's claimable balance — powers the Winnings page. */
export function useClaimSummary() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;

  return useQuery({
    queryKey: ['claim-summary', wallet],
    queryFn: () => getClaimSummary(wallet as string),
    enabled: wallet !== null,
    refetchInterval: 15_000,
  });
}

/** Requests (or idempotently re-fetches) a claim voucher for the connected wallet. */
export function useRequestClaimVoucher() {
  const { publicKey } = useWallet();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!publicKey) throw new Error('Wallet not connected');
      return postClaimVoucher(publicKey.toBase58());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['claim-summary'] });
    },
  });
}
