import { PublicKey } from '@solana/web3.js';
import { LordsPotError } from './errors';

export type LordsPotNetwork = 'devnet' | 'mainnet';

/**
 * Per-network identifiers, BAKED INTO THE SDK — deliberately not overridable.
 *
 * A caller can supply their own RPC endpoint (they'll want their own provider
 * key), but never the program id, USDC mint, or API url. Those three decide
 * *which program moves the money* and *whose server signs the co-signature*;
 * making them caller-supplied would turn a config typo — or a poisoned env var
 * in the caller's deployment — into a redirect to an attacker's program.
 *
 * `genesisHash` is the cluster's fingerprint, verified against the live RPC
 * before anything is signed. See networkGuard.ts.
 */
interface NetworkConfig {
  programId: PublicKey;
  usdcMint: PublicKey;
  apiUrl: string;
  genesisHash: string;
  defaultRpcUrl: string;
}

/**
 * MAINNET IS NOT YET AVAILABLE.
 *
 * The program has not been deployed to mainnet-beta, so there is no program id
 * or production API url to point at. Rather than ship a placeholder that could
 * later be mistaken for a real address, `mainnet` is explicitly absent and
 * requesting it throws a clear error.
 *
 * When mainnet ships, add its entry here — and only here. Nothing else in the
 * SDK needs to change.
 */
const NETWORKS: Partial<Record<LordsPotNetwork, NetworkConfig>> = {
  devnet: {
    programId: new PublicKey('5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo'),
    usdcMint: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
    // TODO(mainnet-launch): replace with the deployed devnet API host.
    apiUrl: 'http://localhost:3000',
    genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    defaultRpcUrl: 'https://api.devnet.solana.com',
  },
};

export interface LordsPotConfigInput {
  /**
   * REQUIRED and never inferred. Auto-detecting the network is how someone
   * "tests" against mainnet and spends real USDC — making this explicit means
   * nobody reaches mainnet without typing the word.
   */
  network: LordsPotNetwork;
  /** Optional: your own RPC endpoint. Falls back to the public cluster RPC. */
  rpcUrl?: string;
  /**
   * Optional API url override. Intended for LordsPot's own local development
   * only — pointing this at an untrusted host means that host co-signs your
   * claim transactions. The SDK still verifies every voucher before signing
   * (see claim.ts), so a hostile API cannot drain a wallet, but it can still
   * deny service or leak which wallets you query.
   */
  apiUrl?: string;
}

export interface ResolvedConfig {
  network: LordsPotNetwork;
  programId: PublicKey;
  usdcMint: PublicKey;
  apiUrl: string;
  rpcUrl: string;
  genesisHash: string;
}

export function resolveConfig(input: LordsPotConfigInput): ResolvedConfig {
  if (!input || typeof input !== 'object') {
    throw new LordsPotError('INVALID_CONFIG', 'createLordsPot() requires a config object.');
  }

  const preset = NETWORKS[input.network];
  if (!preset) {
    if (input.network === 'mainnet') {
      throw new LordsPotError(
        'NETWORK_UNAVAILABLE',
        'LordsPot is not yet deployed to mainnet. Only "devnet" is currently supported.'
      );
    }
    throw new LordsPotError(
      'INVALID_CONFIG',
      `Unknown network "${String(input.network)}". Expected "devnet" or "mainnet".`
    );
  }

  const rpcUrl = input.rpcUrl ?? preset.defaultRpcUrl;
  if (typeof rpcUrl !== 'string' || !/^https?:\/\//.test(rpcUrl)) {
    throw new LordsPotError('INVALID_CONFIG', `rpcUrl must be an http(s) URL, got: ${String(rpcUrl)}`);
  }

  const apiUrl = (input.apiUrl ?? preset.apiUrl).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(apiUrl)) {
    throw new LordsPotError('INVALID_CONFIG', `apiUrl must be an http(s) URL, got: ${apiUrl}`);
  }

  return {
    network: input.network,
    programId: preset.programId,
    usdcMint: preset.usdcMint,
    apiUrl,
    rpcUrl,
    genesisHash: preset.genesisHash,
  };
}
