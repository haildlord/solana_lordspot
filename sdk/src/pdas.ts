import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

/**
 * PDA and ATA derivation.
 *
 * Seeds MUST stay byte-for-byte identical to the on-chain program (lib.rs) or
 * every derived address mismatches and the program rejects the transaction.
 *
 * Everything here is derived LOCALLY and never accepted from an API response.
 * That is the point: when the SDK later checks "is this claim paying the right
 * account?", it compares against an address it computed itself, so a hostile or
 * compromised server cannot substitute its own.
 */

export function getLordsPotStatePda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('lords_pot_state')], programId)[0];
}

export function getVaultAuthorityPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('vault_authority')], programId)[0];
}

/** allowOwnerOffCurve: true — the vault authority is a PDA, not a real keypair. */
export function getVaultUsdcAta(programId: PublicKey, usdcMint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(usdcMint, getVaultAuthorityPda(programId), true);
}

/** A wallet's canonical USDC associated token account. */
export function getUserUsdcAta(owner: PublicKey, usdcMint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(usdcMint, owner, false);
}
