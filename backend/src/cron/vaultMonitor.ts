import { baseService } from '../services/baseService';
import { config } from '../lib/config';

/**
 * Every 5 min: read the REAL vault balance from chain and overwrite the Redis
 * cache. This is the self-healing half of the cached-balance design — optimistic
 * debits at broadcast time drift (deposits are invisible to the cache), and this
 * reconcile guarantees drift never survives more than one cycle.
 */
export async function runVaultMonitor(): Promise<void> {
  try {
    const balance = await baseService.refreshVaultBalanceCache();
    if (balance < config.relay.minVaultUsdc) {
      console.warn(
        `[vault-monitor] LOW Base USDC: ${balance} < ${config.relay.minVaultUsdc} — top up the vault!`
      );
    }
  } catch (err) {
    // RPC blip: keep the last cached value (slightly stale beats a fake 0).
    console.error('[vault-monitor] Failed to refresh vault balance from chain', err);
  }
}
