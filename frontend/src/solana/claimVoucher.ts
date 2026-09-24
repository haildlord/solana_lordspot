import { Connection, Transaction } from '@solana/web3.js';
import type { WalletContextState } from '@solana/wallet-adapter-react';

/**
 * A claim voucher is a legacy Transaction the backend already partially signed
 * with the admin key (see solanaService.buildClaimVoucher). The winner's wallet
 * counter-signs and broadcasts — no separate signature request beyond what the
 * wallet extension shows.
 *
 * The winner is the FEE PAYER, so their wallet needs a little SOL (plus ATA
 * rent on a first-ever claim). The signature returned here is the transaction's
 * real signature, but it is NOT reported back to the backend as proof of
 * anything — the payout confirmer independently discovers landed claims on
 * chain. Nothing here can convince the backend a payout happened.
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
