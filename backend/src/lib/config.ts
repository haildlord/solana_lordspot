import 'dotenv/config';

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

function requiredOneOf(keys: string[]): string {
  for (const key of keys) {
    const v = process.env[key];
    if (v) return v;
  }
  throw new Error(`Missing env: one of [${keys.join(', ')}]`);
}

export const config = {

  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  inlineWorkers: process.env.INLINE_WORKERS === 'true',
  // Lets one process run API + workers + cron together — for a single
  // always-on free-tier host (e.g. Render's one free web service) where
  // running cron as its own separate service isn't an option.
  inlineCron: process.env.INLINE_CRON === 'true',
  databaseUrl: required('DATABASE_URL'),
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  duneUrl: required('DUNE_URL'),
  duneApiKey: required('DUNE_API_KEY'),

  solana: {
    rpcUrl: required('SOLANA_RPC_URL'),
    programId: requiredOneOf(['SOLANA_PROGRAM_ID', 'LORDSPOT_VAULT_ADDRESS']),
  /** Required for backup indexer — vault USDC ATA pubkey */
    vaultUsdcAta: process.env.SOLANA_VAULT_USDC_ATA ?? '',
    privateKey: required('SOLANA_PRIVATE_KEY'),
  },

  base: {
    // BASE_RPC_URL in production; ANVIL_RPC_URL kept as an alias for local anvil setups
    rpcUrl: requiredOneOf(['BASE_SEPOLIA_RPC_URL', 'ANVIL_RPC_URL']),
    tempURL: required('BASE_RPC_URL'), // -> remove this in production
    chainId: parseInt(process.env.BASE_CHAIN_ID!, 10),
    vaultAddress: required('LORDSPOT_BASE_VAULT'),
    relayerKey: required('RELAYER_BASE_SIGNER_PRIVATEKEY'),
    rewardWallet: requiredOneOf([
      'BASE_REWARD_WALLET_ADDRESS',
    ]),
    referralSplit: BigInt('1000000000000000000'),
    usdcAddress: requiredOneOf([`USDC_BASE_ADDRESS`, `USDC_BASE_SEPOLIA_ADDRESS`]),
    // Megapot's own Jackpot contract on Base (not our vault) — read-only
    // calls only (getDrawingTierPayouts), never a tx target.
    megapotJackpotAddress: requiredOneOf(['MEGAPOT_BASE_ADDRESS','MEGAPOT_BASE_SEPOLIA_ADDRESS'])
  },

  megapot: {
    apiKey: required('MEGAPOT_API_KEY'),
    apiUrl: process.env.MEGAPOT_API_URL ?? 'https://api.megapot.io/v1',
  },

  helius: {
    webhookSecret: process.env.HELIUS_WEBHOOK_SECRET,
  },

  relay: {
    maxAttempts: 50,
    baseBackoffMs: 5_000, // When a transaction/order fails, the system will wait 5 seconds before trying again
    maxBackoffMs: 300_000, // No matter how many times it fails, the system will never wait more than 5 minutes between retries.
    // Worst case now: a 100-ticket order (Solana's own per-tx cap) chunked at
    // 15/tx is ~7 Base transactions, each waited on synchronously up to
    // RECEIPT_TIMEOUT_MS (3 min) in baseRelayWorker.ts — ~21 min worst case.
    // 30 min leaves real margin so the reconciler can never yank an order
    // back to RETRY_PENDING while it's still legitimately mid-flight (that
    // would let a second job start processing the same order concurrently).
    processingTimeoutMs: 30 * 60_000,
    minVaultUsdc: BigInt(process.env.MIN_BASE_VAULT_USDC ?? '100000000'),
    // Orders larger than this relay as multiple sequential Base transactions
    // (RelayBatch rows) instead of one. EIP-7825 caps a single Base tx at
    // 16,777,216 gas; this contract's per-ticket combo-tracking costs
    // ~800-824k gas/ticket, so 15 tickets/tx stays comfortably under that
    // wall alongside baseService.ts's BASE_GAS_OVERHEAD/GAS_PER_TICKET formula.
    baseTicketChunkSize: 15,
  },
} as const;
