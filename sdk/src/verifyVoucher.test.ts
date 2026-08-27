import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { verifyClaimVoucher } from './verifyVoucher';
import { CLAIM_WINNINGS_DISCRIMINATOR } from './instructions';
import { getLordsPotStatePda, getUserUsdcAta, getVaultAuthorityPda, getVaultUsdcAta } from './pdas';
import { VoucherVerificationError } from './errors';

/**
 * ADVERSARIAL TEST SUITE FOR THE SDK'S SECURITY BOUNDARY.
 *
 * Each case builds a claim voucher a compromised API might realistically return
 * and asserts the SDK REFUSES TO SIGN IT. These are not incidental unit tests:
 * if any one of them starts passing a malicious voucher, a partner's users can
 * be drained. Treat a failure here as a release blocker.
 */

const PROGRAM_ID = new PublicKey('5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo');
const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const DUMMY_BLOCKHASH = '11111111111111111111111111111111';

const admin = Keypair.generate();
const claimant = Keypair.generate();
const attacker = Keypair.generate();

const AMOUNT = 5_000_000n;

const expectations = {
  programId: PROGRAM_ID,
  usdcMint: USDC_MINT,
  claimant: claimant.publicKey,
  expectedAdmin: admin.publicKey,
  expectedAmountUsdc: AMOUNT,
  maxClaimAmountUsdc: 100_000_000_000n,
};

function u64(value: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(value);
  return b;
}

/**
 * Builds the claim instruction exactly as the program's `ClaimWinnings` struct
 * declares it — all TEN accounts, including the three program ids. An earlier
 * version of this helper stopped at seven, which quietly meant the suite was
 * asserting against a shape the program never receives.
 */
function claimIx(
  amount: bigint,
  opts: { user?: PublicKey; userAta?: PublicKey; adminKey?: PublicKey } = {}
): TransactionInstruction {
  const user = opts.user ?? claimant.publicKey;
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: Buffer.concat([CLAIM_WINNINGS_DISCRIMINATOR, u64(amount)]),
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: opts.adminKey ?? admin.publicKey, isSigner: true, isWritable: false },
      { pubkey: getLordsPotStatePda(PROGRAM_ID), isSigner: false, isWritable: false },
      { pubkey: opts.userAta ?? getUserUsdcAta(user, USDC_MINT), isSigner: false, isWritable: true },
      { pubkey: getVaultUsdcAta(PROGRAM_ID, USDC_MINT), isSigner: false, isWritable: true },
      { pubkey: getVaultAuthorityPda(PROGRAM_ID), isSigner: false, isWritable: false },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
}

function makeTx(
  ixs: TransactionInstruction[],
  { signAdmin = true, feePayer = claimant.publicKey } = {}
): Transaction {
  const tx = new Transaction({ feePayer, blockhash: DUMMY_BLOCKHASH, lastValidBlockHeight: 1 });
  for (const ix of ixs) tx.add(ix);
  if (signAdmin) tx.partialSign(admin);
  return tx;
}

/** Asserts the voucher is rejected, and by the expected named check. */
function assertRejected(build: () => Transaction, expectedAssertion: string): void {
  let threw = false;
  try {
    verifyClaimVoucher(build(), expectations);
  } catch (err) {
    threw = true;
    assert.ok(
      err instanceof VoucherVerificationError,
      `expected VoucherVerificationError, got ${(err as Error).constructor.name}: ${(err as Error).message}`
    );
    assert.equal(
      (err as VoucherVerificationError).assertion,
      expectedAssertion,
      `rejected by the wrong check`
    );
  }
  assert.ok(threw, 'SECURITY FAILURE: a malicious voucher was ACCEPTED');
}

describe('verifyClaimVoucher — legitimate vouchers', () => {
  test('accepts an honest claim and returns the verified amount', () => {
    const tx = makeTx([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }),
      claimIx(AMOUNT),
    ]);
    assert.equal(verifyClaimVoucher(tx, expectations), AMOUNT);
  });

  test('accepts a claim with no ComputeBudget instructions', () => {
    assert.equal(verifyClaimVoucher(makeTx([claimIx(AMOUNT)]), expectations), AMOUNT);
  });
});

describe('verifyClaimVoucher — attack simulations (each MUST be rejected)', () => {
  test('rejects a smuggled SOL transfer draining the wallet', () => {
    assertRejected(
      () =>
        makeTx([
          claimIx(AMOUNT),
          SystemProgram.transfer({
            fromPubkey: claimant.publicKey,
            toPubkey: attacker.publicKey,
            lamports: 1_000_000_000,
          }),
        ]),
      'no-foreign-instructions'
    );
  });

  test('rejects a transaction containing ONLY a drain (no claim at all)', () => {
    assertRejected(
      () =>
        makeTx(
          [
            SystemProgram.transfer({
              fromPubkey: claimant.publicKey,
              toPubkey: attacker.publicKey,
              lamports: 1_000_000_000,
            }),
          ],
          { signAdmin: false }
        ),
      'no-foreign-instructions'
    );
  });

  test('rejects payout redirected to an attacker-controlled token account', () => {
    assertRejected(
      () => makeTx([claimIx(AMOUNT, { userAta: getUserUsdcAta(attacker.publicKey, USDC_MINT) })]),
      'account-user_usdc_account'
    );
  });

  test('rejects an inflated amount that disagrees with the claim summary', () => {
    assertRejected(() => makeTx([claimIx(AMOUNT * 100n)]), 'amount-matches-summary');
  });

  test('rejects an amount above the on-chain payout ceiling', () => {
    let threw = false;
    try {
      verifyClaimVoucher(makeTx([claimIx(500_000_000_000n)]), {
        ...expectations,
        expectedAmountUsdc: 500_000_000_000n,
      });
    } catch (err) {
      threw = true;
      assert.equal((err as VoucherVerificationError).assertion, 'amount-within-ceiling');
    }
    assert.ok(threw, 'SECURITY FAILURE: accepted an amount above the ceiling');
  });

  test('rejects an attacker nominating itself as admin', () => {
    assertRejected(
      () => makeTx([claimIx(AMOUNT, { adminKey: attacker.publicKey })], { signAdmin: false }),
      'account-admin'
    );
  });

  test('rejects a voucher the admin has not actually signed', () => {
    assertRejected(() => makeTx([claimIx(AMOUNT)], { signAdmin: false }), 'admin-already-signed');
  });

  test('rejects a different instruction wearing the claim shape', () => {
    assertRejected(() => {
      const ix = claimIx(AMOUNT);
      ix.data.writeUInt8(99, 0); // corrupt the discriminator
      return makeTx([ix]);
    }, 'is-claim-winnings');
  });

  test('rejects an extra required signer', () => {
    // Flips an EXISTING account to a signer rather than appending one. An
    // appended signer is now caught earlier by account-count, so appending here
    // would only re-test that check and leave no-unexpected-signers unexercised.
    assertRejected(() => {
      const ix = claimIx(AMOUNT);
      ix.keys[6]!.isSigner = true; // usdc_mint, correct address but must not sign
      return makeTx([ix]);
    }, 'no-unexpected-signers');
  });

  test('rejects a substituted fee payer', () => {
    assertRejected(
      () => makeTx([claimIx(AMOUNT)], { feePayer: attacker.publicKey }),
      'claimant-is-fee-payer'
    );
  });

  test('rejects two claim instructions bundled together', () => {
    assertRejected(
      () => makeTx([claimIx(AMOUNT), claimIx(AMOUNT)]),
      'exactly-one-claim-instruction'
    );
  });

  test('rejects an empty transaction', () => {
    assertRejected(() => makeTx([], { signAdmin: false }), 'exactly-one-claim-instruction');
  });

  test('rejects truncated instruction data', () => {
    assertRejected(() => {
      const ix = claimIx(AMOUNT);
      ix.data = ix.data.subarray(0, 10); // discriminator + partial amount
      return makeTx([ix]);
    }, 'instruction-data-length');
  });

  test('rejects trailing bytes appended after the amount', () => {
    assertRejected(() => {
      const ix = claimIx(AMOUNT);
      ix.data = Buffer.concat([ix.data, Buffer.alloc(64, 0xff)]);
      return makeTx([ix]);
    }, 'instruction-data-length');
  });

  test('rejects extra accounts appended past the declared ten', () => {
    assertRejected(() => {
      const ix = claimIx(AMOUNT);
      ix.keys.push({ pubkey: attacker.publicKey, isSigner: false, isWritable: true });
      return makeTx([ix]);
    }, 'account-count');
  });

  test('rejects a substituted token program', () => {
    assertRejected(() => {
      const ix = claimIx(AMOUNT);
      ix.keys[8]!.pubkey = attacker.publicKey;
      return makeTx([ix]);
    }, 'account-token_program');
  });
});

/**
 * The claimant is the fee payer, so the compute budget is part of what they are
 * being asked to authorise. Every other check can pass while the transaction
 * quietly carries a compute unit price that costs the signer their whole SOL
 * balance — a drain with no foreign instruction and no redirected payout.
 */
describe('verifyClaimVoucher — priority fee bounds', () => {
  test('accepts a realistic priority fee', () => {
    const tx = makeTx([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
      claimIx(AMOUNT),
    ]);
    assert.equal(verifyClaimVoucher(tx, expectations), AMOUNT); // 100 lamports
  });

  test('rejects a compute unit price that would drain the signer', () => {
    assertRejected(
      () =>
        makeTx([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000_000_000 }),
          claimIx(AMOUNT),
        ]),
      'priority-fee-bounded'
    );
  });

  test('rejects a huge unit price even with NO declared limit', () => {
    // Omitting the limit must not sidestep the bound — the runtime would apply
    // its own, so the worst case is assumed rather than treated as zero.
    assertRejected(
      () =>
        makeTx([
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000_000_000 }),
          claimIx(AMOUNT),
        ]),
      'priority-fee-bounded'
    );
  });

  test('rejects a compute unit limit above Solana’s own maximum', () => {
    assertRejected(
      () =>
        makeTx([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 4_000_000_000 }),
          claimIx(AMOUNT),
        ]),
      'compute-unit-limit'
    );
  });
});
