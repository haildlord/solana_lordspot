# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical rules — read before touching anything

- **Never read `.env` files, or any keypair/secret file** (`backend/.env`, `base_smart_contracts/.env`, `solana_smart_contracts/.env`, `*-keypair.json`, `deployer-keypair.json`, `id.json`, anything under `.secrets/`). They hold live private keys (Solana relayer, Base relayer, Helius API key). Use `backend/.env.example` for the variable shape; ask the user for values instead of reading the real file.
- **Never edit or remove a comment starting with `// !`** anywhere in the codebase, even if the surrounding code changes. These are the repo owner's personal pre-deployment checklist markers (e.g. "switch `init_if_needed` to `init` before deploying", "uncomment the real payload line here"). If a fix makes one stale, say so in chat — don't touch the comment.
- **`frontend/` is now a real, built app** — a Vite/React SPA (see "Frontend" section below). It is no longer empty/ignorable; treat it as a fourth active part alongside `backend/`, `base_smart_contracts/`, `solana_smart_contracts/`.
- Don't make edits beyond what's asked. This is a fund-moving relayer; several routes/behaviors are intentionally left as-is pending the owner's own testing (e.g. `testReq` fixture in the webhook route, `init_if_needed` in the Solana program) — don't "clean these up" unasked.

## What this is

**LordsPot**: a cross-chain lottery relay. Users buy tickets with USDC on Solana; the backend detects the purchase, relays an equivalent purchase to a vault on Base, which forwards it into Megapot's jackpot contract. Megapot runs its lottery in epochs via its own HTTP API, and the backend must pause the Solana program during epoch rollover and resume it once Megapot rolls over — so no purchase lands in a dead epoch.

```
User buys ticket (Solana, USDC)
   → Helius webhook notifies backend (doorbell only)
   → backend re-fetches the tx from its own RPC (chain = truth, not the webhook payload)
   → decodes TicketPurchaseEvent → RelayOrder + Ticket rows (Postgres)
   → backend broadcasts buyTickets() to the Base vault (submit, no wait)
   → confirmer polls the receipt, finalizes SUCCESS / retries / recovers
   → Base vault forwards to Megapot's IJackpot contract
```

## Commands

### `backend/` (Node/TypeScript, Express + BullMQ + Prisma)
```
docker-compose up -d        # Postgres + Redis (backend/docker-compose.yml)
npm run dev                 # API only (tsx watch src/api/server.ts) — workers run inline unless INLINE_WORKERS=false
npm run dev:worker          # BullMQ consumers standalone (src/workers/index.ts)
npm run dev:cron            # indexer + reconciler + epoch heartbeat + vault monitor (src/cron/index.ts)
npm run build                # tsc — note: src/routes/state.ts has pre-existing type errors (dormant, unmounted route, written against an older schema draft)
npm run db:generate | db:migrate | db:push   # Prisma (generated client output: backend/generated/prisma)
```
No test runner is configured (`npm test` is a stub).

### `base_smart_contracts/` (Foundry/Solidity)
```
forge build
forge test                                   # test/BaseVaultTest.sol
npm run export-abi                           # forge build && copies ABI to backend/base_abi/
forge script script/DeployVault.s.sol --broadcast --rpc-url <url>
```

### `solana_smart_contracts/` (Anchor/Rust)
```
anchor build
npm run build:program        # anchor build && copies IDL/types into backend/solana_idl + backend/solana_types
anchor test                  # runs tests/buyTickets.ts via Anchor.toml's [scripts] test
npm run lint / lint:fix      # prettier
npm run start:surfpool / deploy:surfpool / migrate:surfpool   # local Surfpool devnet workflow
```
`Anchor.toml` points `[provider] cluster` at a devnet Helius RPC by default.

### `frontend/` (Vite + React, TypeScript)
```
npm run dev      # vite dev server, port 5173
npm run build    # tsc -b && vite build
```
Needs `backend/` running (`GET /health` on port 3000) and its Postgres seeded with `MegapotEpoch` rows to show real Results data. `.claude/launch.json` at the repo root runs it via `npm run dev --prefix frontend` for the Browser preview tool.

## Architecture

### Process boundaries (backend)
Three logical processes share one codebase, started via separate scripts, but **the API currently also imports the workers inline** (`src/api/server.ts` conditionally does `import('../workers/index')` unless `INLINE_WORKERS=false`):
- **API** (`src/api/server.ts`) — Express. Only two routes are actually mounted: `GET /health` and `POST /webhooks/helius` (`src/routes/webhook.ts`). `src/routes/{orders,quote,state}.ts` exist but are commented out in `server.ts` — dormant/future code, not wired up. `state.ts` also has pre-existing compile errors against an older schema shape.
- **Workers** (`src/workers/index.ts`) — three BullMQ consumers chained by queue, plus the Base confirmer and the settlement worker:
  1. `webhookIngestWorker` — re-fetches the tx from Solana RPC by signature (chain is the source of truth; the webhook payload is only used as a dev-mode fallback when the tx isn't found on-chain and `NODE_ENV !== 'production'`). Checks for the `BuyTicket` instruction, forwards to the next queue.
  2. `ticketWorker` — decodes the Anchor `TicketPurchaseEvent` from logs (via `@coral-xyz/anchor`'s `EventParser`/`BorshCoder`, IDL in `backend/solana_idl/`), creates `RelayOrder` + `Ticket` rows, enqueues the relay queue.
  3. `baseRelayWorker` (**submitter**) — gates on order status / protocol pause / Redis-cached vault balance, then broadcasts `buyTickets()` to the Base vault and returns immediately after the tx hits the mempool (does not wait for confirmation).
  4. `baseConfirmer` (`src/workers/baseConfirmer.ts`, polls every 5s) — the **confirmer** half: polls the receipt, finalizes `SUCCESS` + Megapot ticket IDs, classifies reverts (`already_processed` / `paused` / `permanent` / `transient`) and retries or recovers accordingly, and sweeps stranded `BASE_SUBMITTED` orders (crash recovery).
  5. `settlementWorker` (`src/workers/settlementWorker.ts`, polls every 60s, also invoked from the cron tick) — grades `DRAW_PENDING` tickets against settled `MegapotEpoch` rows once a drawing concludes. See "Ticket settlement & winnings" below.
- **Cron** (`src/cron/index.ts`, not started by the API) — ticks every 30s: `solanaIndexer.pollMissedTransactions` (backup indexer, in case the webhook missed something), `reconciler.runReconciler` (resets stuck `PROCESSING` orders, re-queues `DEFERRED`/retryable orders), `megapotService.checkEpochTransition` (durable heartbeat — derives "is the epoch due?" from the Redis-cached round rather than trusting an in-memory timer), `runSettlementTick` (same settlement pass as the worker process — both running is safe, see below). Also runs `vaultMonitor` every 5 min, which is the only place the *real* on-chain vault balance is read — it refreshes the Redis cache used by the relay worker's circuit breaker.

### Base relay: submit/confirm split (not batched)
Base transactions use one nonce lane per relayer wallet (`baseService.ts`): nonce assignment + sign + broadcast is serialized (microseconds), but confirmation is not — multiple orders can be in-flight and mine in the same block. Every order still gets its own transaction (no batching). If a broadcast fails, the nonce lane resyncs from chain (`getTransactionCount('pending')`) rather than risk a gap. `baseRelayWorker` submits and persists the tx hash immediately; `baseConfirmer` owns everything after that (receipts, reverts, stuck-tx sweep).

### Epoch transitions
`megapotService.ts` orchestrates pause → wait for Megapot to roll to a new epoch → resume, calling `solanaService.pauseProtocol()` / `resumeAndTransitionEpoch()`. This is guarded by a Redis lock (`megapot-transition_lock`) so both the API's boot-time schedule and the cron heartbeat can safely call it. If Megapot's API doesn't roll over (e.g. a Base-chain outage upstream), the protocol is intentionally left **paused** — it polls with backoff (capped at 60s) indefinitely and never gives up, alerting periodically instead.

`needsUpdate` (whether to call `update_epoch` for new ball ranges) is computed by comparing Megapot's incoming `ball_pool` against **`solanaService.getOnChainState()`** — the real on-chain `normalMax`/`bonusMax` — not against the Redis-cached "old" round. Comparing against the cache was a real bug once: the cache can silently drift from on-chain truth (stale seed data, a skipped update), causing `update_epoch` to never fire even when the live ball ranges are wrong. Comparing against `onChain` is self-correcting regardless of cache state.

There's also a "phantom unpause" recovery branch (`transitionLoop`, guarded by `!onChain.isLordsPotPaused`) for when `resumeAndTransitionEpoch` already succeeded on-chain but the loop crashed before finishing its own bookkeeping (e.g. Megapot returned an active-round payload missing `started_at`/`ended_at` right at the rollover boundary — a real eventual-consistency race that happened during testing). That branch resyncs Redis pause-state without re-broadcasting resume (which would double-increment `ongoing_epoch` if it were re-sent) — but it does **not** run the ball-range `needsUpdate` check, so a rollover recovered via this path can leave ball ranges stale until the *next* rollover. Known gap, not yet closed.

Solana transactions here (`solanaService.ts`) set explicit `ComputeBudgetProgram.setComputeUnitLimit`. Learned the hard way: the limit bounds the **whole transaction**, not just the program instruction — the two `ComputeBudget` instructions themselves cost ~150 CU each, and Anchor's account deserialize/constraint-check/reserialize overhead is substantial even for a one-field write (a `resumeProtocol` call failed at `CU_LIMIT_UNPAUSE_ONLY = 5000` with `consumed 4700 of 4700`, i.e. starved before Anchor's own overhead completed). Priority-fee cost of a generous limit is negligible (lamports, not SOL) — size these limits with real margin (measured via `simulateTransaction` or an explorer, ×4-5), not tightly.

For local devnet testing of epoch rollovers without waiting on real Megapot timing, `fetchActiveRoundRaw`/`fetchRoundById` in `megapotService.ts` can point at a local Mockoon mock instead of the real API (temporary — swapped back before real use). Gotcha if you set this up again: Mockoon matches routes top-to-bottom, so a parameterized `/rounds/:id` route placed above a literal `/rounds/active` route will swallow it — `:id` becomes the string `"active"`, not a real epoch id, and downstream `BigInt(fetchedRaw.id)` throws. Put the literal route first.

### Money-state machine
`RelayOrder.status` (Prisma enum `OrderStatus` in `prisma/schema.prisma`): `SOLANA_CONFIRMED → QUEUED → (DEFERRED if epoch locked/paused) → PROCESSING → BASE_SUBMITTED → SUCCESS`, with `RETRY_PENDING`/`FAILED_PERMANENT` as failure branches. `RelayAttempt` rows log each attempt. Idempotency exists at three layers: Redis dedup (cheap pre-filter, not authoritative) → Postgres unique constraints (`WebhookInbox.signature`, `RelayOrder.hash`/`signature`) → the Base vault's own `isOrderFulfilled` mapping (reachable via simulated revert, `OrderAlreadyProcessed`).

### Ticket settlement & winnings
`Ticket.winStatus` (Prisma enum `WinStatus`): `DRAW_PENDING → LOST | WON_UNCLAIMED | WON_FREE_TICKET → CLAIMED_ON_BASE → PAID_OUT_ON_SOLANA`. All five stages are built end-to-end (grading, harvest, and Solana payout) — see `docs/claim-flow.md` for the full plain-English walkthrough of harvest → claim voucher → confirmation.

`settlementWorker.ts` grades tickets once their `RelayOrder.fulfillEpoch` (not `purchaseEpoch` — a deferred order fulfills into a later drawing) shows up as a settled `MegapotEpoch` row. Tier math mirrors Megapot's on-chain `_calculateTicketTierId` exactly (`tierId = 2 × normalMatches + bonusMatch`). `Ticket.winAmount` stores the **net** payout — gross tier payout minus Megapot's 10% referral win-share, computed with the same integer floor as the claim contract (`share = floor(gross × bps / 10000); net = gross - share` — NOT `floor(gross × 0.9)`, which can differ by 1 unit) so it will reconcile exactly against real `TicketWinningsClaimed` events later. Tiers 1 and 4 (bonusball-only / 2-normals-no-bonus) are `WON_FREE_TICKET` instead of `WON_UNCLAIMED` — a product convention (Megapot doesn't label these specially), redeemed as a new ticket rather than cash.

Durability: `MegapotEpoch.ticketsSettledAt` is the watermark (`NULL` = still owes grading work), set only after every ticket of that epoch left `DRAW_PENDING`. Every ticket update is guarded by `winStatus: 'DRAW_PENDING'`, making the pass idempotent and safe to run concurrently from both the worker and cron processes. A server outage spanning multiple rollovers self-heals: boot backfill inserts missed settled epochs with a `NULL` watermark, and `healMissingEpochs()` separately scans from the *ticket* side for any epoch that still has `DRAW_PENDING` tickets but no `MegapotEpoch` row at all, fetching it on demand.

**Harvest** (`backend/src/workers/harvestWorker.ts`, started only by the worker process, Redis-locked so exactly one instance ever runs it): polls every 60s for epochs where `ticketsSettledAt` is set but `ticketsHarvestedAt` isn't. Batches up to 50 winning tickets (cash + free-ticket tiers) per Base `claimWinnings()` call, gas-rehearses via `estimateGas` first and bisects on failure to quarantine exactly the bad ticket ids (never blocks the rest of the batch), and only ever binds tickets to a `HarvestBatch` row *before* broadcasting — so a crash mid-flight is always recoverable purely from Postgres + the chain. On confirmation, tickets flip `WON_UNCLAIMED`/`WON_FREE_TICKET` → `CLAIMED_ON_BASE`; the epoch gets `ticketsHarvestedAt` once fully drained.

**Payout** is the two-signature voucher model: `POST /v1/claims/voucher` (`backend/src/routes/claims.ts`) sums a wallet's unbound `CLAIMED_ON_BASE` (non-free) tickets, binds them to a new `PayoutClaim` row, and has `solanaService.buildClaimVoucher` build+partially-sign a `claim_winnings` transaction as fee payer (so the admin's signature — and thus the transaction signature itself — is known at issuance, before the user ever signs). The frontend (`frontend/src/solana/claimVoucher.ts`) only needs the user to counter-sign and broadcast. On-chain, `claim_winnings` requires *both* signatures (user proves consent/ownership, admin authorizes the exact amount — neither alone can move funds) and pays into the signer's own canonical ATA only. `backend/src/workers/payoutConfirmer.ts` polls every 10s via `getSignatureStatuses` on that known signature (never trusts a frontend callback) and resolves the claim to `CONFIRMED` (tickets → `PAID_OUT_ON_SOLANA`), `FAILED`, or `EXPIRED` (past `lastValidBlockHeight` + a buffer) — the latter two release the bound tickets so a fresh voucher can be issued. One-live-voucher-per-wallet is enforced by `/voucher` simply re-returning an existing `PENDING` claim instead of creating a second one, which is what makes double-payment structurally impossible.

There's no scheduled "claim period" — a ticket becomes claimable the instant harvest confirms for it, which in normal conditions is within a couple of minutes of the draw (both settlement and harvest poll every 60s). The only thing that blocks a claim afterward is the protocol's brief daily pause during epoch rollover, checked both as a friendly `503` in the route and independently enforced on-chain.

The Solana purchase pot and the Base harvest pot are expected to roughly self-balance; only the imbalance needs bridging (CCTP, not a wrapped bridge), with an alert threshold for jackpot-sized tail wins pending manual liquidity rebalance — this part is still manual/unbuilt.

### Frontend
A from-scratch SPA (`frontend/src/`) covering four routes: **Play** (home page — buying tickets IS the landing page, no separate marketing page), **Tickets**, **Winnings**, **Results**. No Faucet/LP-Vault UI by design (deliberately out of scope for this product). State: Zustand for client UI state, TanStack Query v5 for all server/on-chain data. Styling: CSS Modules per component, no inline Tailwind/utility classes.

- `api/` — `client.ts` (thin `fetch` wrapper, `ApiError`), `types.ts` (hand-kept mirror of the backend's response shapes — **check this file and the actual route in `backend/src/routes/protocol.ts`/`claims.ts` before trusting a remembered field name; both have been reshaped mid-project, e.g. `PrizeTier` moved from nested snake_case to flat camelCase), `protocol.ts`/`claims.ts` (endpoint functions), `hooks.ts` (React Query hooks — one hook per screen's data need, e.g. `useProtocolState`, `useEpochs`, `useClaimSummary`).
- `lib/format.ts` — USDC is always a 6-decimal integer string/bigint on both chains; `formatUsdc` divides and floors (never rounds up) to the requested decimals. `formatDollarAmount` is a separate helper for already-whole-dollar values (stats that aren't USDC-scaled) — don't reach for `formatUsdc` there, it will divide by 1e6 incorrectly.
- Solana reads (ball ranges, ticket price, pause flag used to validate/build a buy tx) come from the frontend reading `LordsPotState` on-chain directly — no backend dependency on the money-critical path. Everything else (prize pool mirror, ticket counts, winner breakdowns) comes from the backend's Postgres-backed `/v1/protocol/*` routes.
- **Results page pagination**: `useEpochs()` is a `useInfiniteQuery` (cursor = last page's `nextCursor`, a `megapotId`, `undefined` once exhausted). `Results.tsx` flattens `data.pages.flatMap(p => p.epochs)` for both the list and the detail-view lookup — don't read `data.epochs` directly, that shape no longer exists post-pagination. The "Load More Draws" button reuses the same gold-gradient CTA treatment as the Home page's buy button for visual consistency.
- Vite 8 (Rolldown bundler) doesn't polyfill `Buffer` the old esbuild way — needed for Anchor/web3.js. `vite-plugin-node-polyfills` in `vite.config.ts` handles it; don't try to hand-roll a `resolve.alias` shim again, it silently fails at module-load and blanks the whole app.
- Visual verification discipline: this project got explicit user pushback once for shipping UI changes without actually looking at them in a browser. Always screenshot/verify in the Browser pane before reporting a frontend task done — typecheck passing is necessary, not sufficient.

### Smart contracts
- **Solana program** (`solana_smart_contracts/programs/solana_smart_contracts/src/lib.rs`): single PDA `lords_pot_state` holds `normal_max`, `bonus_max`, `ticket_price`, `ongoing_epoch`, `is_lords_pot_paused`, `admin`. `buy_ticket` validates ball ranges/sort order, transfers USDC via SPL, emits `TicketPurchaseEvent`. `pause_protocol`/`resume_protocol`/`update_epoch` are admin-gated — these are exactly what `solanaService.ts` calls during transitions. USDC mint address is feature-gated in `constants.rs` (`mainnet-beta` vs. default/devnet).
- **Base vault** (`base_smart_contracts/src/LordsPotBaseVault.sol`): `Ownable` + `Pausable`. `buyTickets` is `onlyRelayer`-gated and forwards to an `IJackpot` interface (Megapot's contract) — it's a router/treasury, not the lottery logic. Per-`orderId` idempotency via an internal `isOrderFulfilled` mapping.

### Env vars
See `backend/.env.example`. `SOLANA_RPC_URL`/`SOLANA_PRIVATE_KEY`/`SOLANA_PROGRAM_ID` (Solana side), `BASE_RPC_URL` (or `ANVIL_RPC_URL` as a local-anvil alias)/`RELAYER_BASE_SIGNER_PRIVATEKEY`/`LORDSPOT_BASE_VAULT`/`USDC_BASE_ADDRESS` (Base side), `MEGAPOT_API_KEY`, `HELIUS_WEBHOOK_SECRET` (webhook auth — if unset, auth is skipped with a warning, for local dev only).
