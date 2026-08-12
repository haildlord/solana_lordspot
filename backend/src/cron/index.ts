import { pollMissedTransactions } from '../services/solanaIndexer';
import { megapotService } from '../services/megapotService';
import { runReconciler } from './reconciler';
import { runVaultMonitor } from './vaultMonitor';
import { runSettlementTick } from '../workers/settlementWorker';

const POLL_MS = 30_000;
const VAULT_CHECK_MS = 5 * 60_000;

async function tick(): Promise<void> {
  try {
    await pollMissedTransactions();
    await runReconciler();
    // Durable epoch-transition heartbeat: derived from the Redis-cached round,
    // so a crashed/redeployed API process can never lose the transition timer.
    await megapotService.checkEpochTransition();
~
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
