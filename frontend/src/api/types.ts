/** Mirrors backend/src/routes/protocol.ts and claims.ts response shapes exactly. */

export interface ProtocolStateResponse {
  isPaused: boolean;
  megapotEpochId: number | null;
  nextDrawAt: string | null;
  prizePoolUsdc: string;
  maxNormalBall: number | null;
  maxBonusBall: number | null;
}

export interface EpochSummary {
  megapotId: number;

  lordsPotTicketCount: number;
  totalTicketCount: number;

  lordsPotWinnersCount: number;
  totalWinnersCount: number;

  totalPaidAmount: string;
  lordsPotPaidAmount: string;

  jackpot: string;
  prizeTiers: PrizeTier[];

  topPrizeAmountUsdc: string;
  topPrizeWinnersCount: number;

  normalMax: number | null;
  bonusMax: number | null;
  winningNormals: number[];
  winningBonusBall: number;

  settledAt: string;
}

export interface AllTimeStatsResponse {
  jackpotsWon: number;
  prizesWon: string;
}

export interface PrizeTier {
  amount: string;
  tierId: number;
  ticketCount: number;
}

export interface EpochsResponse {
  epochs: EpochSummary[];
  nextCursor: number | null;
}

export interface EpochWinner {
  buyer: string;
  ticketCount: number;
  totalUsdc: string;
}

export interface EpochWinnersResponse {
  megapotId: number;
  winners: EpochWinner[];
  nextOffset: number | null;
}

export interface EpochWinnerTicket {
  normalBalls: number[];
  bonusBall: number;
  winStatus: WinStatus;
  winAmountUsdc: string;
  isFreeTicketTier: boolean;
}

export interface EpochWinnerDetailResponse {
  megapotId: number;
  buyer: string;
  tickets: EpochWinnerTicket[];
}

export type WinStatus =
  | 'DRAW_PENDING'
  | 'LOST'
  | 'WON_UNCLAIMED'
  | 'WON_FREE_TICKET'
  | 'CLAIMED_ON_BASE'
  | 'PAID_OUT_ON_SOLANA';

export type OrderStatus =
  | 'SOLANA_CONFIRMED'
  | 'QUEUED'
  | 'DEFERRED'
  | 'PROCESSING'
  | 'BASE_SUBMITTED'
  | 'SUCCESS'
  | 'RETRY_PENDING'
  | 'FAILED_PERMANENT';

export interface UserTicket {
  id: string;
  normalBalls: number[];
  bonusBall: number;
  winStatus: WinStatus;
  winAmountUsdc: string;
  isFreeTicketTier: boolean;
  purchaseEpoch: number;
  fulfillEpoch: number | null;
  orderStatus: OrderStatus;
  purchasedAt: string;
  orderHash: string;
  txSignature: string;
  /** Null until the drawing this ticket fulfills into has settled. */
  epochSettledAt: string | null;
  epochWinningNormals: number[] | null;
  epochWinningBonusBall: number | null;
}

export interface UserTicketsResponse {
  tickets: UserTicket[];
}

export interface ClaimSummaryResponse {
  claimableUsdc: string;
  freeTickets: number;
  totalPaidOutUsdc: string;
  pendingVoucher: {
    amountUsdc: string;
    txSignature: string | null;
    createdAt: string;
  } | null;
}

export interface ClaimVoucherResponse {
  reused: boolean;
  claimId: string;
  amountUsdc: string;
  transactionBase64?: string;
  txSignature: string;
  lastValidBlockHeight?: number;
  note: string;
}

export interface ApiErrorBody {
  error: string;
}

export interface FormatUsdcOptions {
  withSign?: boolean;
  decimals?: 0 | 2;
}