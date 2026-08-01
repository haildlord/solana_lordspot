# How a claim works, from a draw finishing to money in your wallet

This explains, in plain English, everything that happens between "the lottery
draw just happened" and "the money is in the winner's Solana wallet." No prior
context needed — if a word is unusual, it's explained the first time it shows
up.

## The five people/things involved

1. **Megapot** — the actual lottery. It's not ours; we just plug into it. It
  runs the draw and holds the prize money until someone claims it.
2. **The Base vault** — a smart contract we own on the Base blockchain. Think
  of it as our own cash register. Its job is to pull winnings out of
   Megapot and hold them until a user is ready to withdraw to Solana.
3. **The backend** — our server. It watches everything and moves things along
  automatically. It never has the power to move money on its own — every
   money-moving step still needs either the blockchain's own rules or the
   user's own signature.
4. **The user's wallet** — Phantom or whatever wallet they bought tickets
  with. Only they can sign for money to land in their own wallet.
5. **Our Solana program** — a smart contract on Solana that actually holds
  the USDC and pays it out to the winner.



## The whole journey in one paragraph

A draw happens → we figure out who won and how much → we pull those winnings
out of Megapot into our own vault → the backend prepares a ready-to-sign
"claim voucher" for the winner → the winner signs it in their wallet → the
money moves from our vault to their wallet → we watch the blockchain until
that's confirmed. Every step is done by an automatic background job that
runs on a timer — nobody has to press a button behind the scenes, and nothing
happens without the blockchain itself confirming it really happened.

Now, step by step.

---

## Step 1 — The draw finishes (an "epoch" settles)

Megapot calls one round of the lottery an **epoch**. When an epoch's draw
happens, Megapot picks the winning numbers.

Our backend is watching for this (`megapotService.ts`). As soon as it sees
Megapot has moved to a new epoch, it:

- Pauses new ticket purchases for a moment (so nobody buys a ticket for a
draw that already happened).
- Saves the finished epoch's result into our own database — the winning
numbers, the date it was drawn, etc. This creates one row per finished
epoch, and the exact moment this row is saved is timestamped as
`drawnAt`.
- Resumes ticket sales for the new, current epoch.

At this exact point, we know **what** the winning numbers were, but we don't
yet know **who** on our platform won, or how much.

## Step 2 — Grading: figuring out who won ("settlement")

A background job called the **settlement worker** runs once every 60
seconds. Every time it wakes up, it looks for any epoch that:

- has a saved result (from Step 1), **and**
- still has tickets in the "waiting to find out" state (called
`DRAW_PENDING`)

For every one of those tickets, it compares the ticket's numbers to the
winning numbers and decides the outcome:


| Outcome           | Meaning                                     |
| ----------------- | ------------------------------------------- |
| `LOST`            | Didn't win anything                         |
| `WON_UNCLAIMED`   | Won real money, not yet paid out            |
| `WON_FREE_TICKET` | Won a free replay ticket (not cash) instead |


This math exactly copies the real rule Megapot's own smart contract uses, so
our numbers always agree with theirs.

Once **every** ticket for an epoch has been graded (none left waiting), we
stamp that epoch as fully settled (`ticketsSettledAt`). That stamp is the
signal the *next* job is watching for.

**Nothing about this step needs a person.** It just runs on a timer,
forever, checking for new work.

## Step 3 — Harvest: pulling the winnings out of Megapot

A second background job, the **harvest worker**, also runs on a timer (every
60 seconds). It looks for any epoch that is fully settled (Step 2 finished)
but hasn't had its winnings collected yet.

When it finds one, here's what it does:

1. Gathers all of that epoch's winning tickets (both cash winners and free-
  ticket winners) that haven't been collected yet.
2. Groups them into a batch of up to 50 tickets at a time (batching many
  tickets into one transaction is much cheaper than doing them one by one).
3. Before spending any real money on gas, it does a **free rehearsal** —
  asking the blockchain "would this succeed?" without actually sending it.
   If one ticket in the batch is somehow broken, it narrows down which one
   (by repeatedly splitting the batch in half) and sets that ticket aside for
   a human to look at later, without blocking the rest of the batch.
4. Sends one real transaction that calls Megapot's contract to pay out that
  whole batch of tickets straight into **our own Base vault** — not to the
   winner directly yet.
5. Once that transaction is confirmed on the blockchain, every ticket in the
  batch flips from "won, not collected" to `CLAIMED_ON_BASE` — meaning
   the money now physically sits in our vault, waiting for the winner to
   withdraw it.
6. Once an epoch has no winning tickets left to collect, that epoch gets a
  second stamp (`ticketsHarvestedAt`) meaning "fully drained, nothing left
   to do here."

This whole step is also fully automatic and durable — if the server crashes
mid-batch, it doesn't lose track. Every batch is written to the database
*before* the transaction is sent, so on restart the server can always figure
out exactly what was in flight and pick up where it left off.

**This is the step that actually answers "when does the claim period
start?"** — see the dedicated section near the end of this document.

## Step 4 — The user sees they can claim

Once Step 3 finishes for a ticket, that ticket's money is sitting in our
vault. The **Winnings** page in the app now shows it as a real, spendable
amount — this number is a live sum, computed fresh every time the page loads
(sum of every `CLAIMED_ON_BASE` ticket that hasn't been claimed yet, for that
wallet).

The user clicks **Claim**.

## Step 5 — Issuing a "claim voucher"

Clicking Claim calls our backend (`POST /v1/claims/voucher`). This is the
most carefully-guarded part of the whole system, because it's the one place
that says "yes, pay this wallet this amount." Here's exactly what happens,
in order:

1. **One-at-a-time check.** If this wallet already has an unfinished
  ("pending") claim in progress, the backend doesn't create a new one — it
   just hands back the *same* one again. This is what makes it impossible to
   accidentally double-pay someone: there can only ever be one live claim per
   wallet at a time.
2. **Lock in the exact amount.** The backend looks at every one of that
  wallet's `CLAIMED_ON_BASE` tickets that isn't already tied to a claim, and
   ties all of them to this new claim right now (in a way that's safe even if
   two claim requests came in at the exact same moment). It adds up their
   winnings — that sum, and only that sum, is what gets paid. Nothing the
   user sends in the request itself is trusted for the amount.
3. **Build a half-signed transaction.** The backend builds a real Solana
  transaction that calls our program's `claim_winnings` instruction, and
   signs it *itself* as the "admin." This admin signature is what proves the
   amount is legitimate — a user could never make up their own voucher,
   because they don't have the admin's private key.
4. This half-signed transaction is sent back to the frontend, along with an
  expiry (`lastValidBlockHeight` — a block number after which this exact
   transaction becomes permanently unusable, usually about 60–90 seconds
   away).

Note: because our backend pays the network fee on this transaction (it's the
"fee payer"), claiming doesn't cost the winner any gas.

## Step 6 — The user signs and submits

The frontend asks the user's wallet (Phantom, etc.) to add *their* signature
on top of the admin's signature, then broadcasts the now fully-signed
transaction to Solana.

On-chain, our Solana program checks, before moving a single unit of money:

- **Both** signatures are present — the user's (proving they're really the
owner of that wallet and consent to this) **and** the admin's (proving the
amount was actually approved by us). Neither one alone can move any money.
- The protocol isn't currently paused.
- The vault actually has enough USDC to pay.

If all of that checks out, the USDC moves straight from our vault into the
user's own wallet (creating their USDC account for them automatically if
they don't have one yet). There is no way to redirect it to someone else's
wallet — the destination is always the signer's own address.

## Step 7 — Confirming it actually happened

A third background job, the **payout confirmer**, runs every 10 seconds. It
doesn't wait for the frontend to tell it "it worked" — it never trusts that.
Instead, because the admin was the fee payer, the transaction's exact
signature was already known back in Step 5, before the user even signed it.
So this job just asks the Solana blockchain directly: "did this exact
transaction land, and did it succeed?"

Three possible outcomes:


| What happened on-chain                                            | What we do                                                                                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landed successfully                                               | Claim marked `CONFIRMED`. Every ticket tied to it flips to `PAID_OUT_ON_SOLANA` — fully done.                                                        |
| Landed but failed (e.g. protocol was paused right at that moment) | Claim marked `FAILED`. The tickets are untied from this claim, so they immediately become claimable again — the user can just click Claim once more. |
| Never landed, and its expiry window has now passed                | Claim marked `EXPIRED`. Same as above — tickets are freed up so a fresh voucher can be issued.                                                       |


Nothing is ever lost — if a claim doesn't go through for any reason, the
underlying winnings simply go back to being "claimable" so the user can try
again.

---



## So... when does "the claim period" actually start?

There isn't a scheduled clock or countdown for this — no "claims open at
9am." It's entirely **event-driven**, meaning each step wakes up the next
step automatically, as soon as the previous one finishes:

```
Megapot's draw happens
        │
        ▼
Epoch result saved to our database         (happens immediately, as part of epoch rollover)
        │
        ▼
Settlement worker grades every ticket      (checks every 60 seconds)
        │  ↳ epoch stamped "settled" the moment every ticket is graded
        ▼
Harvest worker pulls winnings into our vault  (checks every 60 seconds)
        │  ↳ ticket becomes CLAIMED_ON_BASE the moment its batch confirms on-chain
        ▼
 ✅ Claimable — the user can now press "Claim" and it will work
```

So the real answer is: **a ticket becomes claimable the moment its winnings
finish being pulled into our vault (end of Step 3 above) — which, in normal
conditions, is usually within a couple of minutes of the draw finishing**,
since both the settlement worker and the harvest worker check for new work
every 60 seconds. There's no artificial waiting period on top of that.

The only thing that can *block* a claim from working, even after the money
is sitting in the vault, is if the protocol happens to be paused right at
that moment (this happens briefly, automatically, once a day during the next
epoch's rollover — see `megapotService.ts`). If that's the case, the backend
gives a friendly "try again shortly" message instead of a failed transaction,
and the on-chain program independently double-checks the same thing anyway,
so it's never possible to get an inconsistent result.

---



## Quick reference: what each status means

**A ticket's** `winStatus` (its life story, in order):

`DRAW_PENDING` → (draw happens) → `LOST` **or** `WON_UNCLAIMED` / `WON_FREE_TICKET` → (harvested) → `CLAIMED_ON_BASE` → (claimed) → `PAID_OUT_ON_SOLANA`

**A harvest batch's status** (one batch = one "pull winnings into our vault"
transaction): `SUBMITTED` → `CONFIRMED`, or `FAILED` if it didn't land (its
tickets go back to being un-harvested so the next pass tries again).

**A claim voucher's status** (one voucher = one "pay the winner" transaction):
`PENDING` → `CONFIRMED`, or `EXPIRED` / `FAILED` if it didn't land (its
tickets go back to being claimable so the user can request a fresh one).

## Where this lives in the code, if you want to read further


| Step                                     | File                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| Epoch finishes / saved                   | `backend/src/services/megapotService.ts`                                               |
| Grading tickets (Step 2)                 | `backend/src/workers/settlementWorker.ts`                                              |
| Pulling winnings into our vault (Step 3) | `backend/src/workers/harvestWorker.ts`                                                 |
| Issuing a claim voucher (Step 5)         | `backend/src/routes/claims.ts`                                                         |
| Building the actual Solana transaction   | `backend/src/services/solanaService.ts` (`buildClaimVoucher`)                          |
| User signing + sending it                | `frontend/src/solana/claimVoucher.ts`                                                  |
| Confirming the claim landed (Step 7)     | `backend/src/workers/payoutConfirmer.ts`                                               |
| The on-chain rules for paying out        | `solana_smart_contracts/programs/solana_smart_contracts/src/lib.rs` (`claim_winnings`) |


