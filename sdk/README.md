# @lordspot/sdk

Buy Megapot lottery tickets from Solana and claim winnings — for **server-side
agents and backends**. Node 18+.

Browser is not supported. This SDK is built for backends holding their own keys.

```bash
npm install @lordspot/sdk @solana/web3.js @solana/spl-token
```

---

## Quick start

```ts
import { createLordsPot, keypairSigner } from '@lordspot/sdk';
import { Keypair } from '@solana/web3.js';

// `network` is required and never guessed — see "Network safety".
const lordspot = createLordsPot({ network: 'devnet' });

const signer = keypairSigner(
  Keypair.fromSecretKey(mySecretKeyBytes)   // never hardcode this
);

// quickPick() reads the CURRENT epoch's number ranges from chain.
const tickets = [await lordspot.quickPick(), await lordspot.quickPick()];

const { signatures, totalCostUsdc } = await lordspot.buyTickets(signer, tickets);
console.log(`Bought ${tickets.length} tickets for ${totalCostUsdc} base units`);
```

> **USDC amounts are always `bigint` base units with 6 decimals.**
> `1000000n` = $1.00. There is no floating point anywhere in this SDK — money
> and floats do not mix.

---

## API reference

### `createLordsPot(config)`

```ts
createLordsPot({
  network: 'devnet' | 'mainnet',  // REQUIRED, never inferred
  rpcUrl?: string,                // optional: your own RPC (recommended)
  apiUrl?: string,                // LordsPot local development only
}): LordsPotClient
```

### Reading

| Method | Returns | Notes |
|---|---|---|
| `getProtocolState()` | `ProtocolState` | Live on-chain rules. **Re-read every epoch.** |
| `quickPick(rules?)` | `Ticket` | Random valid ticket. Reads live ranges if `rules` omitted. |
| `quoteCost(count)` | `bigint` | Total cost in base units, matching the program's own math. |
| `getTickets(wallet)` | `TicketRecord[]` | All tickets + relay and draw status. |
| `getClaimSummary(wallet)` | `ClaimSummary` | What's claimable now. |

### Writing (requires a signer)

| Method | Returns | Notes |
|---|---|---|
| `buyTickets(signer, tickets, options?)` | `BuyTicketsResult` | Chunks, signs, confirms. **Not atomic** — see gotchas. |
| `claimWinnings(signer)` | `ClaimResult` | Verifies the voucher before signing. One indivisible call. |

`buyTickets` options:
```ts
{ computeUnitLimit?: number, priorityFeeMicroLamports?: number }
```

### Draw results (no network calls — pure functions)

| Function | Returns | Notes |
|---|---|---|
| `getTicketMatch(ticket)` | `TicketMatch \| null` | `null` until revealed. Order-independent. |
| `isRevealed(ticket)` | `boolean` | Has this ticket's draw revealed? |
| `timeUntilDraw(ticket, now?)` | `number \| null` | ms until the draw; `0` once passed. |

### Validation

```ts
validateTicket(ticket, { normalMax, bonusMax }): string | null
```
Returns a human-readable reason, or `null` if valid. Useful when a user picks
their own numbers and you want to show why one is rejected before spending
anything. `buyTickets()` validates internally too, so this is optional.

### Signers

```ts
keypairSigner(keypair)   // wraps a local Keypair
```
Or implement it yourself for KMS/HSM/remote signing:
```ts
interface LordsPotSigner {
  publicKey: PublicKey;
  signTransaction(tx: Transaction): Promise<Transaction>;
}
```
The SDK never asks for, stores, or transmits a secret key.

---

## Types

### `ProtocolState`
```ts
{
  normalMax: number;              // highest normal number THIS epoch
  bonusMax: number;               // highest bonus number THIS epoch
  ticketPriceUsdc: bigint;
  relayFeeBaseUsdc: bigint;       // currently 0
  relayFeePerTicketUsdc: bigint;  // currently 0
  maxTicketsPerPurchase: number;  // max per instruction; SDK chunks to this
  maxClaimAmountUsdc: bigint;
  isPaused: boolean;
  ongoingEpoch: bigint;
  admin: PublicKey;
  feeRecipient: PublicKey;
}
```

### `TicketRecord`
```ts
{
  id: string;
  normalBalls: number[];          // this ticket's numbers
  bonusBall: number;
  winStatus: WinStatus;
  winAmountUsdc: bigint;          // authoritative payout
  isFreeTicketTier: boolean;
  purchaseEpoch: number | null;
  fulfillEpoch: number | null;    // epoch it actually plays in
  orderStatus: string;
  purchasedAt: string | null;
  orderHash: string;
  txSignature: string;            // buyer's Solana tx
  baseTxHash: string | null;      // null until relayed to Base

  // Draw results — null until revealed
  epochWinningNormals: number[] | null;
  epochWinningBonusBall: number | null;
  epochEndedAt: string | null;    // countdown target
  epochSettledAt: string | null;
}
```

`winStatus` progresses:
`DRAW_PENDING` → `LOST` | `WON_UNCLAIMED` | `WON_FREE_TICKET` → `CLAIMED_ON_BASE` → `PAID_OUT_ON_SOLANA`

### `ClaimSummary`
```ts
{
  claimableUsdc: bigint;
  freeTickets: number;
  totalPaidOutUsdc: bigint;
  pendingVoucher: { amountUsdc: bigint; createdAt: string } | null;
}
```

---

## Three stages, not one

A purchase reaches "done" in three distinct steps. Surface them separately —
users notice when a UI says "complete" while the ticket is still relaying.

| Stage | How to detect | Typical delay |
|---|---|---|
| **Bought on Solana** | `buyTickets()` resolves | ~1s |
| **Relayed to Base** | `ticket.baseTxHash !== null` | ~30–60s |
| **Draw revealed** | `isRevealed(ticket)` | after the daily draw |

---

## Showing draw results

Winning numbers ship with each ticket once revealed, so no extra call is needed:

```ts
import { getTicketMatch, isRevealed, timeUntilDraw } from '@lordspot/sdk';

for (const t of await lordspot.getTickets(wallet)) {
  if (!isRevealed(t)) {
    const ms = timeUntilDraw(t);
    console.log(`Draw in ${ms === null ? '?' : Math.round(ms / 60000)} minutes`);
    continue;
  }

  const m = getTicketMatch(t)!;
  console.log(`Your numbers : ${t.normalBalls.join(', ')} + ${t.bonusBall}`);
  console.log(`Drawn        : ${t.epochWinningNormals!.join(', ')} + ${t.epochWinningBonusBall}`);
  console.log(`Matched      : ${m.matchedNormals.join(', ') || 'none'}${m.bonusMatch ? ' + bonus' : ''}`);

  if (t.winAmountUsdc > 0n) console.log(`Won ${t.winAmountUsdc} base units`);
}
```

⚠️ **Use `getTicketMatch()` rather than comparing arrays yourself.** Normal
numbers are a **set, not a sequence**. A ticket holding `[3, 7, 11]` against a
draw of `[11, 3, 20]` matches two numbers — but a position-by-position
comparison reports zero. Draw results genuinely do arrive unsorted.

`winStatus` and `winAmountUsdc` are authoritative for what was won.
`getTicketMatch()` is for presentation only.

---

## Security model

### The SDK never sees your private key

You pass a `LordsPotSigner`. Keys can live in a KMS, HSM, or remote signer.

### Claim vouchers are verified before signing

Claiming is **two-signature**: the LordsPot admin co-signs the amount, you
co-sign consent. Neither alone can move funds.

A voucher arrives as opaque bytes from the LordsPot API, already admin-signed.
**This SDK never signs them unexamined.** It reconstructs, from locally-derived
values only, exactly what a legitimate claim must look like, and refuses
anything that differs:

| Check | What it stops |
|---|---|
| Exactly one LordsPot instruction | Bundling a hidden second call |
| No foreign programs (except ComputeBudget) | A smuggled token/SOL transfer |
| Correct `claim_winnings` discriminator | A different instruction in disguise |
| Amount matches an independent summary read | A silently inflated payout |
| Amount within the on-chain ceiling | Absurd amounts from a bad upstream number |
| Every account derived locally and compared | Payout redirected to an attacker |
| Only claimant + admin may be signers | Sneaking in an extra authorisation |
| Admin signature verifiably present | Signing something never authorised |
| Claimant is the fee payer | Fee-payer substitution |

Failing any check throws `VoucherVerificationError` **before a signature
exists**. That is a security alert, not a transient fault — **never retry it.**

This reduces trust from *"LordsPot's server is honest"* to *"LordsPot's on-chain
program is honest."* The second is publicly auditable.

### Network safety

`network` is required and never inferred — auto-detection is how someone "tests"
against mainnet and spends real money. Before signing anything, the SDK verifies
the RPC's genesis hash matches the declared cluster, catching a stale mainnet
`RPC_URL` in a config labelled devnet.

Program ID, USDC mint, and API URL are **baked in per network** and cannot be
overridden, so a poisoned environment variable can't redirect you elsewhere.

### Minimal dependencies

Runtime deps are only `@solana/web3.js` and `@solana/spl-token`. Instructions are
encoded directly rather than via Anchor — for a library that signs money-moving
transactions, every extra dependency is attack surface. No `postinstall` scripts,
no telemetry.

---

## Things that will bite you

1. **Number ranges change every epoch.** `normalMax`/`bonusMax` shift at
   rollover. Always generate against live state (`quickPick()` does this).
   Reusing yesterday's ranges produces tickets that revert.
2. **The protocol pauses briefly at each daily rollover.** Treat
   `PROTOCOL_PAUSED` as *retry later*, not as an error.
3. **Your agent needs SOL, not just USDC** — it pays network fees for buying and
   claiming, plus token-account rent on a first-ever claim.
4. **Large baskets are NOT atomic.** Above the per-transaction cap a purchase
   becomes several transactions, and Solana has no cross-transaction atomicity.
   If one fails, earlier ones stay landed. `signatures` reports what actually
   succeeded — always reconcile with `getTickets()`.
5. **One live voucher per wallet.** Request a second while one is pending and
   you get metadata *without* transaction bytes. Wait ~90 seconds for expiry.
   `claimWinnings()` is one indivisible call for exactly this reason.
6. **Never make the fee recipient a wallet that also buys tickets** — buyer and
   fee recipient resolving to the same account fails on-chain.

---

## Error handling

Every failure is a `LordsPotError` with a stable `code`. Codes are API; messages
may change.

```ts
import { LordsPotError, VoucherVerificationError } from '@lordspot/sdk';

try {
  await lordspot.claimWinnings(signer);
} catch (err) {
  if (err instanceof VoucherVerificationError) {
    // SECURITY ALERT — do not retry. Report immediately.
    alertOncall(err.assertion, err.message);
  } else if (err instanceof LordsPotError) {
    switch (err.code) {
      case 'PROTOCOL_PAUSED':         return retryIn(5 * 60_000);
      case 'RPC_ERROR':               return retryWithBackoff();
      case 'VOUCHER_ALREADY_PENDING': return retryIn(90_000);
      case 'NOTHING_TO_CLAIM':        return;              // not an error
      case 'INSUFFICIENT_USDC':
      case 'INSUFFICIENT_SOL':        return notifyUser(err.message);
      case 'NETWORK_MISMATCH':        throw err;           // config bug
    }
  }
}
```

| Code | Retry? |
|---|---|
| `PROTOCOL_PAUSED` | Yes, in a few minutes |
| `RPC_ERROR`, `API_ERROR` | Yes, with backoff |
| `VOUCHER_ALREADY_PENDING` | Yes, after ~90s |
| `NOTHING_TO_CLAIM` | No — normal state |
| `INSUFFICIENT_USDC` / `INSUFFICIENT_SOL` | No — fund the wallet |
| `INVALID_TICKET`, `TOO_MANY_TICKETS`, `NO_TICKETS` | No — fix the input |
| `NETWORK_MISMATCH`, `INVALID_CONFIG`, `NETWORK_UNAVAILABLE` | No — config bug |
| `VOUCHER_VERIFICATION_FAILED` | **Never.** Security alert. |
| `TRANSACTION_FAILED` | Check the message; reconcile with `getTickets()` first |

---

## Example

A complete agent — buy, inspect results, claim — is in
[`examples/agent.ts`](./examples/agent.ts).

---

## Status

`0.1.0-alpha` — **devnet only.** `network: 'mainnet'` throws until the program
is deployed to mainnet-beta.
