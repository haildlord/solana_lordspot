/**
 * MAINTAINER SCRIPT — run before every release. Not shipped to npm.
 *
 * The unit tests in src/verifyVoucher.test.ts build vouchers from synthetic
 * fixtures. That proves the verifier rejects malicious SHAPES, but it cannot
 * prove the verifier accepts what the REAL backend actually issues — a verifier
 * that rejects everything would pass those tests and be useless in production.
 *
 * This closes that gap end to end against a live deployment, asserting an
 * over-claim is stopped at three independent layers:
 *
 *   LAYER 1  BACKEND : an attacker-supplied `amount` in the request body is ignored.
 *   LAYER 2  SDK     : a tampered voucher is refused BEFORE any signature exists.
 *   LAYER 3  CHAIN   : a tampered voucher submitted anyway is rejected outright.
 *
 * Requires a devnet wallet that HAS claimable winnings.
 *
 *   AGENT_PRIVATE_KEY=<base58> node scripts/verify-against-live-api.js
 *
 * It requests one real voucher and deliberately does NOT submit it, so the
 * voucher expires (~90s) and the payout confirmer releases the bound tickets.
 * Nothing is spent; no funds move.
 */
const { Connection, Keypair, SystemProgram, Transaction } = require('@solana/web3.js');
const { createLordsPot } = require('../dist/index.js');
const { verifyClaimVoucher } = require('../dist/verifyVoucher.js');
const { VoucherVerificationError } = require('../dist/errors.js');
const { resolveConfig } = require('../dist/config.js');

const NETWORK = process.env.LORDSPOT_NETWORK || 'devnet';
const usd = (v) => '$' + (Number(v) / 1e6).toFixed(2);

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58decode(s) {
  let n = 0n;
  for (let pos = 0; pos < s.length; pos++) {
    const i = B58.indexOf(s[pos]);
    if (i < 0) throw new Error(`Invalid base58 at position ${pos}. Key not shown.`);
    n = n * 58n + BigInt(i);
  }
  const b = [];
  while (n > 0n) { b.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const c of s) { if (c !== '1') break; b.unshift(0); }
  return Uint8Array.from(b);
}

let failures = 0;
function record(pass, label, detail) {
  if (!pass) failures++;
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${label}${detail ? `\n         ${detail}` : ''}`);
}

/** Clones the voucher, applies `mutate`, and asserts verification REJECTS it. */
function expectReject(label, mutate, tx, expectations) {
  const clone = Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  mutate(clone);
  try {
    const amt = verifyClaimVoucher(clone, expectations);
    record(false, label, `ACCEPTED ${usd(amt)} — THIS IS A SECURITY HOLE`);
  } catch (err) {
    const why = err instanceof VoucherVerificationError
      ? `rejected by check: "${err.assertion}"`
      : `rejected: ${String(err.message).slice(0, 90)}`;
    record(true, label, why);
  }
}

async function main() {
  const secret = process.env.AGENT_PRIVATE_KEY;
  if (!secret) throw new Error('Set AGENT_PRIVATE_KEY (base58) — use a DEVNET wallet with claimable winnings.');

  const kp = Keypair.fromSecretKey(b58decode(secret));
  const wallet = kp.publicKey.toBase58();
  const cfg = resolveConfig({ network: NETWORK });
  const lordspot = createLordsPot({ network: NETWORK });
  const state = await lordspot.getProtocolState();
  const summary = await lordspot.getClaimSummary(wallet);

  console.log(`Network         : ${NETWORK}`);
  console.log(`API             : ${cfg.apiUrl}`);
  console.log(`Wallet          : ${wallet}`);
  console.log(`Legitimately owed: ${usd(summary.claimableUsdc)}`);
  console.log(`On-chain ceiling : ${usd(state.maxClaimAmountUsdc)}`);

  if (summary.claimableUsdc <= 0n) {
    throw new Error('This wallet has nothing claimable — the test needs real winnings to be meaningful.');
  }
  if (summary.pendingVoucher) {
    throw new Error('A voucher is already pending for this wallet. Wait ~90s for it to expire, then retry.');
  }

  // ============ LAYER 1 — backend must ignore an injected amount ============
  // Deliberately UNDER the on-chain ceiling, so only the database can stop it.
  const GREEDY = 99_000_000_000n;
  console.log(`\n=== LAYER 1 — BACKEND: request ${usd(GREEDY)} instead of ${usd(summary.claimableUsdc)} ===`);

  const res = await fetch(`${cfg.apiUrl}/v1/claims/voucher`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Every field name an attacker might hope the server trusts.
    body: JSON.stringify({
      wallet,
      amount: GREEDY.toString(),
      amountUsdc: GREEDY.toString(),
      claimableUsdc: GREEDY.toString(),
      winAmount: GREEDY.toString(),
    }),
  });
  const voucher = await res.json();
  if (!voucher.transactionBase64) {
    throw new Error(`No transaction bytes returned: ${JSON.stringify(voucher)}`);
  }

  const issued = BigInt(voucher.amountUsdc);
  record(
    issued === summary.claimableUsdc,
    `backend ignored the injected amount`,
    `requested ${usd(GREEDY)} → issued ${usd(issued)}`
  );

  // ============ LAYER 2 — SDK must refuse tampered vouchers ============
  const tx = Transaction.from(Buffer.from(voucher.transactionBase64, 'base64'));
  const expectations = {
    programId: cfg.programId,
    usdcMint: cfg.usdcMint,
    claimant: kp.publicKey,
    expectedAdmin: state.admin,
    expectedAmountUsdc: summary.claimableUsdc,
    maxClaimAmountUsdc: state.maxClaimAmountUsdc,
  };

  console.log(`\n=== LAYER 2 — SDK: tamper with the genuine voucher before signing ===`);

  // Baseline FIRST. Without this, the rejections below prove nothing — a
  // verifier that refuses everything would "pass" every attack case.
  try {
    record(true, 'baseline: the GENUINE voucher verifies', usd(verifyClaimVoucher(tx, expectations)));
  } catch (err) {
    record(false, 'baseline: GENUINE voucher was rejected', `at "${err.assertion}" — ${err.message}`);
    console.log('\nAborting: cannot test tampering when the honest case already fails.');
    process.exit(1);
  }

  const ixIdx = tx.instructions.findIndex((i) => i.data.length >= 16);
  const setAmount = (t, v) => t.instructions[ixIdx].data.writeBigUInt64LE(v, 8);

  expectReject(`inflate amount to ${usd(GREEDY)}`, (t) => setAmount(t, GREEDY), tx, expectations);
  expectReject(`inflate above the on-chain ceiling`, (t) => setAmount(t, 500_000_000_000n), tx, expectations);
  expectReject(`nudge amount by a single base unit`, (t) => setAmount(t, summary.claimableUsdc + 1n), tx, expectations);
  expectReject(`redirect payout to an attacker's token account`,
    (t) => { t.instructions[ixIdx].keys[3].pubkey = Keypair.generate().publicKey; }, tx, expectations);
  expectReject(`smuggle in a wallet-draining SOL transfer`, (t) => {
    t.add(SystemProgram.transfer({
      fromPubkey: kp.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1_000_000_000,
    }));
  }, tx, expectations);

  // ============ LAYER 3 — the chain must refuse it too ============
  console.log(`\n=== LAYER 3 — CHAIN: submit a tampered voucher anyway ===`);
  const conn = new Connection(cfg.rpcUrl, 'confirmed');
  const evil = Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  evil.instructions[ixIdx].data.writeBigUInt64LE(GREEDY, 8);
  evil.partialSign(kp);
  try {
    const sig = await conn.sendRawTransaction(evil.serialize({ requireAllSignatures: false }), { skipPreflight: false });
    record(false, 'chain rejected a tampered claim', `ACCEPTED: ${sig} — CRITICAL`);
  } catch (err) {
    record(true, 'chain rejected a tampered claim', String(err.message).split('\n')[0].slice(0, 120));
  }

  console.log(`\nThe genuine voucher was NOT submitted — it expires in ~90s and the`);
  console.log(`payout confirmer releases the bound tickets automatically.`);

  console.log(failures === 0
    ? `\nALL CHECKS PASSED — safe to release.`
    : `\n${failures} CHECK(S) FAILED — DO NOT RELEASE.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\nERROR:', e.message); process.exit(1); });
