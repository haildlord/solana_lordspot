import { Keypair, PublicKey, Transaction } from '@solana/web3.js';

/**
 * Minimal signing interface.
 *
 * Deliberately the smallest surface that works: the SDK never asks for, stores,
 * or transmits a secret key — it hands you a transaction and you hand one back.
 * That means a caller is free to keep keys in a KMS, an HSM, or a remote signing
 * service, and this SDK never has to know.
 */
export interface LordsPotSigner {
  publicKey: PublicKey;
  signTransaction(tx: Transaction): Promise<Transaction>;
}

/**
 * Adapts a local `Keypair` to the signer interface — the common case for a
 * backend agent.
 *
 * Note this uses `partialSign`, not `sign`: a claim transaction already carries
 * the LordsPot admin's co-signature, and `sign()` would discard it.
 */
export function keypairSigner(keypair: Keypair): LordsPotSigner {
  return {
    publicKey: keypair.publicKey,
    async signTransaction(tx: Transaction): Promise<Transaction> {
      tx.partialSign(keypair);
      return tx;
    },
  };
}
