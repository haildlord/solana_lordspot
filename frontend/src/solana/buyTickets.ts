import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import { Program, AnchorProvider } from '@coral-xyz/anchor'; // Import AnchorProvider
import type { SolanaSmartContracts } from '../idl/lords_pot_types';
import { getLordsPotStatePda, getVaultAuthorityPda, getVaultUsdcAta, getUserUsdcAta } from './pdas';
import { USDC_MINT, USDC_DECIMALS, TICKET_RULES, RELAY_FEE_BASE_USDC, RELAY_FEE_PER_TICKET_USDC } from './constants';
import type { StagedTicket } from './ticketUtils';

/**
 * Sends buy_ticket directly to the LordsPot program.
 * Bundles tickets into safe instruction and transaction chunk sizes to avoid
 * Anchor buffer overruns and Solana's 1232-byte transaction size limit.
 *
 * Also bundles a plain USDC transfer covering the relay fee (see constants.ts)
 * into the same transaction as the first buy_ticket instruction — atomic with
 * the purchase, computed once for the whole call so a multi-transaction batch
 * (>50 tickets) never double-charges the base fee.
 */
export async function buyTickets(
  program: Program<SolanaSmartContracts>,
  buyer: PublicKey,
  tickets: StagedTicket[],
  feeRecipient: PublicKey
): Promise<string[]> {
  // Hard backstop against a malformed on-chain instruction — the UI (Home.tsx)
  // already disables Buy while any staged ticket is incomplete (e.g. mid-edit
  // in the ticket editor, cleared but not yet reselected), but this is the
  // actual boundary before real funds move, so it's enforced here too.
  const incomplete = tickets.find((t) => t.normals.length !== TICKET_RULES.NORMALS_PER_TICKET || t.bonus === null);
  if (incomplete) {
    throw new Error('One or more staged tickets are missing numbers — finish selecting before buying.');
  }

  const [lordsPotState] = getLordsPotStatePda();
  const [vaultAuthority] = getVaultAuthorityPda();
  const vaultUsdcAccount = getVaultUsdcAta();
  const buyerUsdcAccount = getUserUsdcAta(buyer);

  // 1. Define safe limits
  const TICKETS_PER_IX = 25; // Safe limit for Anchor's instruction buffer
  const TICKETS_PER_TX = 50; // Safe limit for Solana's 1232-byte transaction limit (2 instructions per tx)

  const transactionsToBundle: { tx: Transaction; signers: any[] }[] = [];

  const totalFee = RELAY_FEE_BASE_USDC + RELAY_FEE_PER_TICKET_USDC * tickets.length;
  const feeRecipientUsdcAccount = getUserUsdcAta(feeRecipient);

  // 2. Loop through tickets and build multiple transactions if needed
  for (let i = 0; i < tickets.length; i += TICKETS_PER_TX) {
    const txTickets = tickets.slice(i, i + TICKETS_PER_TX);
    const transaction = new Transaction();

    // Relay fee — bundled once, into the first transaction only, so a
    // multi-transaction batch (>50 tickets) never double-charges it.
    if (i === 0) {
      transaction.add(
        createAssociatedTokenAccountIdempotentInstruction(
          buyer,
          feeRecipientUsdcAccount,
          feeRecipient,
          USDC_MINT
        ),
        createTransferCheckedInstruction(
          buyerUsdcAccount,
          USDC_MINT,
          feeRecipientUsdcAccount,
          buyer,
          totalFee,
          USDC_DECIMALS
        )
      );
    }

    // 3. Inside each transaction, pack up to 2 instructions (25 tickets each)
    for (let j = 0; j < txTickets.length; j += TICKETS_PER_IX) {
      const ixTickets = txTickets.slice(j, j + TICKETS_PER_IX);
      
      const formattedChunk = ixTickets.map((t) => ({
        normalBall: Buffer.from(t.normals),
        bonusBall: t.bonus!, // guarded non-null above — every ticket here is already complete
      }));

      // Generate raw instruction
      const ix = await program.methods
        .buyTicket(formattedChunk)
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
        .instruction();

      transaction.add(ix);
    }

    // Push the built transaction to our bundle
    transactionsToBundle.push({ tx: transaction, signers: [] });
  }

  // Cast the provider to AnchorProvider to satisfy TypeScript
  const provider = program.provider as AnchorProvider;

  // Fallback safety check just in case a custom provider is used
  if (!provider.sendAll) {
    throw new Error("Provider does not support batched transactions (sendAll)");
  }

  // 4. Send all transactions at once.
  // This triggers a SINGLE popup in Phantom/Backpack saying "Approve X Transactions"
  const txHashes = await provider.sendAll(transactionsToBundle, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed'
  });

  return txHashes; // Returns an array of signatures
}