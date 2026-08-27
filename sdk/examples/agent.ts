/**
 * End-to-end example: a backend agent that buys tickets, checks results, and
 * claims winnings.
 *
 * Run:
 *   AGENT_PRIVATE_KEY=<base58-secret> npx tsx examples/agent.ts
 *
 * SECURITY: the key is read from an environment variable and never logged.
 * Never hardcode a secret key in source, and never commit one.
 */

import { Keypair } from '@solana/web3.js';
import {
  createLordsPot,
  keypairSigner,
  getTicketMatch,
  isRevealed,
  timeUntilDraw,
  LordsPotError,
  VoucherVerificationError,
} from '../src/index';

// Minimal base58 decode so the example has no extra dependency.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58decode(s: string): Uint8Array {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error(`invalid base58 character: ${ch}`);
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

const usd = (baseUnits: bigint) => `$${(Number(baseUnits) / 1e6).toFixed(2)}`;

async function main() {
  const secret = process.env.AGENT_PRIVATE_KEY;
  if (!secret) throw new Error('Set AGENT_PRIVATE_KEY (base58) before running.');

  const signer = keypairSigner(Keypair.fromSecretKey(b58decode(secret)));
  console.log(`Agent wallet: ${signer.publicKey.toBase58()}`);

  // `network` is required — the SDK also verifies the RPC really serves this
  // cluster before signing anything.
  const lordspot = createLordsPot({ network: 'devnet' });

  // ---- 1. Read live protocol state. Ball ranges change EVERY epoch, so this
  //         must be re-read rather than cached across draws. ----
  const state = await lordspot.getProtocolState();
  console.log(`\nEpoch ${state.ongoingEpoch} · numbers 1-${state.normalMax} · bonus 1-${state.bonusMax}`);
  console.log(`Ticket price: ${usd(state.ticketPriceUsdc)} · paused: ${state.isPaused}`);

  if (state.isPaused) {
    console.log('Protocol is mid-rollover — try again in a few minutes.');
    return;
  }

  // ---- 2. Buy. quickPick() generates against the CURRENT epoch's rules. ----
  const tickets = [await lordspot.quickPick(), await lordspot.quickPick(), await lordspot.quickPick()];
  tickets.forEach((t, i) => console.log(`  ticket ${i + 1}: [${t.normals.join(', ')}] bonus ${t.bonus}`));

  console.log(`\nCost: ${usd(await lordspot.quoteCost(tickets.length))}`);

  const purchase = await lordspot.buyTickets(signer, tickets, {
    computeUnitLimit: 200_000,
    priorityFeeMicroLamports: 1_000,
  });
  console.log(`Bought ${purchase.ticketCount} tickets for ${usd(purchase.totalCostUsdc)}`);
  purchase.signatures.forEach((s) => console.log(`  ${s}`));

  // ---- 3. Inspect tickets. Relaying to Base takes ~30-60s, so a just-bought
  //         ticket will usually still show baseTxHash: null here. ----
  const owned = await lordspot.getTickets(signer.publicKey);
  console.log(`\n${owned.length} ticket(s) total:`);

  for (const t of owned.slice(0, 5)) {
    const line = `  [${t.normalBalls.join(',')}] +${t.bonusBall} · ${t.winStatus}`;

    if (!isRevealed(t)) {
      const ms = timeUntilDraw(t);
      console.log(`${line} · draw in ${ms === null ? 'unknown' : `${Math.round(ms / 60_000)}m`}`);
      continue;
    }

    // Revealed: compare locally. This is what powers a "reveal" experience —
    // no extra API call, and match counting is order-independent.
    const match = getTicketMatch(t);
    console.log(
      `${line} · matched ${match?.normalMatches}/5${match?.bonusMatch ? ' + bonus' : ''}` +
        (t.winAmountUsdc > 0n ? ` · won ${usd(t.winAmountUsdc)}` : '')
    );
  }

  // ---- 4. Claim, if anything is claimable. ----
  const summary = await lordspot.getClaimSummary(signer.publicKey);
  console.log(`\nClaimable: ${usd(summary.claimableUsdc)} · paid out to date: ${usd(summary.totalPaidOutUsdc)}`);

  if (summary.claimableUsdc > 0n) {
    // The voucher is verified against locally-derived values BEFORE signing.
    const claim = await lordspot.claimWinnings(signer);
    console.log(`Claimed ${usd(claim.amountUsdc)} — ${claim.signature}`);
  }
}

main().catch((err) => {
  if (err instanceof VoucherVerificationError) {
    // Never retry this. It means the bytes we were asked to sign were not a
    // plain claim of this wallet's own winnings.
    console.error(`\n🚨 SECURITY: voucher verification failed at "${err.assertion}"`);
    console.error(err.message);
    process.exit(2);
  }
  if (err instanceof LordsPotError) {
    console.error(`\n[${err.code}] ${err.message}`);
    // Only these are worth retrying; everything else needs a fix.
    process.exit(err.code === 'PROTOCOL_PAUSED' || err.code === 'RPC_ERROR' ? 75 : 1);
  }
  console.error(err);
  process.exit(1);
});
