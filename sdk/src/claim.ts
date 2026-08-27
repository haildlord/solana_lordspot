import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { getClaimSummary, requestVoucher } from './api';
import { LordsPotError, explainOnChainError } from './errors';
import type { ProtocolState } from './protocol';
import type { LordsPotSigner } from './signer';
import { verifyClaimVoucher } from './verifyVoucher';

export interface ClaimResult {
  signature: string;
  /** Amount actually authorised, verified against the transaction's own bytes. */
  amountUsdc: bigint;
  claimId: string;
}

/**
 * Claims all currently-claimable winnings for the signer's wallet.
 *
 * DELIBERATELY ONE INDIVISIBLE CALL — fetch, verify, sign, submit, confirm. It
 * is not split into "get a voucher" and "sign it later" for two reasons:
 *
 *   1. The voucher's blockhash expires in ~60-90 seconds.
 *   2. The API only returns transaction bytes on FIRST issuance. Ask again while
 *      one is still pending and you get metadata without the bytes — so a
 *      split flow strands the caller until expiry.
 *
 * The signature is produced ONLY after verifyClaimVoucher() has confirmed the
 * transaction is a plain claim of this wallet's own winnings. See that file —
 * it is the security boundary of this SDK.
 */
export async function claimWinnings(
  connection: Connection,
  signer: LordsPotSigner,
  state: ProtocolState,
  apiUrl: string,
  programId: PublicKey,
  usdcMint: PublicKey
): Promise<ClaimResult> {
  const wallet = signer.publicKey.toBase58();

  if (state.isPaused) {
    throw new LordsPotError(
      'PROTOCOL_PAUSED',
      'Claims are paused right now — this happens briefly during the daily epoch rollover. Retry in a few minutes.'
    );
  }

  // 1. Independent read of what SHOULD be claimable. This becomes the number the
  //    voucher is checked against, so the API cannot quietly inflate the amount
  //    between what it reports and what it asks us to sign.
  const summary = await getClaimSummary(apiUrl, wallet);

  if (summary.pendingVoucher) {
    throw new LordsPotError(
      'VOUCHER_ALREADY_PENDING',
      `A claim voucher for this wallet was already issued (${summary.pendingVoucher.amountUsdc} base units) ` +
        `and has not landed yet. The API will not re-issue its transaction bytes, so wait ~90 seconds ` +
        `for it to expire (or confirm, if it was already submitted) and try again.`
    );
  }

  if (summary.claimableUsdc <= 0n) {
    throw new LordsPotError('NOTHING_TO_CLAIM', 'This wallet has no claimable winnings right now.');
  }

  // 2. Fee-payer sanity — the claimant pays the network fee for their own claim.
  const lamports = await connection.getBalance(signer.publicKey);
  if (lamports < 5_000) {
    throw new LordsPotError(
      'INSUFFICIENT_SOL',
      `Wallet holds ${lamports} lamports — not enough SOL to pay the network fee for this claim. ` +
        `(A first-ever claim also needs rent to create the USDC token account.)`
    );
  }

  // 3. Request the voucher.
  const voucher = await requestVoucher(apiUrl, wallet);

  if (voucher.reused || !voucher.transactionBase64) {
    throw new LordsPotError(
      'VOUCHER_ALREADY_PENDING',
      `The API returned an existing voucher without transaction bytes. ${voucher.note}`
    );
  }

  // 4. Decode. Malformed bytes are a failure, never something to sign past.
  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(voucher.transactionBase64, 'base64'));
  } catch (err) {
    throw new LordsPotError(
      'VOUCHER_VERIFICATION_FAILED',
      'The claim voucher returned by the API could not be decoded as a Solana transaction. Nothing was signed.',
      err
    );
  }

  // 5. ===== THE SECURITY GATE — throws before any signature exists. =====
  //    `expectedAdmin` comes from ON-CHAIN state, never from the API response,
  //    so a compromised server cannot nominate its own "admin".
  const verifiedAmount = verifyClaimVoucher(tx, {
    programId,
    usdcMint,
    claimant: signer.publicKey,
    expectedAdmin: state.admin,
    expectedAmountUsdc: summary.claimableUsdc,
    maxClaimAmountUsdc: state.maxClaimAmountUsdc,
  });

  // 6. Only now is it safe to sign.
  const signed = await signer.signTransaction(tx);

  // Belt-and-braces: serialize with full signature verification on, so a
  // malformed or incompletely-signed transaction fails locally rather than
  // being broadcast.
  let raw: Buffer;
  try {
    raw = signed.serialize();
  } catch (err) {
    throw new LordsPotError(
      'TRANSACTION_FAILED',
      'The signed claim transaction failed local signature verification and was NOT broadcast.',
      err
    );
  }

  let signature: string;
  try {
    signature = await connection.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
  } catch (err) {
    const explained = explainOnChainError((err as { logs?: string[] })?.logs);
    throw new LordsPotError(
      'TRANSACTION_FAILED',
      explained ? `Claim failed: ${explained}` : 'Claim transaction failed to send.',
      err
    );
  }

  const confirmation = await connection.confirmTransaction(
    {
      signature,
      blockhash: tx.recentBlockhash!,
      lastValidBlockHeight: voucher.lastValidBlockHeight!,
    },
    'confirmed'
  );

  if (confirmation.value.err) {
    throw new LordsPotError(
      'TRANSACTION_FAILED',
      `Claim transaction ${signature} landed but failed: ${JSON.stringify(confirmation.value.err)}. ` +
        `No funds moved; the winnings remain claimable and a new voucher can be requested after ~90 seconds.`
    );
  }

  return { signature, amountUsdc: verifiedAmount, claimId: voucher.claimId };
}
