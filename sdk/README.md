# lordspot-sdk

Buy Megapot lottery tickets from Solana and claim winnings — for **server-side
agents and backends**. Node 18+.

Browser is not supported. This SDK is built for backends holding their own keys.

```bash
npm install lordspot-sdk @solana/web3.js @solana/spl-token
```

`@solana/web3.js` and `@solana/spl-token` are **peer** dependencies — you install
and control them, so this SDK can never pull in a compromised transitive copy of
the libraries that sign your transactions. The peer range requires
`@solana/web3.js@^1.95.8` or newer; see "Minimal dependencies" for why that floor
exists.

Your agent wallet needs **both USDC and SOL** — USDC buys tickets, SOL pays
network fees, plus a one-off token-account rent on its first ever claim.

---

## Quick start — buying

```ts
import { createLordsPot, keypairSigner } from 'lordspot-sdk';
import { Keypair } from '@solana/web3.js';

// `network` is required and never guessed — see "Network safety".
const lordspot = createLordsPot({ network: 'devnet' });

const signer = keypairSigner(
  Keypair.fromSecretKey(mySecretKeyBytes)   // never hardcode this
);

// Number ranges change EVERY epoch. quickPick() reads the current ones from
// chain, so never cache tickets across draws.
const tickets = [await lordspot.quickPick(), await lordspot.quickPick()];

const { signatures, totalCostUsdc } = await lordspot.buyTickets(signer, tickets);
console.log(`Bought ${tickets.length} tickets for ${totalCostUsdc} base units`);
```

## Quick start — claiming

```ts
import { LordsPotError, VoucherVerificationError } from 'lordspot-sdk';

const summary = await lordspot.getClaimSummary(signer.publicKey);

if (summary.claimableUsdc > 0n) {
  try {
    // ONE indivisible call: fetch voucher → verify → sign → submit → confirm.
    const claim = await lordspot.claimWinnings(signer);
    console.log(`Claimed ${claim.amountUsdc} base units — ${claim.signature}`);
  } catch (err) {
    if (err instanceof VoucherVerificationError) {
      // The bytes we were asked to sign were NOT a plain claim of this wallet's
      // own winnings. Nothing was signed. This is a security alert, not a
      // transient fault — alert a human, and NEVER retry it.
      alertOncall(err.assertion, err.message);
    } else if (err instanceof LordsPotError && err.code === 'PROTOCOL_PAUSED') {
      // Brief daily epoch rollover — retry in a few minutes.
      retryLater();
    } else throw err;
  }
}
```

**Claiming is all-or-nothing.** There is no partial claim: a voucher sweeps
*every* currently-claimable ticket for the wallet and pays the total in one
transaction. `claimWinnings()` takes no amount, and an amount supplied to the API
by hand is ignored — the figure is derived solely from settled ticket rows.

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
}): LordsPotClient
```

`rpcUrl` is the only network value you can set. The program id, USDC mint and
API host are baked into each release and cannot be overridden — they decide
which program moves your money and whose server co-signs your claims, so a
config typo or a poisoned env var must not be able to redirect them. Your RPC
choice is safe to expose because the SDK verifies the endpoint's genesis hash
matches the requested cluster before signing anything.

### Reading

| Method | Returns | Notes |
|---|---|---|
| `getProtocolState()` | `ProtocolState` | Live on-chain rules. **Re-read every epoch.** |
| `quickPick(rules?)` | `Ticket` | Random valid ticket. Reads live ranges if `rules` omitted. |
| `quoteCost(count)` | `bigint` | Total cost in base units, matching the program's own math. |
| `getTickets(wallet)` | `TicketRecord[]` | Every ticket ever bought, **newest first**. Paginates internally. |
| `getClaimSummary(wallet)` | `ClaimSummary` | What's claimable now. |

`getTickets()` returns the wallet's **complete** history, newest first, fetching
every page for you — there is no cursor to manage and nothing is silently
truncated. A long-lived agent accumulates a lot of rows, so treat it as a real
network call rather than something to poll in a tight loop.

Tickets bought in the same purchase share a timestamp, so their relative order
within that purchase is stable but arbitrary. Match a specific purchase by
`txSignature`, never by array position:

```ts
const fromThisPurchase = (await lordspot.getTickets(wallet))
  .filter((t) => t.txSignature === purchase.signatures[0]);
```

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
  claimableUsdc: bigint;    // total claimable RIGHT NOW, in base units
  freeTickets: number;      // informational only — see below
  totalPaidOutUsdc: bigint; // lifetime, already paid out on Solana
  pendingVoucher: { amountUsdc: bigint; createdAt: string } | null;
}
```

⚠️ **`freeTickets` are already counted inside `claimableUsdc`.** Free-tier wins
are currently paid out as cash like any other win, so `freeTickets` is a
*breakdown* of that total, not an additional balance. **Never add them together
— that double-counts.** The field exists so a UI can say "of which N were free
tickets", and so a future redeem-as-a-ticket flow can find them again.

`pendingVoucher` being non-null means a claim is already in flight for this
wallet; `claimableUsdc` reads `0` until it confirms or expires (~90s). That is
correct behaviour, not an error — see gotcha 5.

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
import { getTicketMatch, isRevealed, timeUntilDraw } from 'lordspot-sdk';

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
7. **`getTickets()` fetches the whole history, every time.** It is newest-first
   and paginates internally, so nothing is truncated — but that also means it
   grows with the wallet. Cache it; don't poll it in a tight loop.
8. **`freeTickets` is already inside `claimableUsdc`.** Adding them
   double-counts.
9. **Claims are all-or-nothing.** You cannot claim a partial amount, and any
   amount you supply is ignored — the total comes from settled ticket rows.
10. **A claim's effect is not instant across every read.** `claimWinnings()`
    returns once the transaction confirms, but `totalPaidOutUsdc` and each
    ticket's `PAID_OUT_ON_SOLANA` status are stamped by a backend confirmer that
    discovers the transaction on-chain. Expect a few seconds of lag; reconcile
    against `claim.signature`, not against an immediate summary re-read.

---

## Error handling

Every failure is a `LordsPotError` with a stable `code`. Codes are API; messages
may change.

```ts
import { LordsPotError, VoucherVerificationError } from 'lordspot-sdk';

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

## A complete agent

Buy, inspect results, claim — the whole lifecycle:

```ts
import {
  createLordsPot, keypairSigner,
  getTicketMatch, isRevealed, timeUntilDraw,
  LordsPotError, VoucherVerificationError,
} from 'lordspot-sdk';
import { Keypair } from '@solana/web3.js';

const lordspot = createLordsPot({ network: 'devnet' });
const signer = keypairSigner(Keypair.fromSecretKey(mySecretKeyBytes));
const usd = (v: bigint) => `$${(Number(v) / 1e6).toFixed(2)}`;

// 1. Read live rules. Ball ranges change every epoch — never cache these.
const state = await lordspot.getProtocolState();
if (state.isPaused) return;                     // brief daily rollover

// 2. Buy.
const tickets = [await lordspot.quickPick(), await lordspot.quickPick()];
const purchase = await lordspot.buyTickets(signer, tickets);
console.log(`Bought ${purchase.ticketCount} for ${usd(purchase.totalCostUsdc)}`);

// 3. Inspect. Relaying to Base takes ~30-60s, so a just-bought ticket will
//    still show baseTxHash: null here — that is expected, not a failure.
for (const t of await lordspot.getTickets(signer.publicKey)) {
  if (!isRevealed(t)) {
    const ms = timeUntilDraw(t);
    console.log(`draw in ${ms === null ? '?' : Math.round(ms / 60_000)}m`);
    continue;
  }
  const m = getTicketMatch(t)!;
  console.log(`matched ${m.normalMatches}/5${m.bonusMatch ? ' + bonus' : ''}`);
}

// 4. Claim everything currently claimable.
const summary = await lordspot.getClaimSummary(signer.publicKey);
if (summary.claimableUsdc > 0n) {
  try {
    const claim = await lordspot.claimWinnings(signer);
    console.log(`Claimed ${usd(claim.amountUsdc)} — ${claim.signature}`);
  } catch (err) {
    if (err instanceof VoucherVerificationError) {
      alertOncall(err.assertion, err.message);   // SECURITY — never retry
    } else if (err instanceof LordsPotError) {
      console.error(`[${err.code}] ${err.message}`);
    } else throw err;
  }
}
```

The snippet above is self-contained — everything it uses is exported from the
package, so you can paste it straight into a file and run it.

---

## Status

`0.1.0-alpha` — **devnet only.** `network: 'mainnet'` throws until the program
is deployed to mainnet-beta.
