import { useMemo } from 'react';
import { Connection } from '@solana/web3.js';
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import { useConnection, useWallet, type AnchorWallet } from '@solana/wallet-adapter-react';
import rawIdl from '../idl/lords_pot_idl.json';
import type { SolanaSmartContracts } from '../idl/lords_pot_types';
import { HELIUS_RPC_URL } from './constants';

/**
 * Read-only connection for pages that need on-chain data before a wallet is
 * connected (e.g. Home reads ticket price / ball ranges / pause flag from
 * LordsPotState regardless of wallet state).
 */
export const readonlyConnection = new Connection(HELIUS_RPC_URL, 'confirmed');

/**
 * Anchor Program instance bound to the connected wallet. `idl.address`
 * embeds the program id (same pattern the backend's solanaService.ts uses),
 * so no separate programId argument is needed.
 */
export function useLordsPotProgram(): Program<SolanaSmartContracts> | null {
  const { connection } = useConnection();
  const wallet = useWalletAdapter();

  return useMemo(() => {
    if (!wallet) return null;
    const provider = new AnchorProvider(connection, wallet, AnchorProvider.defaultOptions());
    return new Program(rawIdl as SolanaSmartContracts, provider);
  }, [connection, wallet]);
}

/** Wallet adapter → the shape AnchorProvider expects, or null if not connected. */
function useWalletAdapter(): AnchorWallet | null {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  return useMemo(() => {
    if (!publicKey || !signTransaction || !signAllTransactions) return null;
    return { publicKey, signTransaction, signAllTransactions } as AnchorWallet;
  }, [publicKey, signTransaction, signAllTransactions]);
}
