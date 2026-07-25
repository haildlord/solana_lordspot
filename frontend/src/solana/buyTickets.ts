import { PublicKey, SystemProgram } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { Program } from '@coral-xyz/anchor';
import type { SolanaSmartContracts } from '../idl/lords_pot_types';
import { getLordsPotStatePda, getVaultAuthorityPda, getVaultUsdcAta, getUserUsdcAta } from './pdas';
import { USDC_MINT } from './constants';
import type { StagedTicket } from './ticketUtils';

/**
 * Sends buy_ticket directly to the LordsPot program — the user pays their own
 * Solana fee and signs with their own wallet. This is a chain-first purchase:
 * the backend never sees it until its Helius webhook fires afterward and
 * re-verifies the transaction on-chain (chain is truth, not this call).
 */
export async function buyTickets(
  program: Program<SolanaSmartContracts>,
  buyer: PublicKey,
  tickets: StagedTicket[]
): Promise<string> {
  const [lordsPotState] = getLordsPotStatePda();
  const [vaultAuthority] = getVaultAuthorityPda();
  const vaultUsdcAccount = getVaultUsdcAta();
  const buyerUsdcAccount = getUserUsdcAta(buyer);

  const formattedTickets = tickets.map((t) => ({
    normalBall: Buffer.from(t.normals),
    bonusBall: t.bonus,
  }));

  return program.methods
    .buyTicket(formattedTickets)
    .accounts({
      signer: buyer,
      lordsPotState,
      buyerUsdcAccount,
      vaultUsdcAccount,
      vaultAuthority,
      usdcMint: USDC_MINT,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    } as never)
    .rpc({ commitment: 'confirmed', preflightCommitment: 'confirmed' });
}
