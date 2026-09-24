import { useQuery } from '@tanstack/react-query';
import { PublicKey, Keypair } from '@solana/web3.js';
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import rawIdl from '../idl/lords_pot_idl.json';
import type { SolanaSmartContracts } from '../idl/lords_pot_types';
import { readonlyConnection } from './program';
import { getLordsPotStatePda } from './pdas';

/**
 * account.fetch() never signs anything, so a real wallet isn't required —
 * this dummy satisfies AnchorProvider's Wallet interface for READ-ONLY use.
 * Never used to send a transaction.
 */
const readOnlyWallet = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async () => {
    throw new Error('Read-only provider cannot sign');
  },
  signAllTransactions: async () => {
    throw new Error('Read-only provider cannot sign');
  },
};

const readOnlyProgram = new Program(
  rawIdl as SolanaSmartContracts,
  new AnchorProvider(readonlyConnection, readOnlyWallet as never, AnchorProvider.defaultOptions())
);

export interface LordsPotOnChainState {
  normalMax: number;
  bonusMax: number;
  ticketPriceUsdc: number;
  ongoingEpoch: number;
  isPaused: boolean;
  admin: PublicKey;
}

async function fetchOnChainState(): Promise<LordsPotOnChainState> {
  const [pda] = getLordsPotStatePda();
  const account = (await readOnlyProgram.account.lordsPotState.fetch(pda)) as {
    normalMax: number;
    bonusMax: number;
    ticketPrice: { toNumber(): number };
    ongoingEpoch: { toNumber(): number };
    isLordsPotPaused: boolean;
    admin: PublicKey;
  };

  return {
    normalMax: account.normalMax,
    bonusMax: account.bonusMax,
    ticketPriceUsdc: account.ticketPrice.toNumber(),
    ongoingEpoch: account.ongoingEpoch.toNumber(),
    isPaused: account.isLordsPotPaused,
    admin: account.admin,
  };
}

/** Ticket price / ball ranges / pause flag / epoch — read directly from Solana, authoritative regardless of backend uptime. */
export function useOnChainState() {
  return useQuery({
    queryKey: ['lordspot-onchain-state'],
    queryFn: fetchOnChainState,
    refetchInterval: 20_000,
  });
}
