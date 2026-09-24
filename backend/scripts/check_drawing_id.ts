// Read-only: directly calls currentDrawingId() on the live Jackpot contract
// (it's a public state variable, so Solidity auto-generates a view getter).
// No signing, no state change.
import { ethers } from 'ethers';
import { config } from '../src/lib/config';

const JACKPOT_MIN_ABI = ['function currentDrawingId() view returns (uint256)'];

async function main() {
  const provider = new ethers.JsonRpcProvider(config.base.rpcUrl, config.base.chainId);
  const jackpot = new ethers.Contract(config.base.megapotJackpotAddress, JACKPOT_MIN_ABI, provider);
  const id: bigint = await jackpot.currentDrawingId();
  const latestBlock = await provider.getBlockNumber();
  console.log('Live currentDrawingId on Jackpot contract:', id.toString());
  console.log('Read at block:', latestBlock);
}

main().catch((e) => {
  console.error('Script failed:', e);
  process.exit(1);
});
