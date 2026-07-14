import {
  MegapotRoundResponse,
  MegapotRoundsListResponse,
  RoundState,
  TokenAmount,
} from '../types';
import { config } from '../lib/config';
import { prisma } from '../lib/db';
import { redisConnection } from '../lib/redis';
import { solanaService } from './solanaService';
import { Prisma } from '../../generated/prisma/client';

class MegapotService {
  private tryAfterSec = 1;
  private isSyncing = false;
  private lastRequestTime = 0;
  private transitionInFlight = false;
  private readonly CACHE_KEY = 'megapot-active_round';
  private readonly PAUSE_KEY = 'megapot-is_paused';
  private readonly TRANSITION_LOCK_KEY = 'megapot-transition_lock';
  private readonly PRE_EMPTIVE_BUFFER_MS = 60 * 1000;

  private toBigInt(amount: TokenAmount): bigint {
    return BigInt(amount.amount);
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
      ended_at: data.ended_at,
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
  //   return (await fetch('http://localhost:3000/rounds/active').then((r) =>
  //     r.json()
  // )) as MegapotRoundResponse;
  }

  private async fetchRoundById(megapotId: number): Promise<MegapotRoundResponse> {
    
    console.log(`[SERVICE:megapot] Fetching historical round data for Epoch ID: ${megapotId}`);

    return (await this.megapotFetch(`/rounds/${megapotId}`).then((r) =>
        r.json()
    )) as MegapotRoundResponse;

  //   return (await fetch(`http://localhost:3000/rounds/${megapotId}`).then((r) =>
  //     r.json()
  // )) as MegapotRoundResponse;
  }

  private async syncProtocolState(data: MegapotRoundResponse, isPaused: boolean) {

    const currentEpochId = parseInt(String(data.id), 10);
    console.log(`[DATABASE] Syncing ProtocolState singleton for Epoch ID: ${currentEpochId} (Paused: ${isPaused})`);

    await prisma.protocolState.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        isPaused,
        currentEpochId,
        endedAt: new Date(data.ended_at),
        maxNormalBall: data.ball_pool.normals_max,
        maxBonusBall: data.ball_pool.bonusball_max,
        prizePoolAmount: this.toBigInt(data.prize_pool),
      },
      update: {
        isPaused,
        currentEpochId,
        endedAt: new Date(data.ended_at),
        maxNormalBall: data.ball_pool.normals_max,
        maxBonusBall: data.ball_pool.bonusball_max,
        prizePoolAmount: this.toBigInt(data.prize_pool),
      },
    });
  }

  private async processActiveRound(data: MegapotRoundResponse): Promise<void> {

    console.log(`[SERVICE:megapot] Parsing and validating active round payload...`);

    console.log("-->> BEFORE :", data);
    const parsedRound: RoundState = this.parseRoundState(data);
    console.log("-->> AFTER :", parsedRound);

    const isPaused = (await redisConnection.get(this.PAUSE_KEY)) === 'true';

    console.log(`[CACHE] Updating active round state in Redis (${this.CACHE_KEY})`);
    await redisConnection.set(this.CACHE_KEY, JSON.stringify(parsedRound));

    await this.syncProtocolState(data, isPaused);
  }

  private async upsertSettledEpoch(data: MegapotRoundResponse): Promise<void> {

    if (data.status !== 'settled') return;
    if (!data.top_prize_amount || !data.winning_numbers || !data.prize_tiers) {
      console.warn(`[SERVICE:megapot] Epoch ${data.id} settled but missing drawing data — skipping DB upsert`);
      return;
    }

    const megapotId = parseInt(String(data.id), 10);
    console.log(`[DATABASE] Upserting settled Epoch ${megapotId} into MegapotEpoch table...`);

    await prisma.megapotEpoch.upsert({
      where: { megapotId },
      create: {
        megapotId,
        ticketCount: data.ticket_count,
        uniqueParticipants: data.unique_participants,
        winnersCount: data.winners_count,
        topPrizeAmount: this.toBigInt(data.top_prize_amount),
        topPrizeWinnersCount: data.top_prize_winners_count,
        lpEarningsAmount: this.toBigInt(data.lp_earnings),
        winningNormals: data.winning_numbers.normals,
        winningBonusBall: data.winning_numbers.bonusball,
        prizeTiers: data.prize_tiers as unknown as Prisma.InputJsonValue,
      },
      update: {
        ticketCount: data.ticket_count,
        uniqueParticipants: data.unique_participants,
        winnersCount: data.winners_count,
        topPrizeAmount: this.toBigInt(data.top_prize_amount),
        topPrizeWinnersCount: data.top_prize_winners_count,
        lpEarningsAmount: this.toBigInt(data.lp_earnings),
        winningNormals: data.winning_numbers.normals,
        winningBonusBall: data.winning_numbers.bonusball,
        prizeTiers: data.prize_tiers as unknown as Prisma.InputJsonValue,
      },
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
        // const response = await fetch(`http://localhost:3000/rounds?${params.toString()}`);

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
    return Date.now() >= endMs - this.PRE_EMPTIVE_BUFFER_MS;
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
    if (Date.now() >= new Date(round.ended_at).getTime() - this.PRE_EMPTIVE_BUFFER_MS) {
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
    const current = await this.getRoundState();

    if (
      current &&
      Date.now() < new Date(current.ended_at).getTime() - this.PRE_EMPTIVE_BUFFER_MS
    ) {
      console.log(`[CRON:transition] Cached round ${current.id} is not due yet — nothing to do.`);
      return true;
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

      const oldData = await this.getRoundState();
      if (!oldData) {
        console.error(`[CACHE] Cannot proceed with transition: No active round found in cache.`);
        return false;
      }

      // Wait for Megapot to roll over. The protocol stays PAUSED the entire
      // time — that is intended (a dead Megapot must never receive relays).
      // We poll with backoff (2s → 60s cap), alert loudly, and NEVER abandon:
      // only this loop can resume the protocol, so giving up = paused forever.
      let consecutiveFailures = 0;
      let pollDelayMs = 2_000;
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

          if (fetchedIdNum > oldData.id) {
            console.log(`[SERVICE:megapot] Success! Megapot API rolled over to new Epoch: ${fetchedIdNum}`);

            try {
              console.log(`[SERVICE:megapot] Fetching settlement data for concluded Epoch: ${oldData.id}`);
              const settledRound = await this.fetchRoundById(oldData.id);
              await this.upsertSettledEpoch(settledRound);
            } catch (err) {
              console.warn(`[SERVICE:megapot] Could not fetch settled epoch ${oldData.id} during transition. Will backfill later.`, err);
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

          console.log(`[SERVICE:megapot] Still returning old Epoch (${fetchedIdNum}). Waiting ${Math.round(pollDelayMs / 1000)}s before retry...`);

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
          await new Promise((r) => setTimeout(r, pollDelayMs));
          pollDelayMs = Math.min(Math.round(pollDelayMs * 1.5), 60_000);
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
        this.PRE_EMPTIVE_BUFFER_MS;

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

  public async startSync() {
    
    if (this.isSyncing) {
      console.log(`[SERVICE:megapot] Sync already in progress, skipping startSync() invocation.`);
      return;
    }

    this.isSyncing = true;
    console.log(`\n[SERVICE:megapot] ==== BOOTING MEGAPOT SYNC ENGINE ====`);

    try {
      
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