import { Connection, Transaction } from '@solana/web3.js';
import type { WalletContextState } from '@solana/wallet-adapter-react';

/**
 * A claim voucher is a legacy Transaction the backend already partially
 * signed as fee payer (see solanaService.buildClaimVoucher). The winner's
 * wallet only needs to counter-sign and broadcast — no separate signature
 * request beyond what the wallet extension shows.
 */
export async function submitClaimVoucher(
  connection: Connection,
  wallet: WalletContextState,
  transactionBase64: string
): Promise<string> {
  if (!wallet.signTransaction) throw new Error('Wallet does not support signing');

  const tx = Transaction.from(Buffer.from(transactionBase64, 'base64'));
  const signed = await wallet.signTransaction(tx);

  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });

  return signature;
}
