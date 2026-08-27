import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { VoucherVerificationError } from './errors';
import { CLAIM_WINNINGS_DISCRIMINATOR } from './instructions';
import { getLordsPotStatePda, getUserUsdcAta, getVaultAuthorityPda, getVaultUsdcAta } from './pdas';

/**
 * ============================================================================
 * THE SECURITY BOUNDARY OF THIS ENTIRE SDK.
 * ============================================================================
 *
 * A claim voucher arrives as opaque bytes from the LordsPot API, already
 * partially signed by the protocol admin. The caller is then asked to add their
 * own signature — which authorises whatever those bytes actually say.
 *
 * Signing them unexamined means: if the API were ever compromised, it could
 * return a transaction that drains the signer's wallet (an SPL transfer to an
 * attacker, an `approve` granting unlimited delegation, a `closeAccount`), and
 * the SDK would obediently sign it. The user would see "claiming winnings" and
 * lose everything.
 *
 * So the SDK reconstructs, from first principles and using ONLY locally derived
 * values, exactly what a legitimate claim must look like — then refuses to sign
 * anything that differs by a single account or byte.
 *
 * Trust is reduced from "LordsPot's server is honest" to "LordsPot's on-chain
 * program is honest". The second is publicly auditable; the first is not.
 *
 * NOTHING IS SIGNED UNTIL EVERY CHECK BELOW PASSES.
 */

export interface VoucherExpectations {
  programId: PublicKey;
  usdcMint: PublicKey;
  /** The wallet that will sign — the ONLY legitimate payout destination. */
  claimant: PublicKey;
  /** Admin key read from on-chain state, NOT from the API response. */
  expectedAdmin: PublicKey;
  /** Amount independently reported by /claims/summary, in USDC base units. */
  expectedAmountUsdc: bigint;
  /** On-chain payout ceiling — an upper bound no legitimate claim can exceed. */
  maxClaimAmountUsdc: bigint;
}

/** Instructions permitted alongside the claim. Anything else is rejected. */
const ALLOWED_EXTRA_PROGRAM_IDS = new Set([ComputeBudgetProgram.programId.toBase58()]);

// ComputeBudget instructions are permitted above, which makes their VALUES part
// of the attack surface: the claimant is the fee payer, and the priority fee is
// compute_unit_limit x compute_unit_price / 1e6 lamports. Left unbounded, a
// compromised API could attach a legitimate-looking claim to an astronomical
// unit price and drain the signer's entire SOL balance as a priority fee —
// no foreign instruction, no redirected payout, every other check passing.
const CB_SET_UNIT_LIMIT = 2;
const CB_SET_UNIT_PRICE = 3;

/** Solana's own per-transaction ceiling; a larger value is nonsense. */
const MAX_COMPUTE_UNIT_LIMIT = 1_400_000n;

/** Assumed limit when none is declared, for the fee bound below. */
const DEFAULT_COMPUTE_UNIT_LIMIT = 1_400_000n;

/**
 * Ceiling on the priority fee a claim may pay, in lamports. 0.01 SOL is orders
 * of magnitude above what a claim needs (~100k CU) while capping the worst case
 * a hostile voucher can cost at roughly a cent.
 */
const MAX_PRIORITY_FEE_LAMPORTS = 10_000_000n;

function assert(condition: boolean, name: string, detail: string): asserts condition {
  if (!condition) throw new VoucherVerificationError(name, detail);
}

/**
 * Verifies a decoded claim transaction against locally-derived expectations.
 *
 * Throws `VoucherVerificationError` on the first failed assertion. Returns the
 * verified claim amount so the caller can display exactly what was authorised.
 */
export function verifyClaimVoucher(tx: Transaction, expect: VoucherExpectations): bigint {
  // ---- 1. Exactly one instruction targets our program; the rest are benign. ----
  const claimIxs: TransactionInstruction[] = [];
  const computeBudgetIxs: TransactionInstruction[] = [];
  for (const ix of tx.instructions) {
    const pid = ix.programId.toBase58();
    if (pid === expect.programId.toBase58()) {
      claimIxs.push(ix);
    } else {
      assert(
        ALLOWED_EXTRA_PROGRAM_IDS.has(pid),
        'no-foreign-instructions',
        `transaction contains an instruction for an unexpected program (${pid}). ` +
          `Only LordsPot and ComputeBudget instructions are permitted in a claim.`
      );
      computeBudgetIxs.push(ix);
    }
  }
  assert(
    claimIxs.length === 1,
    'exactly-one-claim-instruction',
    `expected exactly 1 LordsPot instruction, found ${claimIxs.length}. ` +
      `A claim must never bundle multiple program calls.`
  );
  const ix = claimIxs[0]!;

  // ---- 2. It is claim_winnings, identified by Anchor's discriminator. ----
  // Exactly 16: claim_winnings takes one u64. Trailing bytes are not something
  // a legitimate encoder produces, and "at least" would leave a region of the
  // signed payload that nothing here ever looks at.
  assert(
    ix.data.length === 16,
    'instruction-data-length',
    `claim instruction data is ${ix.data.length} bytes; expected exactly 16 (8 discriminator + 8 amount).`
  );
  const disc = ix.data.subarray(0, 8);
  assert(
    disc.equals(CLAIM_WINNINGS_DISCRIMINATOR),
    'is-claim-winnings',
    `instruction discriminator [${[...disc].join(',')}] is not claim_winnings ` +
      `[${[...CLAIM_WINNINGS_DISCRIMINATOR].join(',')}]. This transaction does something else entirely.`
  );

  // ---- 3. The amount matches what we independently believe is owed. ----
  const amount = ix.data.readBigUInt64LE(8);
  assert(
    amount === expect.expectedAmountUsdc,
    'amount-matches-summary',
    `voucher would transfer ${amount} base units, but the API's own claim summary ` +
      `reported ${expect.expectedAmountUsdc}. These must agree exactly.`
  );
  assert(
    amount > 0n,
    'amount-positive',
    'voucher amount is zero.'
  );
  assert(
    amount <= expect.maxClaimAmountUsdc,
    'amount-within-ceiling',
    `voucher amount ${amount} exceeds the on-chain payout ceiling ${expect.maxClaimAmountUsdc}.`
  );

  // ---- 4. Every account is exactly the one we derive locally. ----
  // Order and length are fixed by the program's ClaimWinnings struct. Deriving
  // rather than trusting is what stops a hostile server redirecting the payout.
  //
  // All TEN are listed, including the three program ids. Anchor does validate
  // those on-chain, so substituting one fails there — but a voucher naming a
  // different "token program" is not a voucher worth signing, and an exact
  // length additionally means nothing can be appended for the verifier to skip.
  const expectedAccounts: Array<{ name: string; key: PublicKey }> = [
    { name: 'user', key: expect.claimant },
    { name: 'admin', key: expect.expectedAdmin },
    { name: 'lords_pot_state', key: getLordsPotStatePda(expect.programId) },
    { name: 'user_usdc_account', key: getUserUsdcAta(expect.claimant, expect.usdcMint) },
    { name: 'vault_usdc_account', key: getVaultUsdcAta(expect.programId, expect.usdcMint) },
    { name: 'vault_authority', key: getVaultAuthorityPda(expect.programId) },
    { name: 'usdc_mint', key: expect.usdcMint },
    { name: 'system_program', key: SystemProgram.programId },
    { name: 'token_program', key: TOKEN_PROGRAM_ID },
    { name: 'associated_token_program', key: ASSOCIATED_TOKEN_PROGRAM_ID },
  ];

  assert(
    ix.keys.length === expectedAccounts.length,
    'account-count',
    `claim instruction has ${ix.keys.length} accounts, expected exactly ${expectedAccounts.length}. ` +
      `Extra accounts reach the program as remaining_accounts and are not something a claim should carry.`
  );

  expectedAccounts.forEach((want, i) => {
    const got = ix.keys[i]!;
    assert(
      got.pubkey.equals(want.key),
      `account-${want.name}`,
      `account #${i} (${want.name}) is ${got.pubkey.toBase58()}, expected ${want.key.toBase58()}. ` +
        `Funds would go somewhere other than the claimant's own token account.`
    );
  });

  // ---- 5. Only the claimant and the admin may be required signers. ----
  const requiredSigners = ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58());
  const permitted = new Set([expect.claimant.toBase58(), expect.expectedAdmin.toBase58()]);
  for (const s of requiredSigners) {
    assert(
      permitted.has(s),
      'no-unexpected-signers',
      `transaction requires a signature from ${s}, which is neither the claimant nor the protocol admin.`
    );
  }

  // ---- 6. The admin's co-signature is genuinely present already. ----
  // Without this the "two-signature" guarantee is theatre: an unsigned voucher
  // would simply fail on-chain, but confirming it here means the caller is not
  // signing something the protocol never authorised.
  const adminSig = tx.signatures.find((s) => s.publicKey.equals(expect.expectedAdmin));
  assert(
    adminSig !== undefined && adminSig.signature !== null,
    'admin-already-signed',
    `the protocol admin (${expect.expectedAdmin.toBase58()}) has not signed this voucher. ` +
      `A legitimate voucher always arrives pre-signed by the admin.`
  );

  // ---- 7. The claimant must be the fee payer (signature slot 0). ----
  assert(
    tx.feePayer !== undefined && tx.feePayer.equals(expect.claimant),
    'claimant-is-fee-payer',
    `fee payer is ${tx.feePayer?.toBase58() ?? 'unset'}, expected the claimant ${expect.claimant.toBase58()}.`
  );

  // ---- 8. The priority fee this voucher commits the claimant to is bounded. ----
  // Step 7 just established the claimant pays the fee, which is precisely why
  // this matters: every other check can pass while the transaction quietly
  // carries a compute-unit price that costs the signer their whole SOL balance.
  let unitLimit: bigint | null = null;
  let unitPrice = 0n;

  for (const cb of computeBudgetIxs) {
    if (cb.data.length === 0) continue;
    const kind = cb.data[0];

    if (kind === CB_SET_UNIT_LIMIT && cb.data.length >= 5) {
      const declared = BigInt(cb.data.readUInt32LE(1));
      assert(
        declared <= MAX_COMPUTE_UNIT_LIMIT,
        'compute-unit-limit',
        `compute unit limit ${declared} exceeds Solana's per-transaction maximum ${MAX_COMPUTE_UNIT_LIMIT}.`
      );
      unitLimit = declared;
    } else if (kind === CB_SET_UNIT_PRICE && cb.data.length >= 9) {
      unitPrice = cb.data.readBigUInt64LE(1);
    }
  }

  // No declared limit means the runtime applies its own; assume the worst case
  // so the bound cannot be sidestepped by simply omitting the limit.
  const effectiveLimit = unitLimit ?? DEFAULT_COMPUTE_UNIT_LIMIT;
  const priorityFeeLamports = (effectiveLimit * unitPrice) / 1_000_000n;

  assert(
    priorityFeeLamports <= MAX_PRIORITY_FEE_LAMPORTS,
    'priority-fee-bounded',
    `this voucher would pay a priority fee of ${priorityFeeLamports} lamports ` +
      `(${effectiveLimit} CU x ${unitPrice} microLamports/CU), above the ${MAX_PRIORITY_FEE_LAMPORTS} ` +
      `lamport ceiling. The claimant pays that fee, so an inflated compute unit price ` +
      `drains SOL while every other part of the claim looks legitimate.`
  );

  return amount;
}
