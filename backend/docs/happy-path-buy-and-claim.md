# The Happy Path — Buying a Ticket and Claiming Winnings

This document walks through the two big journeys of the whole system, step by step,
in simple English. For every step it tells you:

- **which file** does the work,
- **what it does** in plain words,
- **which status changes** (and from what, to what).

This is the "everything went right" version — no crashes, no retries, no failures.
For what happens when things go wrong, and for the timer-based workers in more
detail, see `worker-flows.md` in this same folder.

Two quick words you'll see a lot:

- **RelayOrder** = one purchase. When a user buys 5 tickets in one go, that's ONE
  RelayOrder with 5 Ticket rows attached to it.
- **Ticket** = one single lottery ticket (5 normal numbers + 1 bonus number).

There are two separate "status" fields that travel through their own journeys:

- `RelayOrder.status` — tracks the **buying** journey (getting the ticket bought on
  Base).
- `Ticket.winStatus` — tracks the **winning-and-getting-paid** journey (did it win,
  and did the user get their money).

---

# PART 1 — THE BUY FLOW

**Goal:** a user pays USDC on Solana, and we make sure an equal ticket purchase
happens on Base inside Megapot's lottery.

Picture the whole trip first, then we'll go step by step:

```
User pays on Solana
  → Helius tells our backend "something happened"
  → we double-check it on the Solana chain ourselves
  → we decode it into a purchase + tickets and save them
  → we send a matching buy to the Base vault
  → we confirm the Base transaction actually succeeded
  → DONE: order is SUCCESS, tickets are waiting for the draw
```

---

## Step 1 — The user buys on Solana

**File:** the Solana smart contract (`solana_smart_contracts/.../lib.rs`, the
`buy_ticket` function). This is on the blockchain, not our backend.

The user signs a transaction that moves their USDC into our vault's token account
and picks their lottery numbers. The contract checks the numbers are valid, takes
the USDC, and shouts out an event called `TicketPurchaseEvent` (which contains the
buyer, the amount, the ticket numbers, and the current epoch).

**Status:** nothing in our database yet — this all happened on-chain. Our backend
doesn't even know about it until the next step.

---

## Step 2 — Helius rings the doorbell

**File:** `src/routes/webhook.ts` (the `POST /helius` route).

Helius is a service that watches the Solana chain for us. The moment our contract is
used, Helius sends our backend a message saying "hey, this transaction signature
just happened." **We treat this only as a doorbell — a hint to go look. We do not
trust anything inside the message itself.**

What this file does:

- Checks the secret auth header so random people can't fake calls to us.
- Pulls out the transaction signature.
- Does a cheap Redis check ("have I already seen this signature recently?") to avoid
  doing the same work twice.
- Saves a row into the **WebhookInbox** table with status **`RECEIVED`**.
- Drops a job onto the `webhookIngestQueue` so a worker can pick it up.
- Only *after* all that succeeds, it marks the signature as "seen" in Redis.

**Status change:** a new WebhookInbox row is created → **`RECEIVED`**.

---

## Step 3 — We verify it against the chain ourselves

**File:** `src/workers/webhookIngestWorker.ts`.

This worker picks up the job from the queue. Here is the most important trust idea in
the whole system: **it ignores the webhook's contents and re-fetches the real
transaction straight from the Solana blockchain using our own RPC.** The chain is the
only source of truth. This means even if someone sent us a fake webhook, nothing bad
can happen — because we go read the real chain data.

What it does:

- Looks up the real transaction on Solana by its signature.
- Checks that it actually contains a `BuyTicket` instruction (a real ticket
  purchase). If it doesn't (for example, this was our own pause transaction bouncing
  back), it marks the inbox row **`SKIPPED`** and stops.
- If it is a real buy, it passes the transaction's logs forward onto the
  `ticketIngestQueue` for the next worker.
- Marks the WebhookInbox row **`PROCESSED`**.

**Status change:** WebhookInbox row goes `RECEIVED` → **`PROCESSED`** (happy path) or
`RECEIVED` → **`SKIPPED`** (not a ticket buy).

---

## Step 4 — We decode the purchase and save it

**File:** `src/workers/ticketWorker.ts`.

This worker takes the logs and decodes the hidden `TicketPurchaseEvent` out of them
(the event is base64-packed inside the logs, so it uses Anchor's event parser to read
it). Now it knows exactly who bought, how much they paid, which numbers they picked,
and which epoch they bought in.

What it does:

- Creates one **RelayOrder** row (the purchase) — this is where the buying journey
  officially begins.
- Creates one **Ticket** row for each ticket the user bought, attached to that order.
- Puts a job on the `baseRelayQueue` so the next worker can send the matching buy to
  Base.

**Status change:**
- A new RelayOrder is created with status **`QUEUED`** ("ready to be sent to Base").
- Each new Ticket is created with winStatus **`DRAW_PENDING`** ("waiting for the
  lottery draw"). The tickets will sit at `DRAW_PENDING` for a while — all the way
  until Part 2.

---

## Step 5 — We send the matching buy to Base

**File:** `src/workers/baseRelayWorker.ts` (this is the "submitter"). It leans on
`src/services/baseService.ts` to actually talk to the Base chain.

This worker picks up the order and sends the real buy transaction to our Base vault
(which forwards it into Megapot). It does a few safety checks first, then fires the
transaction and — importantly — **walks away immediately without waiting for the
result.** Waiting would be slow; instead, a separate confirmer (Step 6) checks the
result later. This is what lets many buys be in flight at once.

What it does:

- Checks the order is in a sendable state, the protocol isn't paused, the epoch isn't
  locked, and the vault has enough USDC.
- Grabs the order (marks it `PROCESSING` so no other worker touches it).
- Sends `buyTickets()` to the Base vault.
- Saves the transaction hash immediately and marks the order **`BASE_SUBMITTED`**.

**Status change:** RelayOrder goes `QUEUED` → `PROCESSING` → **`BASE_SUBMITTED`**
("we sent it, waiting to hear back").

---

## Step 6 — We confirm the Base buy actually worked

**File:** `src/workers/baseConfirmer.ts` (this is worker #1 from `worker-flows.md`;
it wakes up every 5 seconds).

This is the last step of buying. The confirmer finds orders stuck at
`BASE_SUBMITTED` and checks the Base blockchain to see how they turned out. On the
happy path, the receipt says SUCCESS.

What it does on success:

- Reads the real Megapot ticket NFT IDs out of the transaction receipt and saves one
  onto each Ticket row (`megapotNftId`). **These NFT IDs matter a lot later — they're
  what we use to collect winnings in Part 2.**
- Stamps the order with `fulfillEpoch` — the epoch the tickets actually landed in.
  **This stamp is the hinge of the entire system**: Part 2's settlement and harvest
  both find tickets by matching on `fulfillEpoch`.
- Marks the order **`SUCCESS`**.

**Status change:** RelayOrder goes `BASE_SUBMITTED` → **`SUCCESS`**. The tickets are
still **`DRAW_PENDING`** — buying is done, but the lottery draw hasn't happened yet.

---

### End of the buy flow

At this point the user's money has become real lottery tickets inside Megapot. The
order is `SUCCESS`, and every ticket is `DRAW_PENDING`, quietly waiting for the
lottery draw for its epoch. Nothing more happens for this ticket until the draw
concludes — which is where Part 2 begins.

---

# PART 2 — THE CLAIM FLOW

**Goal:** after the lottery draw, figure out which tickets won, collect that money out
of Megapot into our vault, and let the user pull their winnings onto their own Solana
wallet.

Picture the whole trip first:

```
Lottery draw happens for the epoch
  → we grade every ticket: won or lost, and how much
  → we collect the winning money from Megapot into our Base vault
  → user clicks "Claim" on the frontend
  → we hand them a pre-signed voucher; they co-sign and submit it
  → we confirm the payout landed on Solana
  → DONE: the user has their USDC
```

Remember: the tickets have been sitting at **`DRAW_PENDING`** ever since Step 4 of the
buy flow.

---

## Step 7 — Grade the tickets (won or lost)

**File:** `src/workers/settlementWorker.ts` (worker #2; wakes up every 60 seconds).

Once Megapot runs the draw for an epoch and we have the results saved (winning
numbers + the prize table), this worker grades every waiting ticket for that epoch.

What it does:

- Finds every epoch that has results but hasn't been graded yet.
- For each ticket in that epoch (matched by `fulfillEpoch`), it counts the matching
  numbers and looks up the payout tier.
- If the tier pays zero → the ticket becomes **`LOST`**.
- If the tier pays real money → the ticket becomes **`WON_UNCLAIMED`**, and it saves
  the **net** amount into `winAmount` (the prize minus Megapot's 10% referral cut,
  calculated exactly the way Megapot's contract does it).
- Two special tiers pay a free ticket instead of cash → those become
  **`WON_FREE_TICKET`**, and get permanently stamped `isFreeTicketTier = true`.
- When every ticket in the epoch is graded, it stamps the epoch's `ticketsSettledAt`
  ("this epoch is fully graded").

**Status change:** each Ticket goes `DRAW_PENDING` → **`LOST`** /
**`WON_UNCLAIMED`** / **`WON_FREE_TICKET`**. (Lost tickets stop here forever. Winners
continue.)

---

## Step 8 — Collect the winnings into our Base vault (Harvest)

**File:** `src/workers/harvestWorker.ts` (worker #3; wakes up every 60 seconds). It
uses `src/services/baseService.ts` to talk to Base.

The winning money is still inside Megapot, and the ticket NFTs are owned by our vault
(not the user). So we go collect it. We do this in batches (up to 50 tickets per
transaction) to save on fees.

What it does on the happy path:

- Finds epochs that are graded (`ticketsSettledAt` set) but not yet collected
  (`ticketsHarvestedAt` empty).
- Gathers the winning tickets (using the `megapotNftId` we saved back in Step 6).
- Does a free "rehearsal" to make sure all the NFT IDs are collectable.
- Creates a **HarvestBatch** row (status **`SUBMITTED`**), binds the tickets to it,
  then sends the `claimWinnings()` transaction to the Base vault. Megapot pays the
  winning USDC into our vault and burns the ticket NFTs.
- When the receipt confirms, it marks the batch **`CONFIRMED`** and moves the tickets
  forward. It also double-checks the amount the chain paid matches what we expected
  (if not, it shouts an alert).

**Status change:**
- HarvestBatch goes `SUBMITTED` → **`CONFIRMED`**.
- Each winning Ticket goes `WON_UNCLAIMED` / `WON_FREE_TICKET` → **`CLAIMED_ON_BASE`**
  ("the money is now safely in our Base vault, waiting for the user to pull it").

At this point the money for this ticket is sitting in our vault float. The user hasn't
touched anything yet — the next step waits for *them*.

---

## Step 9 — The user asks to claim

**File:** `src/routes/claims.ts` (the `POST /v1/claims/voucher` route). This is
triggered by the user clicking "Claim" on the frontend — it is NOT a background timer.

This is the one place in the claim flow that a human starts. The route builds a
"voucher" — a payout transaction that our backend pre-signs with the admin key, ready
for the user to co-sign.

What it does:

- Looks up how much this wallet can claim, **entirely from our own database** (the sum
  of their `CLAIMED_ON_BASE`, non-free-ticket winnings). It never trusts an amount
  sent by the frontend.
- If a live voucher already exists for this wallet, it hands back that same one
  (never makes a second — this is what prevents double-payment).
- Otherwise it creates a **PayoutClaim** row (status **`PENDING`**), binds the winning
  tickets to it, and asks `src/services/solanaService.ts` to build the voucher.
- `solanaService.buildClaimVoucher()` builds the `claim_winnings` transaction with the
  exact amount, and **pre-signs it with the admin key** (the admin is also the fee
  payer). Because of this, we already know the transaction's final signature before
  the user ever sees it — that's the trick that lets Step 11 check the chain directly.
- Sends the half-signed transaction back to the frontend.

**Status change:** a new PayoutClaim row is created → **`PENDING`**. The bound tickets
are still `CLAIMED_ON_BASE` (they only advance once the payout actually lands).

---

## Step 10 — The user signs and submits

**File:** the frontend + the user's wallet + the Solana smart contract
(`claim_winnings` in `lib.rs`). Not our backend.

The user's wallet adds their own signature to the voucher and submits it to Solana.
The contract checks both signatures are present (admin + user), checks the protocol
isn't paused, checks the vault has enough USDC, and then transfers the winnings from
our vault's token account straight to the user's own USDC account.

**Status:** nothing changes in our database *yet* — the transaction just landed on
Solana. Our backend finds out in the next step.

---

## Step 11 — We confirm the payout landed

**File:** `src/workers/payoutConfirmer.ts` (worker #4; wakes up every 10 seconds).

This worker watches all the `PENDING` vouchers. Because we already know each voucher's
signature (from Step 9), it can look them up directly on the Solana chain — it never
has to trust the frontend to report back.

What it does on the happy path:

- Looks up the voucher's signature on Solana.
- Sees it landed with no error.
- Marks the PayoutClaim **`CONFIRMED`**.
- Moves the bound tickets to their final resting state.

**Status change:**
- PayoutClaim goes `PENDING` → **`CONFIRMED`**.
- Each bound Ticket goes `CLAIMED_ON_BASE` → **`PAID_OUT_ON_SOLANA`** — the end of the
  road. The user has their money.

---

### End of the claim flow

The full life of a winning ticket, start to finish:

```
DRAW_PENDING          (bought, waiting for the draw)         [ticketWorker]
   → WON_UNCLAIMED    (draw happened, it won cash)           [settlementWorker]
   → CLAIMED_ON_BASE  (we pulled the money into our vault)   [harvestWorker]
   → PAID_OUT_ON_SOLANA (user pulled it to their wallet)     [payoutConfirmer]
```

And a losing ticket simply stops at `LOST` right after Step 7.

---

## One-glance status cheat sheet

### RelayOrder.status (the buy journey)

| Status | Set by (file) | Meaning |
|---|---|---|
| `QUEUED` | `ticketWorker.ts` | purchase decoded and saved, ready to send to Base |
| `PROCESSING` | `baseRelayWorker.ts` | a worker grabbed it to send |
| `BASE_SUBMITTED` | `baseRelayWorker.ts` | buy sent to Base, waiting for the result |
| `SUCCESS` | `baseConfirmer.ts` | buy confirmed; `fulfillEpoch` + NFT IDs stamped here |

### WebhookInbox.status (the doorbell)

| Status | Set by (file) | Meaning |
|---|---|---|
| `RECEIVED` | `webhook.ts` | Helius told us about a signature |
| `PROCESSED` | `webhookIngestWorker.ts` | verified on-chain, passed downstream |
| `SKIPPED` | `webhookIngestWorker.ts` | not a real ticket buy, ignored |

### Ticket.winStatus (the win-and-payout journey)

| Status | Set by (file) | Meaning |
|---|---|---|
| `DRAW_PENDING` | `ticketWorker.ts` | created, waiting for the draw |
| `LOST` | `settlementWorker.ts` | draw happened, no prize |
| `WON_UNCLAIMED` | `settlementWorker.ts` | won cash (net amount saved) |
| `WON_FREE_TICKET` | `settlementWorker.ts` | won a free-ticket tier |
| `CLAIMED_ON_BASE` | `harvestWorker.ts` | winnings collected into our vault |
| `PAID_OUT_ON_SOLANA` | `payoutConfirmer.ts` | user pulled it to their wallet — done |

### HarvestBatch.status (collecting winnings)

| Status | Set by (file) | Meaning |
|---|---|---|
| `SUBMITTED` | `harvestWorker.ts` | collect transaction created/sent |
| `CONFIRMED` | `harvestWorker.ts` | collect succeeded on Base |

### PayoutClaim.status (the user's claim)

| Status | Set by (file) | Meaning |
|---|---|---|
| `PENDING` | `claims.ts` (route) | voucher issued, waiting for the user to submit it |
| `CONFIRMED` | `payoutConfirmer.ts` | payout landed on Solana |

> Note: `harvestWorker`, `payoutConfirmer`, and the `claims` route describe behavior
> that only runs live once the updated Base vault and Solana program are built and
> deployed. The buy flow (Steps 1–6) is fully live today.
