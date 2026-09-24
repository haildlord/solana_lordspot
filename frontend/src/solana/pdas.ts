import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { LORDSPOT_PROGRAM_ID, USDC_MINT } from './constants';

/** Mirrors the exact seeds in lib.rs — must stay byte-for-byte identical or every derivation mismatches on-chain. */
export function getLordsPotStatePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('lords_pot_state')], LORDSPOT_PROGRAM_ID);
}

export function getVaultAuthorityPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('vault_authority')], LORDSPOT_PROGRAM_ID);
}

/** allowOwnerOffCurve: true — the vault authority is a PDA, not a real keypair. */
export function getVaultUsdcAta(): PublicKey {
  const [vaultAuthority] = getVaultAuthorityPda();
  return getAssociatedTokenAddressSync(USDC_MINT, vaultAuthority, true);
}

export function getUserUsdcAta(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(USDC_MINT, owner, false);
}
