# @lordspot/sdk

Buy Megapot lottery tickets from Solana and claim winnings — for **server-side
agents and backends**. Node 18+.

Browser is not supported. This SDK is built for backend agents holding their own
keys.

```bash
npm install @lordspot/sdk @solana/web3.js @solana/spl-token
```

---

## Quick start

```ts
import { createLordsPot, keypairSigner } from '@lordspot/sdk';
import { Keypair } from '@solana/web3.js';

// `network` is required and never guessed — see "Network safety" below.
const lordspot = createLordsPot({ network: 'devnet' });

const signer = keypairSigner(
  Keypair.fromSecretKey(bs58.decode(process.env.AGENT_PRIVATE_KEY!))
);

// Ball ranges change every epoch — always generate against live state.
const tickets = [await lordspot.quickPick(), await lordspot.quickPick()];

const { signatures, totalCostUsdc } = await lordspot.buyTickets(signer, tickets);
console.log(`Bought ${tickets.length} tickets for ${totalCostUsdc} base units`);
```

Claiming:

```ts
const summary = await lordspot.getClaimSummary(signer.publicKey);
if (summary.claimableUsdc > 0n) {
  const { signature, amountUsdc } = await lordspot.claimWinnings(signer);
  console.log(`Claimed ${amountUsdc} base units — ${signature}`);
}
```

---

## Security model — read this before going to production

### The SDK never sees your private key

You pass a `LordsPotSigner` — `{ publicKey, signTransaction }`. Keys can live in
a KMS, an HSM, or a remote signing service; this SDK never asks for, stores, or
transmits secret material.

### Claim vouchers are cryptographically verified before signing

Claiming is a **two-signature** operation: the LordsPot admin co-signs the
amount, you co-sign consent. Neither party alone can move funds.

A voucher arrives as opaque bytes from the LordsPot API, already admin-signed.
**This SDK never signs those bytes unexamined.** It reconstructs, using only
locally-derived values, exactly what a legitimate claim must look like, and
refuses anything that differs:

| Check | What it stops |
|---|---|
| Exactly one LordsPot instruction | Bundling a claim with a hidden second call |
| No foreign programs (except ComputeBudget) | A smuggled SPL transfer or SOL drain |
| Correct `claim_winnings` discriminator | A different instruction disguised as a claim |
| Amount matches independent `/summary` read | A silently inflated payout |
| Amount within the on-chain ceiling | Absurd amounts from a bad upstream number |
| Every account derived locally, compared exactly | Payout redirected to an attacker's account |
| Only claimant + admin may be required signers | Sneaking in an extra authorisation |
| Admin signature verifiably already present | Signing something the protocol never authorised |
| Claimant is the fee payer | Fee-payer substitution |

Failing any check throws `VoucherVerificationError` **before a signature
exists**. That is a security alert, not a transient fault — never retry it.

This reduces trust from *"LordsPot's server is honest"* to *"LordsPot's on-chain
program is honest."* The second is publicly auditable.

### Network safety

`network` is required and never inferred, because auto-detection is exactly how
someone "tests" against mainnet and spends real money. Before anything is
signed, the SDK verifies the RPC's genesis hash actually matches the declared
cluster — catching a stale mainnet `RPC_URL` in a config labelled devnet.

Program ID, USDC mint, and API URL are **baked into the SDK per network** and
cannot be overridden, so a poisoned environment variable can't redirect you to
an attacker's program.

### Minimal dependency surface

Runtime dependencies are only `@solana/web3.js` and `@solana/spl-token`.
Instructions are encoded directly rather than via Anchor's client — for a
library that signs money-moving transactions, every extra dependency is attack
surface. There are no `postinstall` scripts and no telemetry.

---

## Things that will bite you

1. **Ball ranges change every epoch.** `normalMax`/`bonusMax` shift at rollover.
   Always generate tickets against live state (`quickPick()` does this for you).
   Reusing yesterday's ranges produces tickets that revert.
2. **The protocol pauses briefly during the daily epoch rollover.** Purchases and
   claims revert for a few minutes. Treat `PROTOCOL_PAUSED` as *retry later*,
   not as an error state.
3. **Your agent needs SOL, not just USDC.** It pays the network fee for both
   buying and claiming, plus token-account rent on a first-ever claim.
4. **Large baskets are NOT atomic.** Above the on-chain per-transaction cap, a
   purchase becomes several transactions. Solana has no cross-transaction
   atomicity — if one fails, earlier ones stay landed. Always reconcile with
   `getTickets()` rather than assuming all-or-nothing.
5. **One live voucher per wallet.** Request a second while one is pending and you
   get metadata *without* transaction bytes. Wait ~90 seconds for expiry.
   `claimWinnings()` is deliberately one indivisible call for this reason.

---

## Error handling

Every failure is a `LordsPotError` with a stable `code`:

```ts
import { LordsPotError, VoucherVerificationError } from '@lordspot/sdk';

try {
  await lordspot.buyTickets(signer, tickets);
} catch (err) {
  if (err instanceof VoucherVerificationError) {
    // SECURITY ALERT — do not retry. Report immediately.
  } else if (err instanceof LordsPotError) {
    switch (err.code) {
      case 'PROTOCOL_PAUSED':  break; // retry in a few minutes
      case 'INSUFFICIENT_USDC': break; // top up
      case 'NETWORK_MISMATCH':  break; // config bug — nothing was signed
    }
  }
}
```

Codes: `INVALID_CONFIG`, `NETWORK_MISMATCH`, `NETWORK_UNAVAILABLE`,
`INVALID_TICKET`, `TOO_MANY_TICKETS`, `NO_TICKETS`, `PROTOCOL_PAUSED`,
`INSUFFICIENT_USDC`, `INSUFFICIENT_SOL`, `NOTHING_TO_CLAIM`,
`VOUCHER_ALREADY_PENDING`, `VOUCHER_VERIFICATION_FAILED`, `API_ERROR`,
`RPC_ERROR`, `TRANSACTION_FAILED`.

---

## Status

`0.1.0-alpha` — **devnet only.** `network: 'mainnet'` throws until the program is
deployed to mainnet-beta.
