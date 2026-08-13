import { ethers } from 'ethers';
import {
  MegapotRoundResponse,
  MegapotRoundsListResponse,
  RoundState,
  TokenAmount,
  DuneMetricsRow,
  DuneQueryResultsResponse,
  FormattedPrizeTier
} from '../types';
import { config } from '../lib/config';
import { prisma } from '../lib/db';
import { redisConnection } from '../lib/redis';
import { solanaService } from './solanaService';
import { baseService } from './baseService';
import { Prisma } from '../../generated/prisma/client';
import { publishEpochSettled } from '../lib/epochEvents';

// Minimal read-only fragment — we don't have Megapot's full ABI checked in
// (only our own vault's, in base_abi/), and this is the only function of
// theirs we ever call.
const MEGAPOT_JACKPOT_MIN_ABI = [
  'function getDrawingTierPayouts(uint256 drawingId) view returns (uint256[12] memory)',
];

// Index 11 = tier 11 = 5 normal matches + bonus match (tierId = 2*normal+bonus)
// — the same jackpot tier used everywhere else this session (settlementWorker,
// Results page). Matches Megapot's own 12-element payout array ordering.
const JACKPOT_TIER_INDEX = 11;

// Same 10% referral win-share as settlementWorker.ts — floor the SHARE, then
// subtract, never floor(gross * 0.9) directly (can differ by 1 unit).
const REFERRAL_WIN_SHARE_BPS = 1_000n;

class MegapotService {
  private tryAfterSec = 1;
  private isSyncing = false;
  private lastRequestTime = 0;
  private transitionInFlight = false;
  private readonly CACHE_KEY = 'megapot-active_round';
  private readonly PAUSE_KEY = 'megapot-is_paused';
  private readonly TRANSITION_LOCK_KEY = 'megapot-transition_lock';
  private readonly PRE_EMPTIVE_BUFFER_MS = (5 * 60 + 60) * 1000; // -> 5 min + 60 sec = 315,000 ms 
  // (2 * 60 + 15) * 1000;

  private toBigInt(amount: TokenAmount): bigint {
    return BigInt(amount.amount);
  }

  /**
   * Megapot's 10% referral win-share, applied the same way everywhere a gross
   * payout amount gets reduced (prize tiers, topPrizeAmount, the on-chain
   * jackpot read): floor the SHARE, then subtract from gross. This is the
   * claim contract's own integer math — NOT floor(gross * 0.9), which
   * truncates at a different point and can be off by 1 unit (e.g.
   * gross=1111112 → correct net=1000001, floor(gross*0.9)=1000000). Confirmed
   * against Megapot's own recorded value.
   */
  private applyReferralShare(gross: bigint): bigint {
    const share = (gross * REFERRAL_WIN_SHARE_BPS) / 10_000n;
    return gross - share;
  }

  /**
   * The displayed prize pool is read directly from Megapot's Jackpot contract
   * on Base (getDrawingTierPayouts), not from the REST API's `prize_pool`
   * field — chain is truth, same principle used everywhere else in this
   * backend. Returns the jackpot tier (index 11) net of the 10% referral
   * win-share, floored to a whole dollar (still 6-decimal-scaled so it drops
   * straight into the existing prizePoolAmount/formatUsdc pipeline unchanged).
   *
   * Reuses baseService's own provider rather than opening a second Base RPC
   * connection — this is a read-only call, never a transaction, so there's
   * no nonce-lane or wallet involvement.
   */
  private async fetchOnChainJackpotUsdc(epochId: number): Promise<bigint> {

    const jackpot = new ethers.Contract(
      "0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2", // -> in production make it : config.base.megapotJackpotAddress
      MEGAPOT_JACKPOT_MIN_ABI,
      baseService.getTempProvider()                 // -> in production make it : baseService.getProvider()      
    );

    const payouts: bigint[] = await jackpot.getDrawingTierPayouts(BigInt(epochId));

    const gross = BigInt(payouts[JACKPOT_TIER_INDEX] ?? 0n);

    const net = this.applyReferralShare(gross);

    // "0 decimals": floor to a whole dollar, expressed back in 6-decimal
    // units (…000000) so every existing consumer (formatUsdc, the frontend's
    // usdcToNumber) keeps working without any changes on their end.
    return (net / 1_000_000n) * 1_000_000n;
  }

  private async fetchDuneMetrics(): Promise<DuneMetricsRow | null> {
    const duneUrl = config.duneUrl;
    const duneApiKey = config.duneApiKey;

    if (!duneUrl || !duneApiKey) {
      console.warn('[SERVICE:dune] Dune URL or API key missing in config. Skipping fetch.');
      return null;
    }

    // Abort request if Dune takes longer than 5 seconds
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(duneUrl, {
        method: 'GET',
        headers: {
          'X-DUNE-API-KEY': duneApiKey,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP status ${response.status} - ${response.statusText}`);
      }

      const data = (await response.json()) as DuneQueryResultsResponse;
      const rows = data.result?.rows;

      if (!rows || rows.length !== 1) {
        throw new Error(`Expected exactly 1 result row from Dune, got ${rows?.length ?? 0}`);
      }

      return rows[0];
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.error('[SERVICE:dune] Dune API request timed out after 5s.');
      } else {
        console.error(`[SERVICE:dune] Failed to fetch metrics: ${err.message}`);
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** STRICT VALIDATION: Ensures active round data is flawless before caching */
  private parseRoundState(data: MegapotRoundResponse): RoundState {

    if (!data) throw new Error('No data provided to parseRoundState');

    if (!data.id || data.status !== 'active') {
      throw new Error(`Invalid active round state: ID ${data.id}, Status: ${data.status}`);
    }

    if (!data.ball_pool?.normals_max || !data.ball_pool?.bonusball_max) {
      throw new Error('Missing or malformed ball_pool configuration');
    }

    if (!data.started_at || !data.ended_at) {
      throw new Error('Missing essential round timestamps');
    }

    if (!data.prize_pool?.amount) {
      throw new Error('Missing prize pool amounts');
    }

    return {
      id: parseInt(String(data.id), 10),
      status: data.status,
      normals_max: data.ball_pool.normals_max,
      bonusball_max: data.ball_pool.bonusball_max,
      started_at: data.started_at,
      ended_at: new Date(new Date(data.ended_at).getTime() + 5 * 60 * 1000).toISOString(), // -> here making it +5 mins
      prize_pool: {
        amount: String(data.prize_pool.amount),
        decimals: data.prize_pool.decimals ?? 6,
      },
      lp_earnings: {
        amount: String(data.lp_earnings?.amount ?? '0'),
        decimals: data.lp_earnings?.decimals ?? 6,
      },
      ticket_count: data.ticket_count ?? 0,
      unique_participants: data.unique_participants ?? 0, 
    };

  }



  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLast = now - this.lastRequestTime;

    if (timeSinceLast < 1000) {
      await new Promise((r) => setTimeout(r, 1000 - timeSinceLast));
    }
    this.lastRequestTime = Date.now();
  }

  private async megapotFetch(path: string): Promise<Response> {
    await this.rateLimit();
    console.log(`[API:megapot] Executing GET request to ${path}`);

    const response = await fetch(`${config.megapot.apiUrl}${path}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${config.megapot.apiKey}` },
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.warn(`[API:megapot] Rate limit exceeded (429) on path: ${path}`);
        throw new Error('RATE_LIMIT_EXCEEDED');
      }
      console.error(`[API:megapot] Request failed: ${response.status} ${response.statusText} for path: ${path}`);
      throw new Error(`Megapot API ${path}: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  private async fetchActiveRoundRaw(): Promise<MegapotRoundResponse> {
    
    console.log(`[SERVICE:megapot] Fetching raw active round data...`);

    return (await this.megapotFetch('/rounds/active').then((r) =>
        r.json()
    )) as MegapotRoundResponse;

    //   return (await fetch('http://localhost:3001/rounds/active').then((r) =>
    //     r.json()
    // )) as MegapotRoundResponse;

    // return (await fetch('https://megapot-mock-api.onrender.com/rounds/active').then((r) =>
    //     r.json()
    // )) as MegapotRoundResponse;
  }

  private async fetchRoundById(megapotId: number): Promise<MegapotRoundResponse> {
    
    console.log(`[SERVICE:megapot] Fetching historical round data for Epoch ID: ${megapotId}`);

    return (await this.megapotFetch(`/rounds/${megapotId}`).then((r) =>
        r.json()
    )) as MegapotRoundResponse;

    // return (await fetch(`http://localhost:3001/rounds/${megapotId}`).then((r) =>
    //   r.json()
    // )) as MegapotRoundResponse;

  // return (await fetch(`https://megapot-mock-api.onrender.com/rounds/${megapotId}`).then((r) =>
  //   r.json()
  // )) as MegapotRoundResponse;
  }

  private async syncProtocolState(data: MegapotRoundResponse, isPaused: boolean) {

    const currentEpochId = parseInt(String(data.id), 10);
    console.log(`[DATABASE] Syncing ProtocolState singleton for Epoch ID: ${currentEpochId} (Paused: ${isPaused})`);

    // Fetch existing DB state upfront to use as rock-solid fallback values
    const existingState = await prisma.protocolState.findUnique({ where: { id: 'singleton' } });

    // 1. Fetch On-Chain Jackpot USDC (with fallback)
    let prizePoolAmount: bigint;

    try {
      prizePoolAmount = await this.fetchOnChainJackpotUsdc(currentEpochId); 
      // -> prizePoolAmount = 200_000_000_000n;
    } catch (err) {
      console.error(`[ALERT][SERVICE:megapot] On-chain jackpot read failed for Epoch ${currentEpochId} — retaining fallback.`, err);
      prizePoolAmount = existingState?.prizePoolAmount ?? this.toBigInt(data.prize_pool);
    }

    // -> uncomment it after making sure it runs just once a day or else dune api credit limit is gonna be done
    let jackpotsWon: number = 19;
    let prizesWon: bigint = BigInt(86000);
    // // 2. Fetch Dune Analytics Data (with fallback)
    // let jackpotsWon: number = existingState?.jackpotsWon ?? 0;
    // let prizesWon: bigint = existingState?.prizesWon ?? BigInt(0);

    // const duneRow = await this.fetchDuneMetrics();

    // if (duneRow) {
    //   // Safely parse Dune string literals to native numbers and BigInts
    //   if (duneRow.jackpots_won !== undefined && duneRow.jackpots_won !== null) {
    //     jackpotsWon = Number(duneRow.jackpots_won);
    //   }
    //   if (duneRow.prizes_won !== undefined && duneRow.prizes_won !== null) {
    //     prizesWon = BigInt(duneRow.prizes_won);
    //   }

    //   console.log(`[SERVICE:dune] Successfully synced metrics: Jackpots Won = ${jackpotsWon}, Prizes Won = ${prizesWon.toString()}`);
    // } else {
    //   console.warn(`[SERVICE:dune] Retaining previous singleton stats: Jackpots Won = ${jackpotsWon}, Prizes Won = ${prizesWon.toString()}`);
    // }

    // 3. Atomic Database Upsert
    const updatePayload = {
      isPaused,
      currentEpochId,
      endedAt: new Date(new Date(data.ended_at).getTime() + 5 * 60 * 1000), // -> added +5 Mins
      maxNormalBall: data.ball_pool.normals_max,
      maxBonusBall: data.ball_pool.bonusball_max,
      prizePoolAmount,
      prizesWon,
      jackpotsWon,
    };

    await prisma.protocolState.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        ...updatePayload,
      },
      update: updatePayload,
    });
  }

  private async processActiveRound(data: MegapotRoundResponse): Promise<void> {

    console.log(`[SERVICE:megapot] Parsing and validating active round payload...`);

    const parsedRound: RoundState = this.parseRoundState(data);

    const isPaused = (await redisConnection.get(this.PAUSE_KEY)) === 'true';

    console.log(`[CACHE] Updating active round state in Redis (${this.CACHE_KEY})`);
    await redisConnection.set(this.CACHE_KEY, JSON.stringify(parsedRound));

    await this.syncProtocolState(data, isPaused);
  }

  /**
   * Processes the raw tiers to:
   * 1. Remove Tier 0 (0 normals, false bonus)
   * 2. Apply the 10% referral win-share reduction to all payout amounts, via
   *    applyReferralShare (floor the SHARE, then subtract — matches Megapot's
   *    own recorded net value; floor(gross*0.9) can be off by 1 unit)
   * 3. Calculate the total sum paid out across all valid tiers
   * 4. Extract the exact Jackpot value (Tier 11)
   */
  private processPrizeTiers(tiers: MegapotRoundResponse['prize_tiers']): {
    totalPaidAmount: bigint;
    jackpot: bigint;
    formattedPrizeTiers: FormattedPrizeTier[];
  } {
    let totalPaidAmount = 0n;
    let jackpot = 0n;
    const formattedPrizeTiers: FormattedPrizeTier[] = [];

    if (!tiers) {
      return { totalPaidAmount, jackpot, formattedPrizeTiers };
    }

    for (const tier of tiers) {
      // 1. Skip Tier 0 (No normals, no bonus)
      if (tier.tier_id === 0) continue;

      // 2. Apply the 10% referral win-share reduction — see applyReferralShare.
      const rawAmount = BigInt(tier.payout.amount);
      const reducedAmount = this.applyReferralShare(rawAmount);

      // 3. Add to total sum (Amount * Ticket Count)
      const tierTotal = rawAmount * BigInt(tier.ticket_count);
      totalPaidAmount += tierTotal;

      // 4. Capture the jackpot if it's tier 11
      if (tier.tier_id === 11) {
        jackpot = reducedAmount;
      }

      // 5. Push formatted clean data for the JSON column
      formattedPrizeTiers.push({
        tierId: tier.tier_id,
        amount: reducedAmount.toString(), // Convert to string for safe JSON storage
        ticketCount: tier.ticket_count,
      });
    }

    return { totalPaidAmount, jackpot, formattedPrizeTiers };
  }

  private async upsertSettledEpoch(data: MegapotRoundResponse): Promise<void> {
    if (data.status !== 'settled') return;
    if (!data.top_prize_amount || !data.winning_numbers || !data.prize_tiers) {
      console.warn(`[SERVICE:megapot] Epoch ${data.id} settled but missing drawing data — skipping DB upsert`);
      return;
    }

    const megapotId = parseInt(String(data.id), 10);
    console.log(`[DATABASE] Upserting settled Epoch ${megapotId} into MegapotEpoch table...`);

    const normalMax = data.ball_pool?.normals_max ?? null;
    const bonusMax = data.ball_pool?.bonusball_max ?? null;
    const drawnAt = data.settled_at ? new Date(data.settled_at) : null;
    const endedAt = data.ended_at
    ? new Date(new Date(data.ended_at).getTime() + this.EPOCH_END_UI_BUFFER_MS)
    : null;

    // Process tiers: calculate totals and format the exact JSON we want to store
    const { totalPaidAmount, jackpot, formattedPrizeTiers } = this.processPrizeTiers(data.prize_tiers);

    // Also apply the same referral-share reduction to topPrizeAmount so it
    // matches the jackpot/tier logic exactly (see applyReferralShare).
    const rawTopPrize = this.toBigInt(data.top_prize_amount);
    const topPrizeAmount = this.applyReferralShare(rawTopPrize);

    const upsertPayload = {
      lordsPotTicketCount: 20,
      totalTicketCount: data.ticket_count,
      
      lordsPotWinnersCount: 20,
      totalWinnersCount: data.winners_count,

      totalPaidAmount,
      lordsPotPaidAmount: BigInt(20e6),

      jackpot,
      prizeTiers: formattedPrizeTiers as unknown as Prisma.InputJsonValue,

      topPrizeAmount,
      topPrizeWinnersCount: data.top_prize_winners_count,
      winningNormals: data.winning_numbers.normals,
      winningBonusBall: data.winning_numbers.bonusball,

      normalMax,
      bonusMax,
      drawnAt,
      endedAt,
    };

    await prisma.megapotEpoch.upsert({
      where: { megapotId },
      create: {
        megapotId,
        ...upsertPayload,
      },
      update: upsertPayload,
    });
  }

  private async syncAllSettledRounds(): Promise<void> {

    const limit = 100;
    let cursor: string | undefined;
    let has_more: boolean = true;
    let totalSynced = 0;

    try {
      // 1. Get the highest known ID in ONE single query.
      const latestEpoch = await prisma.megapotEpoch.findFirst({
        orderBy: { megapotId: "desc" },
        select: { megapotId: true },
      });

      // If DB is empty, set to 0 so EPOCH 1 syncs.
      const highestDbId = latestEpoch?.megapotId ?? 0; 
      console.log(`[SERVICE:megapot] DB max Epoch is ${highestDbId}. Initiating backwards sync...`);

      while (has_more) {

        const params = new URLSearchParams({ limit: limit.toString() });
        if (cursor) params.set("cursor", cursor);

        const response = await this.megapotFetch(`/rounds?${params.toString()}`);

        // const response = await fetch(`http://localhost:3001/rounds?${params.toString()}`);

        // const response = await fetch(`https://megapot-mock-api.onrender.com/rounds?${params.toString()}`);


        const body = (await response.json()) as MegapotRoundsListResponse;

        if (!body.data?.length) break;

        let dbIsCaughtUp = false;

        for (const round of body.data) {

          if (round.status === 'active') {
            await this.processActiveRound(round);
            continue;
          }

          if (round.status === 'settled') {
            const megapotId = parseInt(String(round.id), 10);

            // 2. The Instant Halt Condition
            // Since the DB has no gaps, if the API gives us an ID we already
            // have (or lower), we are guaranteed to have everything below it too.
            if (megapotId <= highestDbId) {
              console.log(`[DATABASE] Sync intersection reached at Epoch ${megapotId}. Halting historical sync.`);
              dbIsCaughtUp = true;
              break;
            }

            // 3. Upsert ONLY if it's strictly greater than highestDbId
            await this.upsertSettledEpoch(round);
            totalSynced++;
          }

        }

        if (dbIsCaughtUp) break;
        if (!body.has_more || !body.next_cursor) break;

        has_more = body.has_more;
        cursor = body.next_cursor;
      }

      console.log(`[SERVICE:megapot] Backfill complete. Synchronized ${totalSynced} missing epochs.`);
    } catch (err: any) {
        if (err.message === 'RATE_LIMIT_EXCEEDED') {
          console.warn(`[API:megapot] Rate limit hit during massive backfill. Will resume on next cycle.`);
        } else {
          console.warn(`[SERVICE:megapot] Settled rounds list sync failed (non-fatal):`, err);
        }
    }
  }

  /**
   * On-demand fetch + persist of ONE settled epoch — used by the settlement
   * worker to heal gaps (server down across a rollover, drawing data posted
   * late). Safe no-op if the round isn't settled or drawing data is missing:
   * upsertSettledEpoch() refuses those, so this can never store a live round.
   */
  public async ensureSettledEpochSynced(megapotId: number): Promise<boolean> {
    try {
      const round = await this.fetchRoundById(megapotId);
      await this.upsertSettledEpoch(round);
    } catch (err: any) {
      console.warn(`[SERVICE:megapot] On-demand sync of epoch ${megapotId} failed (will retry next settlement tick):`, err?.message ?? err);
    }
    return (await prisma.megapotEpoch.count({ where: { megapotId } })) > 0;
  }

  /**
   * The UI-facing buffer baked directly into MegapotEpoch.endedAt at write
   * time (see upsertSettledEpoch) — the stored value is already real
   * ended_at + this buffer, not the raw round-end time. Every reveal-gate
   * below therefore just compares `endedAt` straight against `now`, no
   * separate buffer arithmetic layered on top (that used to double-count
   * the buffer — endedAt was already padded, then another REVEAL_BUFFER_MS
   * was subtracted again on top when checking it, so reveal actually only
   * ever fired at ended_at + 20min instead of +10min).
   *
   * Must stay in sync with the live round's own ended_at padding above (the
   * `// ->` +5min lines in parseRoundState/syncProtocolState) — otherwise a
   * ticket's countdown target jumps the moment its epoch settles, since the
   * live nextDrawAt and this value would no longer agree. Currently 2min for
   * fast local testing; flip to 10min alongside those two lines before a
   * real deploy.
   */
  private readonly EPOCH_END_UI_BUFFER_MS = 5 * 60 * 1000;

  /**
   * Epochs whose padded endedAt hasn't passed yet stay fully hidden from
   * every results/tickets/claims surface — even though settlement and harvest
   * may already be done in the background. Keeps "everything updates at once"
   * a real, honest promise instead of results trickling in as each backend
   * step happens to finish. Epochs with no endedAt (rows written before this
   * field existed) are treated as already revealed, not permanently hidden.
   */
  public async getRevealedEpochIds(): Promise<Set<number>> {
    const rows = await prisma.megapotEpoch.findMany({
      where: { OR: [{ endedAt: null }, { endedAt: { lte: new Date() } }] },
      select: { megapotId: true },
    });
    return new Set(rows.map((r) => r.megapotId));
  }

  /** Same gate as getRevealedEpochIds(), as a Prisma where-fragment — for
   * routes that query MegapotEpoch directly rather than needing the id set. */
  public revealedEpochWhere() {
    return { OR: [{ endedAt: null }, { endedAt: { lte: new Date() } }] };
  }

  /** Same gate, checked for one specific epoch — for routes keyed by megapotId
   * (e.g. a single epoch's winner breakdown) rather than listing/aggregating. */
  public async isEpochRevealed(megapotId: number): Promise<boolean> {
    const epoch = await prisma.megapotEpoch.findUnique({
      where: { megapotId },
      select: { endedAt: true },
    });
    if (!epoch) return false;
    if (!epoch.endedAt) return true;
    return epoch.endedAt.getTime() <= Date.now();
  }

  public async getRoundState(): Promise<RoundState | null> {
    const data = await redisConnection.get(this.CACHE_KEY);
    if (!data) return null;
    return JSON.parse(data) as RoundState;
  }

  public async getActiveRound(): Promise<RoundState> {
    const round = await this.getRoundState();
    if (!round) {
      console.error(`[CACHE] Fatal: Requested active round, but cache is empty.`);
      throw new Error('No active Megapot round in cache — run startSync()');
    }
    return round;
  }

  public isRoundLocked(round: RoundState): boolean {
    const endMs = new Date(round.ended_at).getTime();
    return Date.now() >= endMs - this.PRE_EMPTIVE_BUFFER_MS; // * 10 mins + 15 secs
  }

  public async isProtocolPaused(): Promise<boolean> {
    if ((await redisConnection.get(this.PAUSE_KEY)) === 'true') return true;

    const protocol = await prisma.protocolState.findUnique({
      where: { id: 'singleton' },
    });
    return protocol?.isPaused ?? false;
  }

  private async setPaused(paused: boolean) {
    console.log(`[SERVICE:megapot] Setting protocol global pause state to: ${paused}`);
    await redisConnection.set(this.PAUSE_KEY, paused ? 'true' : 'false');
    await prisma.protocolState.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', isPaused: paused },
      update: { isPaused: paused },
    });
  }

  /** Self-healing half of the pause cache: re-derives it from the real on-chain flag,
 * so ANY out-of-band pause/unpause (anchor migrate, a manual script, anything that
 * isn't this backend's own transitionLoop) can't leave Redis/Postgres stale. */
public async syncPauseStateFromChain(): Promise<void> {
  const onChain = await solanaService.getOnChainState();
  const cached = await this.isProtocolPaused();
  if (onChain.isLordsPotPaused !== cached) {
    console.warn(`[SERVICE:megapot] Pause state drift detected — chain=${onChain.isLordsPotPaused}, cache=${cached}. Resyncing.`);
    await this.setPaused(onChain.isLordsPotPaused);
  }
}

  /**
   * Crash-proof entry point for the transition. transitionLoop() can throw
   * (RPC failures inside catch blocks etc.) — an unhandled rejection out of a
   * bare setTimeout would kill the whole process while the protocol is PAUSED
   * on-chain. This wrapper catches everything and reschedules instead.
   */
  private async safeTransition(): Promise<void> {
    if (this.transitionInFlight) return;
    this.transitionInFlight = true;
    try {
      const handled = await this.transitionLoop();
      if (!handled) {
        console.error(`[CRON:transition] Transition aborted — retrying in 30s.`);
        setTimeout(() => void this.safeTransition(), 30_000);
      }
    } catch (err) {
      console.error(`[CRON:transition] Transition crashed — retrying in 30s.`, err);
      setTimeout(() => void this.safeTransition(), 30_000);
    } finally {
      this.transitionInFlight = false;
    }
  }

  /**
   * Heartbeat for the cron process: derives "should we be transitioning?" from
   * the Redis-cached round instead of trusting an in-memory setTimeout that
   * dies on every restart/redeploy. Safe to call every tick — the due-check and
   * the distributed lock make it idempotent across processes.
   */
  public async checkEpochTransition(): Promise<void> {
    const round = await this.getRoundState();
    if (!round) return;
    if (Date.now() >= new Date(round.ended_at).getTime() - this.PRE_EMPTIVE_BUFFER_MS) { // * 10 mins + 15 secs
      console.log(`[CRON:heartbeat] Epoch ${round.id} is due — ensuring transition runs.`);
      await this.safeTransition();
    }
  }

  /**
   * Pause → wait for Megapot rollover → resume.
   * Returns true when handled (completed, not due, or owned by another process),
   * false when aborted so safeTransition() schedules a retry.
   */
  private async transitionLoop(): Promise<boolean> {
    console.log(`\n[CRON:transition] Epoch Transition Sequence Initiated!`);

    // Due-check: protects against stale timers / heartbeat re-entry firing
    // after another process already completed the transition. Without this,
    // a late timer would PAUSE the protocol mid-epoch.
    let current = await this.getRoundState();

    // Self-heal: an empty cache here almost always means Redis lost its data
    // independently of this process (e.g. a free-tier Redis restart wiping a
    // non-persistent instance) rather than the round genuinely being gone —
    // rebuild it from Megapot's API before giving up, same fetch this app
    // already trusts elsewhere (ensureActiveRoundCached, used post-transition).
    if (!current) {
      console.warn(`[CACHE] Active round missing from cache — attempting to rebuild from Megapot's API before aborting.`);
      try {
        current = await this.ensureActiveRoundCached();
      } catch (err) {
        console.error(`[CACHE] Rebuild failed — cannot proceed with transition.`, err);
        return false;
      }
    }

    if (
      current &&
      Date.now() < new Date(current.ended_at).getTime() - this.PRE_EMPTIVE_BUFFER_MS // * 10 mins + 15 secs
    ) {
      console.log(`[CRON:transition] Cached round ${current.id} is not due yet — nothing to do.`);
      return true;
    }

    if (!current) {
      console.error(`[CACHE] Cannot proceed with transition: No active round found in cache.`);
      return false;
    }

    // Distributed lock: API timer and cron heartbeat may both fire — exactly
    // one proceeds. Renewed inside the wait loop for multi-hour Megapot outages.
    const lock = await redisConnection.set(
      this.TRANSITION_LOCK_KEY, String(process.pid), 'EX', 600, 'NX' // EX stands for secs, 600 secs is 10 mins, and NX represents only add if not present
    );

    if (lock === null) {
      console.log(`[CRON:transition] Another process holds the transition lock — skipping.`);
      return true;
    }

    try {
      try {
        console.log(`[CHAIN:solana] Broadcasting pause transaction to Solana smart contract...`);
        await solanaService.pauseProtocol();
        await this.setPaused(true);
        console.log(`[CHAIN:solana] Protocol successfully paused on-chain.`);
      } catch (error) {
        console.warn(`[CHAIN:solana] Pause tx failed or timed out. Verifying on-chain state...`, error);
        const onChain = await solanaService.getOnChainState();
        if (!onChain.isLordsPotPaused) {
          console.error(`[CHAIN:solana] CRITICAL FAILURE: Protocol is NOT paused on-chain. Aborting transition.`);
          return false;
        }
        console.log(`[CHAIN:solana] Protocol verified paused on-chain despite tx timeout.`);
        await this.setPaused(true);
      }

      // Wait for Megapot to roll over. The protocol stays PAUSED the entire
      // time — that is intended (a dead Megapot must never receive relays).
      // We poll at a fixed 10s interval, alert loudly, and NEVER abandon:
      // only this loop can resume the protocol, so giving up = paused forever.
      let consecutiveFailures = 0;
      const POLL_DELAY_MS = 10_000;
      const waitStart = Date.now();
      let lastStuckAlertAt = 0;

      console.log(`[SERVICE:megapot] Awaiting Megapot API to roll over to the next Epoch...`);

      while (true) {
        
        await redisConnection.expire(this.TRANSITION_LOCK_KEY, 600).catch(() => {});

        try {

          const fetchedRaw = await this.fetchActiveRoundRaw();
          consecutiveFailures = 0;
          const fetchedIdNum = parseInt(String(fetchedRaw.id), 10);
          const nextEpochBigInt = BigInt(fetchedRaw.id);

          if (fetchedIdNum > current.id) {
            console.log(`[SERVICE:megapot] Success! Megapot API rolled over to new Epoch: ${fetchedIdNum}`);

            try {
              console.log(`[SERVICE:megapot] Fetching settlement data for concluded Epoch: ${current.id}`);
              const settledRound = await this.fetchRoundById(current.id);
              await this.upsertSettledEpoch(settledRound);

              // Cross-process nudge (Redis pub/sub) so settlement reacts to
              // this epoch immediately instead of waiting up to 60s for its
              // next poll — works regardless of whether settlement/harvest
              // run in this same process or a separate worker process.
              publishEpochSettled(current.id);
            } catch (err) {
              console.warn(`[SERVICE:megapot] Could not fetch settled epoch ${current.id} during transition. Will backfill later.`, err);
            }

            const onChain = await solanaService.getOnChainState();

            if (!onChain.isLordsPotPaused) {
              console.log(`[CHAIN:solana] Warning: Protocol already unpaused on-chain (Phantom unpause). Recovering state...`);
              await this.processActiveRound(fetchedRaw);
              await this.setPaused(false);
              break;
            }

            const needsUpdate =
                fetchedRaw.ball_pool.bonusball_max !== onChain.bonusMax ||
                fetchedRaw.ball_pool.normals_max !== onChain.normalMax;

            console.log(`[CHAIN:solana] Broadcasting resumeAndTransitionEpoch to Solana (Config Update: ${needsUpdate})...`);
            await solanaService.resumeAndTransitionEpoch(
                fetchedRaw.ball_pool.normals_max,
                fetchedRaw.ball_pool.bonusball_max,
                needsUpdate,
                nextEpochBigInt
            );

            console.log(`[CHAIN:solana] Protocol successfully resumed for Epoch ${fetchedIdNum}.`);
            await this.processActiveRound(fetchedRaw);
            await this.setPaused(false);
            break;
          }

          console.log(`[SERVICE:megapot] Still returning old Epoch (${fetchedIdNum}). Waiting ${Math.round(POLL_DELAY_MS / 1000)}s before retry...`);

          // Alert path: Megapot stuck (e.g. Base outage). Stay paused — but scream.
          const stuckMs = Date.now() - waitStart;
          if (stuckMs > 10 * 60_000 && Date.now() - lastStuckAlertAt > 5 * 60_000) {
            console.error(`[ALERT] Megapot has not rolled over for ${Math.round(stuckMs / 60_000)} min. Protocol remains PAUSED (intended). Check Megapot/Base status!`);
            lastStuckAlertAt = Date.now();
          }
          
        } catch (error) {
          consecutiveFailures++;
          console.error(`[SERVICE:megapot] Transition API fetch attempt ${consecutiveFailures} failed:`, error);
          if (consecutiveFailures % 10 === 0) {
            console.error(`[ALERT] Megapot API unreachable for ${consecutiveFailures} consecutive attempts. Protocol remains PAUSED — still retrying, will NOT abandon.`);
          }
        } finally {
          await new Promise((r) => setTimeout(r, POLL_DELAY_MS));
        }
      }

      console.log(`[CRON:transition] Transition Sequence Complete. Preparing next Cron job.`);
      await this.setupNextFetchCron();
      return true;

    } finally {
      await redisConnection.del(this.TRANSITION_LOCK_KEY).catch(() => {});
    }

  }

  private async ensureActiveRoundCached(): Promise<RoundState> {
    const existing = await this.getRoundState();
    if (existing?.ended_at && existing.id) return existing;

    console.log(`[CACHE] Active round missing or malformed — forcing fresh fetch from /rounds/active`);
    const raw = await this.fetchActiveRoundRaw();
    await this.processActiveRound(raw);

    const saved = await this.getRoundState();
    if (!saved?.ended_at || !saved.id) {
      throw new Error('Failed to cache active Megapot round after fetch');
    }
    return saved;
  }

  private async setupNextFetchCron() {

    let saved: RoundState;

    try {
      saved = await this.ensureActiveRoundCached();
    } catch (err) {
      console.error(`[CRON:setup] Cannot schedule epoch cron — failed to retrieve active round.`, err);
      return;
    }

    const diffMs =
        new Date(saved.ended_at).getTime() -
        Date.now() -
        this.PRE_EMPTIVE_BUFFER_MS; // * 10 mins + 15 secs

    if (diffMs <= 0) {
      console.log(`[CRON:setup] WARNING: Time buffer expired! In danger zone — triggering immediate transition loop.`);
      await this.safeTransition();
    } else {
      console.log(`[CRON:setup] Active Epoch ${saved.id} ends at ${new Date(saved.ended_at).toISOString()}. Scheduling transition cron in ${Math.round(diffMs / 1000)} seconds.`);
      // safeTransition (not transitionLoop) — a rejection here would otherwise
      // be an unhandled promise rejection and crash the process mid-pause.
      setTimeout(() => void this.safeTransition(), diffMs);
    }
  }

  /**
   * Boot-time on-chain epoch reconciliation — runs before any other sync
   * work, on every boot, unconditionally. If this process (or its transition
   * loop) was stuck or down while Megapot kept rolling rounds forward, the
   * on-chain epoch can be left far behind the real current round — meaning
   * newly bought tickets would carry a stale epoch number that can never
   * correctly settle (worst case: it matches an already-decided historical
   * round with publicly known winning numbers — exactly the gap this closes).
   * A no-op when on-chain already matches or leads the real current round.
   */
  private async reconcileOnChainEpochAtBoot(): Promise<void> {
    console.log(`[SERVICE:megapot] Phase 0: Verifying on-chain epoch matches Megapot's real current round...`);

    try {
      const onChain = await solanaService.getOnChainState();
      const raw = await this.fetchActiveRoundRaw();
      const realCurrentId = BigInt(String(raw.id));
      const onChainEpoch = BigInt(onChain.ongoingEpoch.toString());

      if (onChainEpoch >= realCurrentId) {
        console.log(`[SERVICE:megapot] On-chain epoch (${onChainEpoch}) already matches or exceeds the real current round (${realCurrentId}) — no boot catch-up needed.`);
        return;
      }

      console.warn(`[SERVICE:megapot] On-chain epoch (${onChainEpoch}) is behind Megapot's real current round (${realCurrentId}) — forcing catch-up before anything else runs.`);

      const lock = await redisConnection.set(
        this.TRANSITION_LOCK_KEY, String(process.pid), 'EX', 600, 'NX'
      );
      if (lock === null) {
        console.log(`[SERVICE:megapot] Another process already holds the transition lock — skipping boot reconciliation, already being handled.`);
        return;
      }

      try {
        if (!onChain.isLordsPotPaused) {
          console.log(`[CHAIN:solana] Pausing protocol for boot-time epoch catch-up...`);
          await solanaService.pauseProtocol();
          await this.setPaused(true);
        }

        const needsUpdate =
          raw.ball_pool.normals_max !== onChain.normalMax ||
          raw.ball_pool.bonusball_max !== onChain.bonusMax;

        console.log(`[CHAIN:solana] Broadcasting resumeAndTransitionEpoch to catch on-chain epoch up to ${realCurrentId} (Config Update: ${needsUpdate})...`);
        await solanaService.resumeAndTransitionEpoch(
          raw.ball_pool.normals_max,
          raw.ball_pool.bonusball_max,
          needsUpdate,
          realCurrentId
        );

        await this.processActiveRound(raw);
        await this.setPaused(false);
        console.log(`[SERVICE:megapot] On-chain epoch successfully caught up to ${realCurrentId}.`);
      } finally {
        await redisConnection.del(this.TRANSITION_LOCK_KEY).catch(() => {});
      }
    } catch (err) {
      // Deliberately swallowed: a failed boot catch-up must not prevent the
      // rest of the app from starting (webhook processing, etc.) — the
      // regular transition heartbeat keeps retrying this independently,
      // same as any other missed transition.
      console.error(`[SERVICE:megapot] Boot-time epoch catch-up failed — protocol may remain paused until the next transition heartbeat retries it.`, err);
    }
  }

  public async startSync() {

    if (this.isSyncing) {
      console.log(`[SERVICE:megapot] Sync already in progress, skipping startSync() invocation.`);
      return;
    }

    this.isSyncing = true;
    console.log(`\n[SERVICE:megapot] ==== BOOTING MEGAPOT SYNC ENGINE ====`);

    try {
      await this.reconcileOnChainEpochAtBoot();

      console.log(`[SERVICE:megapot] Phase 1: Backfilling historical epochs...`);
      await this.syncAllSettledRounds();
      
      console.log(`[SERVICE:megapot] Phase 2: Bootstrapping active round and cron timers...`);
      await this.setupNextFetchCron();
      
      this.tryAfterSec = 1;
      this.isSyncing = false;

      console.log(`[SERVICE:megapot] ==== ENGINE BOOT SEQUENCE COMPLETE ====`);

    } catch (error) {

      console.error(`[SERVICE:megapot] FATAL ERROR during startSync:`, error);

      this.tryAfterSec = Math.min(this.tryAfterSec * 2, 300);

      console.log(`[SERVICE:megapot] Engine boot failed. Retrying in ${this.tryAfterSec} seconds...`);
      
      setTimeout(() => {
        this.isSyncing = false;
        void this.startSync();
      }, this.tryAfterSec * 1000);

    }
  }
}

export const megapotService = new MegapotService();