// Read-only: what Jackpot address the Vault is ACTUALLY configured to call
// right now, independent of any backend env var.
import { ethers } from 'ethers';
import { config } from '../src/lib/config';
import LordsPotBaseVault from '../base_abi/LordsPotBaseVault.json';

async function main() {
  const provider = new ethers.JsonRpcProvider(config.base.rpcUrl, config.base.chainId);
  const vault = new ethers.Contract(config.base.vaultAddress, LordsPotBaseVault.abi, provider);
  const current: string = await vault.getVaultMegapotAddress();
  console.log('Vault address:', config.base.vaultAddress);
  console.log('Vault is CURRENTLY calling Jackpot at:', current);
  console.log("Backend's MEGAPOT_BASE_SEPOLIA_ADDRESS config points at:", config.base.megapotJackpotAddress);
  console.log('Match?', current.toLowerCase() === config.base.megapotJackpotAddress.toLowerCase());
}

main().catch((e) => {
  console.error('Script failed:', e);
  process.exit(1);
});
