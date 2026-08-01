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
  nodeEnv: process.env.NODE_ENV ?? 'development', // ! what is this what to put.
  inlineWorkers: process.env.INLINE_WORKERS === 'true',
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
    rpcUrl: requiredOneOf(['BASE_RPC_URL', 'ANVIL_RPC_URL']),
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
    megapotJackpotAddress: required('MEGAPOT_BASE_SEPOLIA_ADDRESS')
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
    processingTimeoutMs: 5 * 60_000, // This is the maximum time allowed for one processing attempt to complete.
    minVaultUsdc: BigInt(process.env.MIN_BASE_VAULT_USDC ?? '100000000'),
  },
} as const;
