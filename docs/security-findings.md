# Security findings — backend + SDK adversarial review

**Date:** 2026-08-27 · **Scope:** `backend/`, `sdk/` · **Branch:** `sdk_v1`

Adversarial review looking specifically for ways an attacker could make the
system act on something that never happened, or drain funds through timing.

Findings are ordered by severity. Each states the exploit chain concretely —
"what an attacker actually does", not "this looks risky".

---

## 🔴 CRITICAL — Forged webhooks mint free tickets unless `NODE_ENV` is exactly `production`

> **STATUS: FIXED** (2026-08-27). The fallback branch described below was removed
> from `webhookIngestWorker.ts`. A transaction that is not found on-chain now
> always throws and retries, in every environment — there is no payload-trusting
> path left. The exploit chain is kept on record below so the reasoning survives,
> and so nobody re-introduces the branch as a convenience.
>
> **Not yet done:** the defence-in-depth item at the end of this section —
> `ticketWorker` still trusts `amount_paid` from the decoded event without
> verifying the USDC transfer. That is no longer reachable by a forged webhook,
> but it remains the reason a forged event would be *harmful* rather than inert.

**Where:** `backend/src/workers/webhookIngestWorker.ts` (the `config.nodeEnv !== 'production'`
branch), reachable via `POST /webhooks/helius`.

### The chain

1. Attacker obtains the Helius webhook secret (leaked env var, compromised
   Helius dashboard, a log, a screenshot, an old `.env` in git).
2. They `POST /webhooks/helius` with a **signature that does not exist on
   chain**, and a `rawPayload` containing fabricated
   `meta.logMessages` — including a base64 `TicketPurchaseEvent`. The IDL is
   public, so forging a valid-looking event is straightforward.
3. `webhookIngestWorker` re-fetches the signature from RPC. It isn't there,
   because it never happened.
4. **If `nodeEnv !== 'production'`, the worker falls back to trusting the
   attacker's payload logs.**
5. `ticketWorker` decodes the forged event and takes `amount_paid` **directly
   from it — there is no check that USDC ever moved.** It writes a `RelayOrder`
   + `Ticket` rows with the attacker's wallet as `buyer`.
6. `baseRelayWorker` then spends **real Base vault USDC** buying real Megapot
   tickets to fulfil an order nobody paid for.
7. Those tickets settle normally. Any winnings become claimable by the
   attacker's wallet through the ordinary claim flow.

**Impact:** drains the Base vault at the ticket price, and creates genuinely
claimable winnings from tickets that were never purchased. The on-chain
`max_claim_amount` bounds a single claim; it does not bound this.

### Why the guard is fragile

`config.nodeEnv` is `process.env.NODE_ENV ?? 'development'`, and the check is an
exact string comparison. Every one of these leaves the path **open**:

| `NODE_ENV` | Fallback active? |
|---|---|
| *(unset)* | **YES** |
| `""` | **YES** |
| `Production` / `PRODUCTION` | **YES** |
| `prod` | **YES** |
| `staging` | **YES** |
| `production` | no |

A capitalisation typo in a deploy config silently re-opens a fund-draining path,
with no error and no log to notice it by.

### Fix — applied

**Option 1 was taken: the fallback was deleted outright.** The `else` branch now
throws unconditionally, so a signature that is not visible on chain is retried
rather than believed.

Why deleting it was safe for legitimate traffic, verified before the change:

- The only legitimate way to reach that branch is **RPC lag** behind the webhook.
  BullMQ retries the job 6 times with exponential backoff from 3s (~3 minutes
  total, `lib/queues.ts`), which covers ordinary lag.
- If those retries are exhausted, the purchase is **still not lost**. The cron
  backup indexer (`solanaIndexer.pollMissedTransactions`, every 30s) walks the
  vault USDC ATA's real signature history, fetches logs from chain, and enqueues
  straight to `ticketIngestQueue`.
- That indexer only ever sees transactions that actually touched the vault ATA —
  which is precisely the property a forged webhook cannot fake. The safety net
  is structurally incapable of reproducing the hole that was closed.

Not adopted, and why:

- A separate explicitly-unsafe flag (e.g. `LORDSPOT_TRUST_WEBHOOK_PAYLOAD=...`)
  was considered and rejected. It is safer than `NODE_ENV`, but it still leaves a
  fund-draining branch in the codebase for a convenience the backup indexer
  already provides.
- **Still worth doing:** fail startup if `NODE_ENV` is not one of a known set. A
  server that boots happily on `NODE_ENV=Production` lies to you about which mode
  it is in, and `solanaService` still derives `isMainnet` from it.

Also worth doing regardless: `ticketWorker` trusts `amount_paid` from the event
without confirming the USDC transfer. Even with the fallback removed, verifying
the transfer amount against the transaction's token balances would make forged
events inert rather than merely unreachable.

---

## 🟡 MEDIUM — Megapot's API is an unbounded trust input for payout amounts

**Where:** `backend/src/services/megapotService.ts` → `settlementWorker.ts`.

Winning numbers and `prizeTiers` come from Megapot's HTTP API and decide who won
and how much. If that API returns wrong data — compromise, a bug on their side,
DNS/MITM against a plain `fetch` — settlement writes those amounts to
`Ticket.winAmount`, and the backend will co-sign vouchers for them.

**What already limits it (good):**
- `parsePrizeTiers` rejects a malformed payload and **aborts that epoch loudly**
  rather than grading against garbage.
- The on-chain `max_claim_amount` caps any single claim, and
  `routes/claims.ts` refuses to sign above it with an `[ALERT]` log.

**What is still unbounded:** the ceiling is *per claim*, not per epoch or
per protocol. Inflated tier data affecting many wallets means many claims, each
individually under the cap. Nothing detects "this epoch paid out 50x its prize
pool".

**Suggested:** an epoch-level sanity check at settlement — total graded payout
for an epoch should not exceed that epoch's known prize pool by more than a
small margin. Abort and alert if it does.

---

## 🟢 VERIFIED SOUND — attacks that were tried and do not work

Recorded so they aren't re-investigated from scratch:

- **Webhook auth** (`routes/webhook.ts`) fails **closed** — returns 500 if
  `HELIUS_WEBHOOK_SECRET` is missing, uses `crypto.timingSafeEqual`, and
  length-checks first so it cannot throw. The doc comment above it saying
  verification "is skipped with a warning" is **stale**; the code rejects.
- **Replaying a signed claim transaction** is impossible on Solana: the runtime
  rejects a duplicate signature, and the blockhash expires in ~60-90s. Either
  too soon (duplicate) or too late (expired).
- **Modifying a voucher's amount** invalidates the admin signature.
- **Double-issuing vouchers** is blocked by the one-live-voucher rule plus
  ticket binding under a `payoutClaimId: null` guard, which is concurrency-safe.
- **Voucher expiry self-heals** — verified live: tickets bind on issuance and
  are released ~90s later by the payout confirmer, restoring claimability.
- **SDK voucher verification** rejects 13 distinct malicious voucher shapes and
  accepts a genuine admin-signed one (verified against the real backend).

---

## ⚠️ Trust boundary the SDK does NOT cover — state it plainly to partners

The SDK's voucher verification protects a partner against **a compromised
LordsPot API returning a malicious transaction shape** — a smuggled transfer, a
redirected payout, an inflated amount that disagrees with the summary.

It does **not** protect against **the LordsPot admin key itself being
compromised**. An attacker holding that key can mint correctly-shaped,
correctly-signed vouchers that pass every SDK check, bounded only by the
on-chain `max_claim_amount`.

That is not a gap in the SDK — it is the definition of the admin key's
authority. It is the reason the admin key is the single most important secret in
this system, and the reason `withdraw_vault_funds` was moved off it onto a
separate cold treasury key. Partners should understand that using the SDK means
trusting LordsPot's key custody, not merely LordsPot's server.

---

## Deployment requirements this review produced

Add to any production deploy checklist:

- [ ] `NODE_ENV=production` — **exactly that string, lowercase.** Verify it on
      the running host, not just in a config file. This no longer gates a drain
      path (the fallback is gone), but `solanaService` still derives `isMainnet`
      from it.
- [ ] `HELIUS_WEBHOOK_SECRET` set, and rotated if it has ever appeared in a log,
      screenshot, or committed file.
- [ ] Backend deployed **separately per network** — a devnet deployment must
      never hold the mainnet admin key.
- [ ] Alert on `[ALERT][claims]` (implausible payout refused) and on the
      webhook's `CRITICAL FATAL ERROR` line — both mean something is wrong that
      nobody is watching for otherwise.
