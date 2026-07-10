# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical rules — read before touching anything

- **Never read `.env` files, or any keypair/secret file** (`backend/.env`, `base_smart_contracts/.env`, `solana_smart_contracts/.env`, `*-keypair.json`, `deployer-keypair.json`, `id.json`, anything under `.secrets/`). They hold live private keys (Solana relayer, Base relayer, Helius API key). Use `backend/.env.example` for the variable shape; ask the user for values instead of reading the real file.
- **Never edit or remove a comment starting with `// !`** anywhere in the codebase, even if the surrounding code changes. These are the repo owner's personal pre-deployment checklist markers (e.g. "switch `init_if_needed` to `init` before deploying", "uncomment the real payload line here"). If a fix makes one stale, say so in chat — don't touch the comment.
- **`frontend/` is empty — ignore it.** The three active parts are `backend/`, `base_smart_contracts/`, `solana_smart_contracts/`.
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

## Architecture

### Process boundaries (backend)
Three logical processes share one codebase, started via separate scripts, but **the API currently also imports the workers inline** (`src/api/server.ts` conditionally does `import('../workers/index')` unless `INLINE_WORKERS=false`):
- **API** (`src/api/server.ts`) — Express. Only two routes are actually mounted: `GET /health` and `POST /webhooks/helius` (`src/routes/webhook.ts`). `src/routes/{orders,quote,state}.ts` exist but are commented out in `server.ts` — dormant/future code, not wired up. `state.ts` also has pre-existing compile errors against an older schema shape.
- **Workers** (`src/workers/index.ts`) — three BullMQ consumers chained by queue, plus the Base confirmer:
  1. `webhookIngestWorker` — re-fetches the tx from Solana RPC by signature (chain is the source of truth; the webhook payload is only used as a dev-mode fallback when the tx isn't found on-chain and `NODE_ENV !== 'production'`). Checks for the `BuyTicket` instruction, forwards to the next queue.
  2. `ticketWorker` — decodes the Anchor `TicketPurchaseEvent` from logs (via `@coral-xyz/anchor`'s `EventParser`/`BorshCoder`, IDL in `backend/solana_idl/`), creates `RelayOrder` + `Ticket` rows, enqueues the relay queue.
  3. `baseRelayWorker` (**submitter**) — gates on order status / protocol pause / Redis-cached vault balance, then broadcasts `buyTickets()` to the Base vault and returns immediately after the tx hits the mempool (does not wait for confirmation).
  4. `baseConfirmer` (`src/workers/baseConfirmer.ts`, polls every 5s) — the **confirmer** half: polls the receipt, finalizes `SUCCESS` + Megapot ticket IDs, classifies reverts (`already_processed` / `paused` / `permanent` / `transient`) and retries or recovers accordingly, and sweeps stranded `BASE_SUBMITTED` orders (crash recovery).
- **Cron** (`src/cron/index.ts`, not started by the API) — ticks every 30s: `solanaIndexer.pollMissedTransactions` (backup indexer, in case the webhook missed something), `reconciler.runReconciler` (resets stuck `PROCESSING` orders, re-queues `DEFERRED`/retryable orders), `megapotService.checkEpochTransition` (durable heartbeat — derives "is the epoch due?" from the Redis-cached round rather than trusting an in-memory timer). Also runs `vaultMonitor` every 5 min, which is the only place the *real* on-chain vault balance is read — it refreshes the Redis cache used by the relay worker's circuit breaker.

### Base relay: submit/confirm split (not batched)
Base transactions use one nonce lane per relayer wallet (`baseService.ts`): nonce assignment + sign + broadcast is serialized (microseconds), but confirmation is not — multiple orders can be in-flight and mine in the same block. Every order still gets its own transaction (no batching). If a broadcast fails, the nonce lane resyncs from chain (`getTransactionCount('pending')`) rather than risk a gap. `baseRelayWorker` submits and persists the tx hash immediately; `baseConfirmer` owns everything after that (receipts, reverts, stuck-tx sweep).

### Epoch transitions
`megapotService.ts` orchestrates pause → wait for Megapot to roll to a new epoch → resume, calling `solanaService.pauseProtocol()` / `resumeAndTransitionEpoch()`. This is guarded by a Redis lock (`megapot-transition_lock`) so both the API's boot-time schedule and the cron heartbeat can safely call it. If Megapot's API doesn't roll over (e.g. a Base-chain outage upstream), the protocol is intentionally left **paused** — it polls with backoff (capped at 60s) indefinitely and never gives up, alerting periodically instead.

### Money-state machine
`RelayOrder.status` (Prisma enum `OrderStatus` in `prisma/schema.prisma`): `SOLANA_CONFIRMED → QUEUED → (DEFERRED if epoch locked/paused) → PROCESSING → BASE_SUBMITTED → SUCCESS`, with `RETRY_PENDING`/`FAILED_PERMANENT` as failure branches. `RelayAttempt` rows log each attempt. Idempotency exists at three layers: Redis dedup (cheap pre-filter, not authoritative) → Postgres unique constraints (`WebhookInbox.signature`, `RelayOrder.hash`/`signature`) → the Base vault's own `isOrderFulfilled` mapping (reachable via simulated revert, `OrderAlreadyProcessed`).

### Smart contracts
- **Solana program** (`solana_smart_contracts/programs/solana_smart_contracts/src/lib.rs`): single PDA `lords_pot_state` holds `normal_max`, `bonus_max`, `ticket_price`, `ongoing_epoch`, `is_lords_pot_paused`, `admin`. `buy_ticket` validates ball ranges/sort order, transfers USDC via SPL, emits `TicketPurchaseEvent`. `pause_protocol`/`resume_protocol`/`update_epoch` are admin-gated — these are exactly what `solanaService.ts` calls during transitions. USDC mint address is feature-gated in `constants.rs` (`mainnet-beta` vs. default/devnet).
- **Base vault** (`base_smart_contracts/src/LordsPotBaseVault.sol`): `Ownable` + `Pausable`. `buyTickets` is `onlyRelayer`-gated and forwards to an `IJackpot` interface (Megapot's contract) — it's a router/treasury, not the lottery logic. Per-`orderId` idempotency via an internal `isOrderFulfilled` mapping.

### Env vars
See `backend/.env.example`. `SOLANA_RPC_URL`/`SOLANA_PRIVATE_KEY`/`SOLANA_PROGRAM_ID` (Solana side), `BASE_RPC_URL` (or `ANVIL_RPC_URL` as a local-anvil alias)/`RELAYER_BASE_SIGNER_PRIVATEKEY`/`LORDSPOT_BASE_VAULT`/`USDC_BASE_ADDRESS` (Base side), `MEGAPOT_API_KEY`, `HELIUS_WEBHOOK_SECRET` (webhook auth — if unset, auth is skipped with a warning, for local dev only).
