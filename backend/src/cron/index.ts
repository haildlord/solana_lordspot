import { pollMissedTransactions } from '../services/solanaIndexer';
import { megapotService } from '../services/megapotService';
import { runReconciler } from './reconciler';
import { runVaultMonitor } from './vaultMonitor';
import { runSettlementTick } from '../workers/settlementWorker';

// Was 30s. Nothing in this tick needs that: the missed-purchase poller is a
// safety net for the ~1% of Helius webhooks that never arrive, the reconciler
// unsticks orders that are already stuck, and the epoch heartbeat only exists so
// a restart cannot lose the precisely-scheduled transition timer set at boot.
// At 30s this loop ran 2,880 times a day and did ~6 database queries each time,
// which is the single largest source of idle load in the backend.
//
// The interval is pinned by the EPOCH HEARTBEAT, not by the poller.
//
// checkEpochTransition is a THRESHOLD, not a window: `now >= ended_at - 6min`
// stays true once crossed, so a late tick cannot miss a transition outright —
// it runs it LATE, by up to one interval. That bound is the whole reason this
// number matters.
//
// The cached ended_at is itself padded +5 min past Megapot's real end (see
// parseRoundState), so with a 6 min buffer the transition is due around
// realEnd - 1min. At a 5 minute interval it could therefore fire ~4 minutes
// AFTER the round actually ended — long enough for purchases to land in a dead
// epoch. At 2 minutes the worst case is ~1 minute late.
//
// The heartbeat is also the THIRD job in this tick, running after the Solana RPC
// poller, so a slow RPC adds to that lateness.
//
// If PRE_EMPTIVE_BUFFER_MS shrinks, or the +5 min padding changes, revisit this.
//
// Everything else in the tick is comfortable at 2 minutes: the missed-purchase
// poller is a safety net for the ~1% of webhooks that never arrive (that buyer
// waits up to 2 minutes for tickets instead of 30 seconds), and the reconciler
// unsticks orders that are already stuck.
const POLL_MS = 2 * 60_000;
const VAULT_CHECK_MS = 5 * 60_000;

async function tick(): Promise<void> {
  try {
    await pollMissedTransactions();
    await runReconciler();
    // Durable epoch-transition heartbeat: derived from the Redis-cached round,
    // so a crashed/redeployed API process can never lose the transition timer.
    await megapotService.checkEpochTransition();

    // Catches any pause/unpause that happened outside this backend (manual
    // scripts, anchor migrate, etc.) — chain is truth, cache just mirrors it.
    await megapotService.syncPauseStateFromChain();

    // Ticket win/loss grading for settled epochs. Also runs in the worker
    // process — concurrent execution is safe (DRAW_PENDING-guarded updates).
    await runSettlementTick();
  } catch (err) {
    console.error('[cron] tick failed', err);
  }
}

console.log('[cron] Starting indexer + reconciler loop');

void tick();

setInterval(() => void tick(), POLL_MS);

void runVaultMonitor();

setInterval(() => void runVaultMonitor(), VAULT_CHECK_MS);
