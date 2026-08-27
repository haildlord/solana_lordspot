import { PublicKey } from '@solana/web3.js';
import { LordsPotError } from './errors';

export type LordsPotNetwork = 'devnet' | 'mainnet';

/**
 * Per-network identifiers, BAKED INTO THE SDK — deliberately not overridable.
 *
 * None of these are secrets. The API host in particular is public by
 * construction: every integrator's traffic reaches it, and the LordsPot web app
 * calls it from browsers already. Publishing it costs nothing.
 *
 * What matters is that a CALLER CANNOT CHANGE IT. The program id, USDC mint and
 * API url decide *which program moves the money* and *whose server co-signs a
 * claim*. Exposing any of them as an override turns a config typo — or one
 * poisoned env var in an integrator's deployment — into a silent redirect.
 *
 * The only network knob a caller gets is `rpcUrl`, because they will want their
 * own provider key. That one is safe to expose: networkGuard.ts verifies the
 * endpoint really serves this cluster's `genesisHash` before anything is signed,
 * so a wrong or hostile RPC is caught rather than trusted.
 *
 * LordsPot's own local development is done by temporarily editing this file, and
 * never committing that edit. There is deliberately no localhost entry and no
 * runtime escape hatch: a published SDK must only ever talk to a deployed host.
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
    // Must be the deployed devnet API host — never localhost. `npm run
    // guard:hosts` fails the build if a placeholder or localhost URL survives
    // into dist/, so this cannot ship unset.
    apiUrl: 'https://lordspot-beta.onrender.com',
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
  /**
   * Optional: your own RPC endpoint. Falls back to the public cluster RPC,
   * which rate-limits hard — supply your own provider for anything real.
   *
   * This is the ONLY network value a caller may set. It is safe to expose
   * because networkGuard.ts verifies the endpoint's genesis hash matches the
   * requested cluster before a transaction is ever signed.
   */
  rpcUrl?: string;
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

  // Not caller-supplied, so this is an assertion about the SHIPPED build rather
  // than input validation: it catches a broken or placeholder preset loudly at
  // the first call instead of failing somewhere deep in a fetch.
  const apiUrl = preset.apiUrl.replace(/\/+$/, '');
  if (!/^https:\/\//.test(apiUrl) || apiUrl.includes('__SET_')) {
    throw new LordsPotError(
      'INVALID_CONFIG',
      `This SDK build has no valid API host for "${input.network}" (got: ${apiUrl}). ` +
        `This is a packaging bug — please report it rather than working around it.`
    );
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
