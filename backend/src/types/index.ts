export interface Ticket {
  normals: number[];
  bonusball: number;
}

export interface QuoteRequest {
  tickets: Ticket[];
  userSolanaAddress: string;
  referrers: string[];
  referralSplitBps: number[];
}

// # MEGAPOT api

/** USDC-style amount from Megapot API */
export interface TokenAmount {
  amount: string;
  decimals: number;
}

export interface WinningNumbers {
  normals: number[];
  bonusball: number;
}

export interface MaxBallLimit {
  normals_max: number;
  bonusball_max: number;
}

export interface PrizeTier {
  tier_id: number;
  normal_matches: number;
  bonusball_match: boolean;
  payout: TokenAmount;
  ticket_count: number;
}

/** Full Megapot round from API (active or settled) */
export interface MegapotRoundResponse {
  id: string;
  status: string;
  prize_pool: TokenAmount;
  ticket_count: number;
  unique_participants: number;
  winners_count: number;
  top_prize_amount: TokenAmount | null;
  top_prize_winners_count: number;
  lp_earnings: TokenAmount;
  started_at: string;
  ended_at: string;
  settled_at: string | null;
  ball_pool: MaxBallLimit;
  winning_numbers: WinningNumbers | null;
  prize_tiers: PrizeTier[] | null;
}

export interface MegapotRoundsListResponse {
  data: MegapotRoundResponse[];
  next_cursor: string;
  has_more: boolean;
}

/** Normalized active round — cached in Redis */
export interface RoundState {
  id: number;
  status: string;
  normals_max: number;
  bonusball_max: number;
  started_at: string;
  ended_at: string;
  prize_pool: TokenAmount;
  lp_earnings: TokenAmount;
  ticket_count: number;
  unique_participants: number;
}
