import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Program, AnchorProvider } from '@coral-xyz/anchor'; // Import AnchorProvider
import type { SolanaSmartContracts } from '../idl/lords_pot_types';
import { getLordsPotStatePda, getVaultAuthorityPda, getVaultUsdcAta, getUserUsdcAta } from './pdas';
import { TICKET_RULES, USDC_MINT } from './constants';
import type { StagedTicket } from './ticketUtils';

/**
 * Sends buy_ticket directly to the LordsPot program.
 * Bundles tickets into safe instruction and transaction chunk sizes to avoid
 * Anchor buffer overruns and Solana's 1232-byte transaction size limit.
 *
 * THE RELAY FEE IS NO LONGER BUILT HERE. It used to be a separate SPL transfer
 * instruction bolted on beside the first buy_ticket call — which meant it was
 * only ever paid by people going through this UI, and anyone hand-rolling a
 * transaction against the program got their tickets relayed to Base for free
 * at the relayer's expense. The program now charges it inside buy_ticket
 * itself, atomically: no fee, no tickets, for every caller.
 *
 * All this function still does about the fee is pass the destination account
 * (derived on-chain from LordsPotState.fee_recipient, so it cannot be pointed
 * anywhere else) and keep instructions within the on-chain per-instruction
 * ticket ceiling.
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
  // Capped by the program's own max_tickets_per_purchase — a larger instruction
  // reverts on-chain, not just client-side.
  const TICKETS_PER_IX = TICKET_RULES.MAX_TICKETS_PER_IX;
  // ONE instruction per transaction. Instructions do NOT get their own byte
  // budget — every instruction in a transaction shares the same 1232-byte
  // ceiling, and each one adds ~13 bytes of its own header on top. At 65
  // tickets an instruction already fills most of that ceiling, so a second one
  // would overflow it. Bigger purchases therefore become more TRANSACTIONS,
  // which sendAll below still presents as a single wallet approval.
  const TICKETS_PER_TX = TICKETS_PER_IX;

  const transactionsToBundle: { tx: Transaction; signers: any[] }[] = [];

  // Derived from the on-chain fee_recipient — the program re-derives this same
  // ATA and rejects anything else, so this cannot be redirected from here.
  const feeRecipientUsdcAccount = getUserUsdcAta(feeRecipient);

  // 2. Loop through tickets and build multiple transactions if needed
  for (let i = 0; i < tickets.length; i += TICKETS_PER_TX) {
    const txTickets = tickets.slice(i, i + TICKETS_PER_TX);
    const transaction = new Transaction();

    // 3. Inside each transaction, pack instructions of TICKETS_PER_IX each.
    // Each instruction pays its own base fee on-chain — deliberate, since each
    // one is relayed as its own Base transaction with its own fixed gas cost.
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
          feeRecipientUsdcAccount,
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