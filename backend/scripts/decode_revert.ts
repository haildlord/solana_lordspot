// Read-only diagnostic: replays an already-mined, reverted Base tx and decodes
// the raw revert data against both the Vault's and Jackpot's ABIs, so we get
// the actual named error instead of ethers' generic "unknown custom error".
// No signing, no state change — just JsonRpcProvider.call() at the historical
// block. Never logs the RPC URL or any key.
import { ethers } from 'ethers';
import { config } from '../src/lib/config';
import LordsPotBaseVault from '../base_abi/LordsPotBaseVault.json';
import JackpotArtifact from '../../base_smart_contracts/MyHackedContract/out/Jackpot.sol/Jackpot.json';

async function main() {
  const txHash = process.argv[2];
  if (!txHash) {
    console.error('Usage: tsx scripts/decode_revert.ts <txHash>');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(config.base.rpcUrl, config.base.chainId);
  const tx = await provider.getTransaction(txHash);
  if (!tx) {
    console.error('Transaction not found on this RPC:', txHash);
    process.exit(1);
  }

  console.log('Replaying tx at block', tx.blockNumber, '— to:', tx.to);

  const vaultIface = new ethers.Interface(LordsPotBaseVault.abi);
  const jackpotIface = new ethers.Interface((JackpotArtifact as any).abi);

  try {
    // blockTag belongs INSIDE the request object in ethers v6 — call() takes
    // only one argument. Passing the block number as a second positional arg
    // (as an earlier version of this script did) is silently ignored and
    // ethers queries "latest" instead, which can give a misleading answer if
    // chain state has moved on since the tx was mined.
    await provider.call({
      to: tx.to,
      from: tx.from,
      data: tx.data,
      value: tx.value,
      blockTag: tx.blockNumber!,
    });
    console.log('Replay did NOT revert — unexpected, chain state may have moved on.');
  } catch (err: any) {
    const raw = err?.data ?? err?.info?.error?.data ?? err?.error?.data ?? null;
    console.log('Raw revert data:', raw, '| typeof:', typeof raw, '| length:', typeof raw === 'string' ? raw.length : 'n/a');
    console.log('Full error shape (data/info/error/shortMessage/reason):', JSON.stringify({
      data: err?.data, info: err?.info, error: err?.error, shortMessage: err?.shortMessage, reason: err?.reason,
    }, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2));

    if (raw) {
      const selector = String(raw).slice(0, 10);
      console.log('4-byte selector:', selector);
      for (const [label, iface] of [['Vault', vaultIface], ['Jackpot', jackpotIface]] as const) {
        try {
          const decoded = iface.parseError(raw);
          console.log(`Decoded via ${label} ABI:`, decoded ? decoded.name : '(no match — parseError returned null)', decoded?.args);
        } catch (e: any) {
          console.log(`Threw decoding via ${label} ABI:`, e?.message ?? e);
        }
      }
    } else {
      console.log('No raw data on error object. Full error message:', err?.message ?? err);
    }
  }
}

main().catch((e) => {
  console.error('Script failed:', e);
  process.exit(1);
});
