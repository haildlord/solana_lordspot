# Background Worker Flows — Plain-English Reference

This document explains, in simple English, the four background workers started in
`src/workers/index.ts`:

```ts
startBaseConfirmer();
startSettlementWorker();
startHarvestWorker();
startPayoutConfirmer();
```

Read it top-to-bottom to understand the entire life of a ticket — from a user's
purchase all the way to them getting paid their winnings.

One thing to hold in your head the whole time: **all four of these are loops that
wake up on a timer, look at the database, and do a little work.** None of them are
triggered by a user clicking something. They just keep checking, over and over,
forever. That is why the system heals itself — if something is left half-done, the
next tick picks it up.

---

## 1. `startBaseConfirmer()` — "Did the ticket-buy on Base actually go through?"

**Wakes up every 5 seconds.** File: `src/workers/baseConfirmer.ts`

Think of this as the worker that watches over money we *sent* to Base but haven't
heard back about yet.

Earlier in the pipeline, a different worker (the relay worker) took a user's Solana
purchase and fired off a matching buy to the Base vault, then immediately walked
away without waiting. It left the order sitting in the database marked
**`BASE_SUBMITTED`** ("we sent it, we don't know the result yet"). This confirmer's
whole job is to find those orders and figure out what happened to them.

**Each tick, it does this:**

It asks the database for up to 50 orders that are stuck at `BASE_SUBMITTED`, oldest
first. For each one, it looks up the transaction on the Base blockchain using the
transaction hash we saved. Then one of these situations is true:

- **The transaction has no hash saved at all.** This means we crashed at the worst
  possible moment — right after sending but before writing the hash down. If the
  order is less than 2 minutes old, we leave it alone (maybe the write is still
  coming). If it's older than 2 minutes, we assume the worst and send it back to be
  retried safely.

- **The blockchain has no receipt yet.** The transaction is still being processed.
  If it's less than 2 minutes old, that's totally normal — we just wait for the
  next tick. If it's older, we check: is the transaction still floating in the
  network waiting to be picked up? If yes, we leave it (it's just slow). If it has
  completely vanished from the network, we reset our transaction counter and send
  the order back to be retried as a brand-new transaction.

- **The receipt says SUCCESS.** This is the happy ending. We read the Megapot ticket
  IDs out of the receipt (these are the real on-chain ticket numbers), and we mark
  the order **`SUCCESS`**. Two very important things happen in this same step: we
  save each ticket's real Megapot NFT ID onto the ticket row, and **we stamp the
  order with `fulfillEpoch`** — the epoch number the ticket actually landed in. That
  `fulfillEpoch` stamp is the hinge that everything later depends on. Settlement and
  harvest both find tickets by looking at `fulfillEpoch`, so if this step didn't
  run, the ticket could never be graded or paid.

- **The receipt says it FAILED (reverted).** Now we have to find out *why* it failed,
  so we re-run the transaction as a pretend simulation to read the error. Based on
  the error:
  - "This order was already done before" → we go hunting for the original successful
    transaction; if we find it we mark the order `SUCCESS` using that, otherwise we
    retry.
  - "This is a permanent problem" (like bad ticket data that will never work) → we
    mark it **`FAILED_PERMANENT`** and stop trying.
  - "This is a temporary problem" (network hiccup, vault paused) → we send it back to
    retry later.

So this worker moves orders from `BASE_SUBMITTED` to either **`SUCCESS`**,
**`RETRY_PENDING`** (try again), or **`FAILED_PERMANENT`** (give up). It is the last
stop in the *buying* half of the whole system.

---

## 2. `startSettlementWorker()` — "The draw happened. Did each ticket win or lose?"

**Wakes up every 60 seconds. Also runs from the cron process — both running at once
is safe.** File: `src/workers/settlementWorker.ts`

Once a ticket has been successfully bought (its order is `SUCCESS`), the ticket sits
in the database marked **`DRAW_PENDING`** — meaning "we're waiting for the lottery
draw for this ticket's epoch to happen." This worker's job is to take those waiting
tickets, once the draw is done, and decide: did this ticket win, and if so, how much?

**Each tick, it does three things in order:**

**First, it heals gaps.** It runs a query that asks: "Are there any tickets still
waiting (`DRAW_PENDING`) whose epoch we don't even have draw-results for in our
database?" This is the safety net for when the server was switched off for a long
time and missed some draws. For any such missing epoch (as long as it's not the
currently-running one), it goes and fetches that epoch's results from Megapot's API
on demand.

**Second, it grades.** It asks the database for every epoch that has draw-results
saved but hasn't been fully graded yet (these are marked by an empty
`ticketsSettledAt` field — empty means "still owes grading work"). For each such
epoch, it grades all the tickets:

- It reads the winning numbers and the prize table for that epoch. It's very strict
  here — if the prize table looks even slightly malformed, it refuses to grade and
  leaves the epoch for next time, rather than risk marking a winner as a loser.
- It pulls the tickets in batches of 500 (tickets that are still `DRAW_PENDING`,
  belong to a `SUCCESS` order, and whose `fulfillEpoch` matches this epoch).
- For each ticket, it counts how many numbers matched and looks up the payout for
  that match-tier. If the payout is zero, the ticket becomes **`LOST`**. If the
  payout is more than zero, the ticket becomes a winner — and here it saves the
  **net** amount (the prize minus Megapot's 10% referral cut, calculated the exact
  same way the Megapot contract does it, down to the last unit).
- There are two special tiers (tier 1 and tier 4) that Megapot pays as a free ticket
  rather than real cash. Those tickets are marked **`WON_FREE_TICKET`** instead of
  `WON_UNCLAIMED`, and we permanently stamp `isFreeTicketTier = true` on them so we
  never lose track of that fact later.
- After every ticket in the epoch has left `DRAW_PENDING`, it stamps the epoch's
  `ticketsSettledAt` — the "this epoch is fully graded" watermark.

**Third, it warns.** It checks for any weird leftover cases — like a `SUCCESS` order
that somehow has no `fulfillEpoch` — and shouts about them in the logs so a human
can look.

So this worker moves tickets from `DRAW_PENDING` to either **`LOST`**,
**`WON_UNCLAIMED`**, or **`WON_FREE_TICKET`**. It never touches money — it only
decides who won and writes down how much.

---

## 3. `startHarvestWorker()` — "Pull the winning money out of Megapot into our Base vault."

**Wakes up every 60 seconds. Runs in ONLY ONE place (the worker process, never
cron), protected by a Redis lock — because it moves real money.** File:
`src/workers/harvestWorker.ts`

Now some tickets are marked `WON_UNCLAIMED` or `WON_FREE_TICKET`. But that winning
money is still sitting inside Megapot, and the tickets are owned by our Base vault
(not by the users). So someone has to actually go and collect that money. That's
this worker. It collects winnings in batches to save on fees.

**Each tick, it does this:**

It grabs the Redis lock first. If it can't get the lock (because another copy is
already running), it quietly stops — this guarantees only one harvester ever runs at
a time. Then it asks the database for every epoch that is fully graded
(`ticketsSettledAt` is set) but not yet fully harvested (`ticketsHarvestedAt` is
empty). For each such epoch, it runs a harvest step:

**The harvest step first checks: is there already a batch in flight for this epoch?**
A "batch" is one collection transaction we've already sent. If one exists and is
still marked `SUBMITTED`, we go resolve it before starting anything new:

- If the batch has no transaction hash (we crashed right before sending), and it's
  old enough, we carefully re-test it. If the test passes, the old send never
  landed, so we safely re-send. If the test fails, that means the money was already
  claimed — so the lost transaction actually *did* land — and we finalize it while
  shouting an alert to double-check on Basescan.
- If the batch has a hash, we look up its receipt. No receipt and young → still
  mining, wait. No receipt and vanished → release it (unbind the tickets so they can
  be tried again). Receipt says SUCCESS → finalize it. Receipt says FAILED → release
  it.

**If no batch is in flight, it builds a new one:**

- It collects up to 50 winning tickets from this epoch that haven't been harvested
  yet and have a real Megapot NFT ID.
- Megapot's collect function is all-or-nothing: if even one ticket ID in the batch
  is bad, the whole thing fails. So before spending any money, it does a free
  "rehearsal" (a gas estimate). If the rehearsal fails, it splits the group in half
  and half again (this is the "bisect") to pinpoint exactly which ticket IDs are
  broken, then quarantines those bad ones in Redis so they don't poison future
  batches.
- With the good tickets, it creates a `HarvestBatch` row marked **`SUBMITTED`** and
  binds those tickets to it — **and it does this in the database BEFORE sending the
  transaction.** That ordering is deliberate: if we crash right after, the database
  already remembers exactly what was in flight, so recovery is always possible.
- Then it sends the collect transaction to Base and saves the transaction hash.

When a batch's receipt finally comes back successful, `finalizeBatchSuccess` runs: it
moves all those tickets from `WON_*` to **`CLAIMED_ON_BASE`** (meaning "the money is
now sitting safely in our Base vault"), marks the batch **`CONFIRMED`**, and
cross-checks the amount the chain actually paid against what our database expected —
if they disagree, it shouts an alert, because that would mean our 10%-cut math is
wrong.

When an epoch has no more tickets left to harvest, it stamps `ticketsHarvestedAt`
(the "this epoch is fully collected" watermark) — unless some winning tickets are
missing their NFT ID, in which case it holds off and alerts a human instead.

So this worker moves tickets from `WON_UNCLAIMED` / `WON_FREE_TICKET` to
**`CLAIMED_ON_BASE`**, and moves harvest batches through `SUBMITTED` → `CONFIRMED`
(or `FAILED`).

---

## 4. `startPayoutConfirmer()` — "Did the user actually collect their money on Solana?"

**Wakes up every 10 seconds.** File: `src/workers/payoutConfirmer.ts`

Now the winning money is sitting in our vault, and tickets are marked
`CLAIMED_ON_BASE`. The last step is paying the user on Solana. But that step is
started by the *user* clicking claim on the frontend — which triggers the **claims
API** (`src/routes/claims.ts`, not this worker) to create a payment voucher. This
worker's job is just to watch those vouchers and see how they end up.

Here's the important background: when the claims API makes a voucher, it creates a
`PayoutClaim` row marked **`PENDING`**, binds the user's winning tickets to it, and
pre-signs the transaction with our admin key. Because our admin key pays the
transaction fee, **we already know the transaction's signature the moment we create
it** — before the user even signs. That's the trick that lets this worker check the
blockchain directly instead of trusting the frontend to report back.

**Each tick, it does this:**

It asks the database for all vouchers still marked `PENDING`. It looks up all their
signatures on the Solana blockchain in one go, and also checks the current block
height (to know how "old" things are). Then for each pending voucher:

- **No signature saved and it's older than 2 minutes** → the voucher-making process
  must have crashed before it finished; nothing was ever handed to a user, so mark
  it **`EXPIRED`** and unbind the tickets (they become claimable again).
- **The blockchain shows it landed with no error** → success! This is `confirmClaim`:
  it moves the bound tickets from `CLAIMED_ON_BASE` to **`PAID_OUT_ON_SOLANA`** (the
  final state — the user has their money), and marks the voucher **`CONFIRMED`**.
- **The blockchain shows it landed but errored** → the money did *not* move (maybe
  the protocol was paused, or the vault was short). Mark the voucher **`FAILED`** and
  unbind the tickets so a fresh voucher can be made later.
- **The blockchain doesn't show it at all, AND enough blocks have passed that it can
  never possibly land now** → mark it **`EXPIRED`** and unbind the tickets. (Solana
  permanently rejects transactions whose blockhash has expired, so once past that
  point it's provably dead — safe to release.)
- **The blockchain doesn't show it, but it's still within its valid window** → do
  nothing, wait. The user might still be about to submit it.

This worker is the second half of the "one live voucher per user" safety rule: the
claims API refuses to make a new voucher while one is still `PENDING`, and this
worker is the only thing that moves a voucher out of `PENDING`. Together they make it
impossible to accidentally pay a user twice.

So this worker moves tickets from `CLAIMED_ON_BASE` to **`PAID_OUT_ON_SOLANA`** (the
end of the road), and moves vouchers from `PENDING` to `CONFIRMED`, `EXPIRED`, or
`FAILED`.

---

## The full "who changes what status, and when" map

This ties it all together, including the pieces *outside* these four workers.

### Order status (`RelayOrder.status`) — the buying journey

| Status | Set to this by | When |
|---|---|---|
| `SOLANA_CONFIRMED` / `QUEUED` | the ticket worker | when a purchase is first decoded from Solana and saved |
| `PROCESSING` | the relay worker | when it grabs the order to send to Base |
| `DEFERRED` | the relay worker | when the protocol is paused or the epoch is locked — wait for later |
| `BASE_SUBMITTED` | the relay worker | right after it sends the buy to Base and walks away |
| `SUCCESS` | **the base confirmer (worker #1)** | when the Base receipt confirms — *this is also where `fulfillEpoch` and the Megapot NFT IDs get stamped* |
| `RETRY_PENDING` | relay worker or base confirmer | on a temporary failure |
| `FAILED_PERMANENT` | relay worker or base confirmer | on a permanent, hopeless failure |

### Win status (`Ticket.winStatus`) — the winning-and-getting-paid journey

| Status | Set to this by | When |
|---|---|---|
| `DRAW_PENDING` | the ticket worker | the moment a ticket is created (its starting state) |
| `LOST` | **settlement (worker #2)** | draw happened, this ticket's tier pays zero |
| `WON_UNCLAIMED` | **settlement (worker #2)** | draw happened, this ticket won cash |
| `WON_FREE_TICKET` | **settlement (worker #2)** | draw happened, this ticket won a free-ticket tier (1 or 4) |
| `CLAIMED_ON_BASE` | **harvest (worker #3)** | we collected the winnings from Megapot into our Base vault |
| `PAID_OUT_ON_SOLANA` | **payout confirmer (worker #4)** | the user's claim landed on Solana — done, they have their money |

### Harvest batch status (`HarvestBatch.status`) — all set by harvest (worker #3)

| Status | When |
|---|---|
| `SUBMITTED` | a batch row is created, just before/after sending the collect transaction |
| `CONFIRMED` | the collect transaction succeeded on Base |
| `FAILED` | the transaction reverted or vanished; its tickets are unbound and will be retried |

### Payout voucher status (`PayoutClaim.status`)

| Status | Set to this by | When |
|---|---|---|
| `PENDING` | **the claims API route** (not a worker) | when a user clicks claim and a voucher is created |
| `CONFIRMED` | **payout confirmer (worker #4)** | the user's claim transaction landed successfully |
| `EXPIRED` | **payout confirmer (worker #4)** | the voucher was never used and its time window passed |
| `FAILED` | **payout confirmer (worker #4)** | the claim transaction landed but errored (no money moved) |

### The two watermark fields

One more connection worth remembering: the two "watermark" fields on an epoch —
`ticketsSettledAt` (set by settlement) and `ticketsHarvestedAt` (set by harvest) —
are how each worker knows what's left to do. Empty means "still owes work." That's
the quiet mechanism that lets the whole thing survive the server being switched off
for a day and just catch up when it comes back.
