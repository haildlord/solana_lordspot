import type { Connection } from '@solana/web3.js';
import { LordsPotError } from './errors';
import type { ResolvedConfig } from './config';

/**
 * Verifies the RPC endpoint actually serves the cluster the caller declared.
 *
 * The realistic failure this catches: a caller sets `network: 'devnet'` while a
 * stale `RPC_URL` in their environment still points at mainnet (or the reverse).
 * Without this, the SDK would happily build and sign transactions against the
 * wrong cluster — spending real USDC in what the caller believes is a test run,
 * or writing test data against production.
 *
 * `getGenesisHash()` is the cheapest unambiguous cluster fingerprint: it is
 * fixed per cluster, requires no auth, and cannot be spoofed by a correctly
 * configured endpoint.
 *
 * Runs ONCE per client and is cached — the genesis hash of a cluster never
 * changes, so re-checking on every call would be pure latency.
 */
export async function assertNetworkMatches(
  connection: Connection,
  config: ResolvedConfig
): Promise<void> {
  let actual: string;
  try {
    actual = await connection.getGenesisHash();
  } catch (err) {
    throw new LordsPotError(
      'RPC_ERROR',
      `Could not reach the Solana RPC at ${config.rpcUrl} to verify the network. ` +
        `Refusing to continue without confirming which cluster this is.`,
      err
    );
  }

  if (actual !== config.genesisHash) {
    throw new LordsPotError(
      'NETWORK_MISMATCH',
      `Network mismatch — you configured network: "${config.network}", but the RPC at ` +
        `${config.rpcUrl} is serving a different cluster ` +
        `(expected genesis ${config.genesisHash}, got ${actual}). ` +
        `Nothing was signed or sent. Fix your rpcUrl or your network setting before retrying.`
    );
  }
}

/** Wraps assertNetworkMatches so the check runs exactly once per client. */
export function createNetworkGuard(connection: Connection, config: ResolvedConfig): () => Promise<void> {
  let verified: Promise<void> | null = null;
  return () => {
    // Cache the promise, not the result — concurrent first calls share one RPC
    // round-trip instead of racing. A rejection is deliberately NOT cached, so a
    // transient RPC outage can be retried rather than poisoning the client.
    if (!verified) {
      verified = assertNetworkMatches(connection, config).catch((err) => {
        verified = null;
        throw err;
      });
    }
    return verified;
  };
}
