export interface Ticket {
    normals: number[],
    bonusball: number
}

export interface QuoteRequest {
    tickets: Ticket[],
    userSolanaAddress: string,
    referrers: string[],
    referralSplitBps: number[],
}

export interface RoundState {
    normals_max: number,
    bonusball_max: number,
    ended_at: string,
    id: number,
}