# Partner Integration — Context Handoff

**Written:** 2026-08-27 · **Branch:** `v1_lordspot` · **Status:** all work below is committed, tree clean

Purpose: pick up the ByteArena/Fede integration and SDK work without re-deriving
anything. Read this first; it replaces having to re-read the whole codebase.

For deployment mechanics and the mainnet checklist, see
[`solana_smart_contracts/OPERATIONS.md`](../solana_smart_contracts/OPERATIONS.md)
— that file is the operational runbook, this one is the integration context.

---

## 1. Where things stand right now

### Live devnet state (verified on-chain, not from memory)

```
Program:   5M2BS7XuZgFtKWBBGdyNy4g3UkgdMvd7gvaFVvabcGWo
State PDA: 13fJA2pmD837DpSMFGGzcpGw4jS1P1cbncEUGnstvEYz  (246 bytes, v2)

epoch 156 · not paused · normal_max 30 · bonus_max 10 · price $1.00
relay_fee_base 0 · relay_fee_per_ticket 0        <- ZERO BY DESIGN, see §2
max_tickets_per_purchase 65 · max_claim_amount $100,000
admin    = AigbEGvypACrUq7hgjNwCDfd8SfcgfTH6esHu8maHysS
treasury = AigbEGvypACrUq7hgjNwCDfd8SfcgfTH6esHu8maHysS   <- same as admin, devnet only
```

### What shipped in the session that produced this doc

- Relay fee moved **on-chain** into `buy_ticket` (was a separate frontend-bolted
  SPL transfer anyone could omit), then deliberately **set to zero** — see §2.
- `max_tickets_per_purchase` 15 → **65** (Solana's real byte limit, not Base's
  gas limit — the two were wrongly coupled before).
- Hot/cold key split: `treasury_authority` added, `withdraw_vault_funds` now
  requires it instead of `admin`. Carved from `_reserved`, so **no size change,
  no migration**. Plus `set_admin` / `set_treasury_authority` (both dual-signed).
- `migrate_state` for growing a live state account in place.
- Claim fee payer switched admin → user; `payoutConfirmer` rewritten to
  **discover** landed claims by time-bounded chain scan (the tx signature no
  longer exists at issuance).
- Compile-time tripwire: build fails if `LordsPotState` changes size without
  `STATE_VERSION` being bumped.
- `mainnet-beta` Cargo feature declared (was undeclared → mainnet USDC branch
  was dead code). Proven by a `#[cfg(test)]` pair — `cargo test` and
  `cargo test --features mainnet-beta` each compile a *different* test.
- Frontend: quick-picks `[5,10,50,100,150,200]`, cap 200, seeds 1 ticket on
  load, gold "FREE" fee badge, USDC balance gate, tx history regrouped so one
  Solana purchase = one row with its Base relay batches nested under it.

---

## 2. The economics — read this before touching fees or caps

**This is the single most important thing to carry forward.** It reversed two
earlier decisions and will reverse more if forgotten.

LordsPot is Megapot's **referrer**. Every $1 ticket earns ~**$0.10** referral
revenue, plus a share of winnings. Relaying that ticket costs ~**$0.01** of Base
gas. So:

```
revenue per ticket : $0.10
gas cost per ticket: $0.0097
profit at ZERO fee : ~$0.09   (≈10x the cost of doing the relay)
break-even Base gas: ~0.06 gwei  (~10x current 0.006 gwei)
```

**Consequences that keep getting rediscovered the hard way:**

1. **Charging users a relay fee is value-destroying.** It suppresses the volume
   that actually pays for the protocol. Hence fees = 0.
2. **Charging *partners* an API/integration fee is also value-destroying** —
   same logic, one level up. A partner driving 1,000 tickets/day is worth ~$90/day
   in profit; a $50/month API fee is ~2% of that while adding friction.
   → **Pay partners a referral rev-share instead** (open at 25–30%).
3. The fee *mechanism* is deliberately kept (set to 0, not deleted) as the lever
   if Base gas ever spikes past break-even. `set_relay_config` changes it with
   no redeploy — but the frontend mirrors those values in
   `frontend/src/solana/constants.ts` and must be updated to match, or the UI
   quotes a different number than the program charges.

**Megapot gas is quadratic, not linear** — fitted from real mainnet Basescan data:

```
gas(N) = 433,267 + 505,996·N + 8,815·N²
```

Meaning: cost per ticket is U-shaped (cheapest around chunk 7–10), max ~23
tickets per Base tx (22 already uses 94% of the 16,777,216 gas limit), and
**bulk discounts are economically backwards for us**. Current Base chunk size is
15 — deliberately kept over the marginally-cheaper 10 because fewer sequential
Base txs = faster relay, and gas is noise next to referral revenue.

---

## 3. The three ticket limits (constantly confused — keep them separate)

| Limit | Value | Set by | Lives in | Redeploy? |
|---|---|---|---|---|
| Basket cap (UX) | 200 | wallet reliability (4 txs, 1 approval) | `MAX_STAGED_TICKETS` + last `QUICK_COUNTS` entry | No |
| Per Solana tx | 65 | **Solana's 1232-byte limit** | `TICKET_RULES.MAX_TICKETS_PER_IX` **and** on-chain `max_tickets_per_purchase` | No — `set_relay_config` |
| Per Base tx | 15 | **Base's gas ceiling** | backend `config.relay.baseTicketChunkSize` | No |
| Hard backstop | 100 | safety | `HARD_MAX_TICKETS_PER_PURCHASE` in `lib.rs` | **Yes** |

Measured, not estimated: 65 tickets = 1,130 bytes (of 1232), ~38,354 CU (of
1.4M). **Bytes are the binding constraint, not compute** — CU is at ~3%.
10 bytes per ticket; instructions in one tx *share* the byte budget, so
splitting into multiple instructions does not buy more room.

---

## 4. ByteArena / Fede — what he actually wants

He described **three products**, not one. They need different integrations:

**Mode 1 — "Companion":** your personal agent helps you pick numbers, adds lore,
ends the session. You return later for a dramatized number-by-number "reveal
session" (it already knows the result; it's paced for show). Turns Megapot's
once-daily draw from a dead-time problem into a return hook.

**Mode 2 — "Autonomous seller":** a standalone AI persona livestreaming
Twitch/YouTube-style, *selling tickets to its audience*. Viewers are being
pitched, not controlling it.

**Mode 3 — ByteArena platform:** users create their own agent; buying a LordsPot
ticket is one "game" among several the agent can play.

Demo he shared: https://x.com/bytearenafun/status/2088384197735927922

**Frontend metaphor across all three is a livestream, not a trading dashboard.**

### How each maps to our stack

- **Modes 1 & 3** → the SDK (agent transacts for an individual). Non-custodial;
  his agent signs with the user's key.
  **The "reveal session" needs zero new work from us** — `GET /v1/protocol/state`
  already returns `nextDrawAt`, and `GET /v1/protocol/tickets` already returns
  the ticket's numbers *and* the epoch's winning numbers side by side, so his
  agent can compute and narrate the match itself.
- **Mode 2** → **not an SDK problem.** It's referral traffic — his stream drives
  *viewers'* wallets. Megapot supports only one referrer address (set in our
  vault config), so a rev-share here can't be enforced on-chain; it must be
  tracked off-chain by us. We already pass a `source` tag to the vault per order
  — tagging his traffic is a small backend change, no SDK involved.

**Open question to ask him:** which mode is the hackathon demo actually? That
decides whether this is a 3–4 day SDK sprint or a same-day referral tag.

---

## 5. What already works today (partner can integrate with ZERO code from us)

| Need | How | Mounted? |
|---|---|---|
| Buy tickets | `buy_ticket` on-chain, permissionless, via our IDL | ✅ works now |
| Did tickets land? | `GET /v1/protocol/tickets?wallet=X` | ✅ `server.ts` |
| Claimable amount | `GET /v1/claims/summary?wallet=X` | ✅ |
| Claim winnings | `POST /v1/claims/voucher` | ✅ |

Also mounted: `/v1/protocol/state`, `/epochs`, `/stats`,
`/epochs/:id/winners`. Dormant (commented out in `server.ts`): `orders`,
`quote`, `state`.

The Helius webhook is a **doorbell only** — the backend re-fetches from chain and
decodes `TicketPurchaseEvent`, so it picks up *any* `buy_ticket` call regardless
of origin. A partner's purchases flow through the relay automatically.

Server-to-server calls are **not subject to CORS**, so a Node-based agent works
today. A *browser*-based partner would be blocked by the `FRONTEND_ORIGIN`
allowlist.

---

## 6. Integration gotchas — tell every partner these upfront

1. **Ball ranges change per epoch.** `normal_max`/`bonus_max` change on
   `update_epoch`. The agent **must read on-chain state before generating
   numbers** or tickets revert. This is the #1 thing that will bite them.
2. Numbers must be **exactly 5 normals, strictly ascending, no duplicates**;
   bonus in range.
3. **Daily pause during epoch rollover** — purchases revert for a few minutes.
   Needs retry logic, not an error state.
4. **Agent needs SOL, not just USDC** — it's the fee payer for buying *and*
   claiming.
5. **65 tickets max per transaction** (SDK should hide this).
6. **Rate limit is 60 req/min/IP** — an aggressive polling agent will hit it.
   Needs raising for registered partners.
7. **`fee_recipient` must never be a wallet that also buys tickets** — buyer and
   fee recipient resolving to the same account fails hard with
   `ConstraintDuplicateMutableAccount`, even at zero fee.

---

## 7. The SDK — plan and honest estimate

### Why it's a security boundary, not just DX

Handing partners a raw `BACKEND_URL` and a hand-rolled script is the problem:

- **`/v1/claims/summary` has no auth.** "No auth needed for correctness" is true
  for *issuing* a voucher (only the real wallet can sign it) but **not** for
  *reading balances* — anyone with the URL can query any wallet's winnings.
  Real info-disclosure gap.
- Partners hard-couple to literal infrastructure — move hosts/add a gateway and
  every integration breaks with no version boundary.
- No per-caller observability; it's all flat IPs.
- Browser-based partners are CORS-blocked outright.

An SDK removes every one of those: the URL is baked in, the two-signature dance
and the blockhash-expiry window become internal details.

```ts
const lordspot = createLordsPot({ network: 'mainnet' });
const summary  = await lordspot.getClaimSummary(walletPubkey);
const sig      = await lordspot.claim(signer); // fetch → sign → submit → confirm
```

### Measured extraction reality (not a guess)

Of ~754 LOC of candidate frontend code: **~40% is genuinely reusable.** The rest
is React/Vite-shaped and must be rewritten for a Node agent context.

| Portable ✅ | Needs rewrite 🔴 |
|---|---|
| `ticketUtils.ts` (58) — validation, quick-pick, sorting | `constants.ts` (57) — `import.meta.env`, Vite-only |
| `pdas.ts` (22) — PDA/ATA derivation | `api/client.ts` (30) — `import.meta.env` |
| `api/types.ts` (160) | `program.ts`, `claimVoucher.ts`, `useOnChainState.ts`, `useUsdcBalance.ts`, `api/hooks.ts` (~275) — React/wallet-adapter/TanStack |
| `buyTickets.ts` (119) — logic portable, needs config injection | |

Core problem: the frontend assumes *a browser with a wallet extension*; an agent
is *a Node process with a raw keypair*. `claimVoucher.ts` takes a
`WalletContextState`; `program.ts` is a React hook. Neither survives the move.

### Estimate: **3–4 focused days**

- **Day 1** — config injection (`createLordsPot({...})` replacing
  `import.meta.env`), port the clean pieces, ESM/CJS build setup
- **Day 2** — buy path: signer interface instead of wallet adapter, keep 65-cap
  chunking, add on-chain ball-range read before generating tickets
- **Day 3** — claim path + plain `fetch` API wrappers (no TanStack)
- **Day 4** — docs + working devnet example + testing as an *outside consumer*
  (fresh dir, `npm install`, does it actually work?)

**Day 4 is the one that slips**, and an SDK that compiles but has confusing docs
is worse than none — the partner hand-rolls against the IDL anyway.

**The claim half alone is ~half a day** (two REST calls + one sign, no chunking,
no on-chain validation) if it needs shipping standalone first.

### Recommendation

**Don't build speculatively.** Tell Fede Tier 1 works today (program ID, IDL,
the four endpoints) — unblocks his hackathon immediately at zero cost. Build the
SDK if he ships and drives real volume; it pays for itself at $0.10/ticket. Most
hackathon projects die after judging.

**Worth doing in ~30 min regardless:** a one-page integration doc — program ID,
IDL location, endpoints, and the seven gotchas in §6. That's 90% of the SDK's
real value at 2% of the cost.

---

## 8. Open decisions (nothing blocked on code — these need your call)

1. **Should `getClaimSummary` require a partner identifier?** Given the
   info-disclosure gap in §7, or is wallet-scoped-no-auth acceptable since
   nothing fund-moving depends on it?
2. **Node-only, or must the SDK work in a browser?** (Browser means solving the
   CORS allowlist too.)
3. **Fold claim into the same SDK package as buy, or ship claim standalone
   first?** (It's small and partners will want it soonest.)
4. **Rev-share percentage** with partners — open at 25–30%?
5. **Partner attribution mechanism:** v1 is registering their agent wallet
   addresses and tagging in our DB (zero contract change). Only if they use many
   ephemeral wallets would an on-chain `source` tag be needed — that *is* a
   program change (new instruction arg → event → decoder → schema). Defer.
6. **Raise the 60 req/min rate limit** for registered partners before any
   partner goes live.

---

## 9. Testing status (devnet)

Passing: 1-ticket buy · 65-ticket buy (one Solana tx, five Base batches
15/15/15/15/5) · 66-ticket split (2 txs) · 200-ticket buy · input clamps at 200
live · decrement to 0 disables Buy without re-seeding · insufficient-USDC now
gated in UI before the wallet popup.

Not yet run (needs setup): empty Base vault → defers · **pause mid-purchase →
partial fill** (ugliest case in the system — a 200-ticket buy is 4 txs; pausing
after 2 land means the user gets ~130 tickets, correct-but-confusing) ·
`normal_max` changed while tickets staged · 200-ticket relay watched end-to-end
through ~14 sequential Base chunks.

---

## 10. Known gaps carried forward

- **Base vault has no hot/cold split.** `DeployVault.s.sol` derives `owner` and
  `relayer` from the *same* env var, so the always-online backend key is also
  `onlyOwner` for `withdrawUsdc` (uncapped), `setVaultMegapotAddress` (can
  repoint at a malicious contract), `setVaultRelayer`. This is the exact risk the
  Solana treasury split closed — still open on Base. Details in `OPERATIONS.md`.
- **`mainnet-beta` must be passed explicitly at deploy** — a bare
  `cargo build-sbf` silently produces the devnet binary.
- **Extensive TESTING-ONLY code paths** in `harvestWorker.ts`, `baseService.ts`,
  `megapotService.ts`, and `LordsPotBaseVault.sol` (real `claimWinnings` is
  commented out; a 5-arg mock-shaped version is live). All fenced with `// ->`
  markers. Must flip together — backend call shape and deployed contract
  signature must match. Full map in `OPERATIONS.md`.
- **Never edit comments starting with `// !`, `// *`, or `// ->`** — repo
  owner's own markers, per `CLAUDE.md`.
