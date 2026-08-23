# LordsPot Solana Program — Operations Runbook

Read the section for a function **before** you call it. Every section has three
parts: **BEFORE** (things that must already be true), **CALL** (what actually
happens on-chain), **AFTER** (what to verify / do next).

Two keys matter everywhere in this doc:

- **admin (hot key)** — lives in the backend server, signs constantly (every
claim voucher, pause/resume, config changes). Compromise = annoying, not fatal.
- **treasury (cold key)** — the ONLY key that can withdraw the vault. Never put
it on a server. Compromise = total loss.

---

## `initialize`

**Runs exactly once, ever.** The state account uses `init`, not
`init_if_needed` — a second call fails outright, it does not overwrite.

### BEFORE

- [ ] Program bytecode is already deployed at the target program ID.
- [ ] You have decided your **admin wallet** (whoever signs this transaction
  ```
  becomes admin — there is no hardcoded admin to configure separately).
  ```
- [ ] You have decided your **treasury wallet** — a genuinely different key
  ```
  from admin, ideally a hardware wallet or Squads vault (see "Key & authority
  separation" in the Pre-Mainnet Master Checklist at the bottom). Passing the
  same wallet as both is allowed by the program but defeats the entire point
  of the split.
  ```
- [ ] The **fee_recipient**'s USDC associated token account (ATA) already
  ```
  exists on-chain. It does not need a balance — it needs to *exist*. If it
  doesn't, every single `buy_ticket` will revert until you fix it.
  ```
- [ ] You know your real `ticket_price` (USDC has 6 decimals — $1.00 = `1_000_000`).
- [ ] You know your real `relay_fee_base` / `relay_fee_per_ticket` (see
  ```
  `frontend/src/solana/constants.ts` — these two values must match what's
  on-chain, or the UI quotes a different number than the program charges).
  ```
- [ ] You know `max_tickets_per_purchase` — this **must equal** the backend's
  ```
  `config.relay.baseTicketChunkSize`, or the relay fee stops lining up with
  real Base gas cost per instruction.
  ```
- [ ] You know `max_claim_amount` — must be set ABOVE the real maximum possible
  ```
  Megapot payout, or a legitimate big winner gets blocked from claiming.
  (See "Values to re-check before flipping the switch" in the Pre-Mainnet
  Master Checklist at the bottom of this file.)
  ```



### CALL

Sets admin, ball ranges, ticket price, starting epoch, relay fee config, fee
recipient, ticket cap, claim ceiling, and treasury — all in one shot. Creates
the vault's USDC ATA if it doesn't already exist.

### AFTER

- [ ] Fetch the state account and print every field. Confirm `admin`,
  ```
  `treasury_authority`, `fee_recipient`, `ticket_price`, and
  `max_tickets_per_purchase` are exactly what you intended — there is no
  "edit initialize" button, only follow-up admin instructions.
  ```
- [ ] Confirm `treasury_authority` is NOT the all-zero pubkey and is NOT the
  ```
  same wallet as admin (unless you deliberately accepted that for now).
  ```
- [ ] Do a tiny test `buy_ticket` (1 ticket) on devnet/testnet before trusting
  ```
  it with real volume — this is what actually proves `fee_recipient`'s ATA
  is correctly wired.
  ```

---



## `migrate_state`

**Only relevant if you already have a live account from an older program
version.** A fresh `initialize` never needs this.

### BEFORE

- [ ] **Pause the protocol first**, using the OLD bytecode (before you deploy
  ```
  the new version). Once new bytecode is live, every instruction that
  expects the new struct — including `pause_protocol` itself — will fail to
  decode against the still-old account. Pausing first avoids a window
  where you can't even pause.
  ```
- [ ] Deploy the new bytecode.
- [ ] **Read the exact byte layout the new code expects** and update, in the
  ```
  source, before building:
  - `STATE_VERSION` incremented
  - `LEGACY_STATE_SIZE` set to the PREVIOUS total account size (what you're
    migrating *from*)
  - `STATE_SIZE_AT_CURRENT_VERSION` set to the new total (the build will
    refuse to compile if this is wrong — that's intentional)
  ```
- [ ] Have your new `treasury_authority`, fee config, and claim ceiling values
  ```
  ready — this call is your only chance to set fields that didn't exist on
  the old account (they'd otherwise land as zero).
  ```
- [ ] Know the signer must be the **admin currently stored in the old account**
  ```
  — this is verified by reading raw bytes, not by a normal typed constraint.
  ```



### CALL

Reads the raw account, verifies its address, owner, exact old size,
discriminator, and stored admin by hand (it cannot use normal Anchor checks —
the stored bytes don't match the new struct yet, which is the entire reason
this instruction exists). Tops up rent if needed, grows the account, and writes
the new field values. If the account is already at the new size, this is a
safe no-op — it does not re-run and does not corrupt anything.

### AFTER

- [ ] Fetch the state account with the NEW IDL and confirm every OLD field
  ```
  (admin, epoch, ticket_price, pause flag) survived unchanged.
  ```
- [ ] Confirm every NEW field was actually set to what you intended — do not
  ```
  assume, read it back.
  ```
- [ ] **If** `treasury_authority` **reads as all-zero after migration** (this
  ```
  happens if you migrated to a version that added the field before you knew
  to pass a real value), you must run `set_treasury_authority` in its
  bootstrap mode before ANY withdrawal is possible. See that section below.
  ```
- [ ] Unpause.

---



## `set_admin`

Hands the admin role to a different key. The admin controls
pause/resume/epoch/claim-signing/config — NOT the treasury.

### BEFORE

- [ ] You control both the current admin key (must sign) and the new admin key
  ```
  (must ALSO sign, in the same transaction) — this is not optional, it's
  what stops a typo from permanently bricking every admin instruction.
  ```
- [ ] Understand this does **not** rotate `ADMIN_PUBKEY` in `constants.rs` —
  ```
  that constant no longer exists. Admin is purely on-chain state now.
  ```
- [ ] If the backend server auto-signs claim vouchers with the old admin key,
  ```
  have the new key's secret ready to swap into the server's config
  **immediately after** this lands — a gap here means claims silently fail
  until the server is updated.
  ```



### CALL

Requires both the current admin and the new admin to co-sign. Writes the new
key into `state.admin`.

### AFTER

- [ ] Update the backend's admin signing key (`.env` / secrets) immediately.
- [ ] Any claim voucher issued but not yet landed, signed by the OLD admin key,
  ```
  will now fail on submission (the co-signer no longer matches). This is
  safe — the payout confirmer detects the failure and releases the tickets
  for a fresh voucher — but expect a few claims to need re-issuing right
  after a rotation. Rotate during low traffic if you can.
  ```
- [ ] Fetch state and confirm `admin` is the new key.

---



## `set_treasury_authority`

Two different situations, same instruction:

### Situation A — BOOTSTRAP (treasury is currently all-zero)

This happens if you migrated to a version that added `treasury_authority`
before you had a real value to pass — it lands as the zero pubkey.

**BEFORE**

- [ ] Confirm via a state fetch that `treasury_authority` really is the
  ```
  default/zero pubkey. If it's already a real key, you're in Situation B
  below, not this one.
  ```
- [ ] Have the admin key (current, stored on-chain) available to sign.
- [ ] Have the real treasury key ready — it must ALSO sign this transaction.

**CALL**
Admin signs, new treasury key signs, `treasury_authority` is set.

**AFTER**

- [ ] Fetch state, confirm `treasury_authority` is now your real cold key.
- [ ] This bootstrap path can only fire once — the moment treasury is
  ```
  non-zero, only Situation B applies from then on.
  ```



### Situation B — ROTATION (treasury is already set to a real key)

**BEFORE**

- [ ] Have the CURRENT treasury key available — admin cannot do this rotation,
  ```
  by design. If the hot admin key could reassign the treasury, a leaked
  admin key would still hand over the vault.
  ```
- [ ] Have the new treasury key ready to co-sign.

**CALL**
Current treasury signs, new treasury signs, `treasury_authority` updates.

**AFTER**

- [ ] Fetch state, confirm the new treasury key is stored.
- [ ] Securely retire the old treasury key's usage — don't just leave it lying
  ```
  around assuming it's harmless; it no longer has any power, but good
  hygiene says rotate it out of any password manager / hardware device
  entry you had for "the treasury key."
  ```

---



## `set_relay_config`

Changes the fee, fee destination, per-instruction ticket cap, and claim
ceiling. **NOT paused-gated** — deliberately, so you can re-price during an
incident (e.g. a sudden Base gas spike) without needing to pause first.

### BEFORE

- [ ] If you're changing `fee_recipient`: the NEW recipient's USDC ATA must
  ```
  already exist, or every `buy_ticket` reverts starting immediately after
  this call lands.
  ```
- [ ] If you're changing `max_tickets_per_purchase`: it must still match the
  ```
  backend's `config.relay.baseTicketChunkSize`, or fees stop lining up
  with real Base gas per instruction. Update both sides together.
  ```
- [ ] Update `frontend/src/solana/constants.ts` (`RELAY_FEE_BASE_USDC`,
  ```
  `RELAY_FEE_PER_TICKET_USDC`) to match what you're about to set on-chain —
  the frontend does not read these live, it has its own copy for quoting.
  ```
- [ ] Signed by admin only.



### CALL

Overwrites relay fee base/per-ticket, fee recipient, ticket cap, and claim
ceiling in one shot.

### AFTER

- [ ] Fetch state, confirm every field landed as intended.
- [ ] Deploy the matching frontend constants update — until you do, the UI will
  ```
  quote the OLD fee while the program charges the NEW one (transactions
  still work, the number shown to users is just wrong).
  ```
- [ ] If you raised `max_claim_amount` specifically to let a real jackpot
  ```
  winner claim, tell them to retry now.
  ```

---



## `buy_ticket`

The only instruction regular users call directly. No admin action needed to
operate it day-to-day — this section is here so you know what conditions make
it revert, since you'll get support questions about it.

### Preconditions checked on-chain (in order)

1. Ticket count between 1 and `max_tickets_per_purchase` (not the hardcoded
  100 ceiling — the admin-configured one, which is usually smaller).
2. Protocol not paused.
3. Every ticket: exactly 5 normal numbers, in range, strictly ascending, no
  duplicates; bonus ball in range.
4. Buyer's USDC ATA has enough for `ticket_price × count` PLUS the relay fee
  (`relay_fee_base + relay_fee_per_ticket × count`) — **two separate
   transfers**, ticket money and fee money never mix.
5. `fee_recipient`'s USDC ATA exists (see `initialize`/`set_relay_config`
  above — this is an admin setup responsibility, not the buyer's).



### AFTER (as admin/ops, not per-purchase)

- Nothing to do per purchase — this is the automated path. If buyers report
reverts, check items 1–5 above against current state, in that order.

---



## `pause_protocol`



### BEFORE

- [ ] Confirm the protocol is currently NOT paused (calling this while already
  ```
  paused reverts).
  ```
- [ ] Signed by admin.



### CALL

Sets `is_lords_pot_paused = true`. Freezes `buy_ticket` and `claim_winnings`
immediately. Does **not** freeze `withdraw_vault_funds` (deliberate — that's
the evacuation lever, it must still work mid-incident) or admin instructions.

### AFTER

- [ ] Any in-flight `claim_winnings` voucher that hasn't landed yet will now
  ```
  revert on submission. This is safe by design — it dies at blockhash
  expiry, the payout confirmer notices, and releases the tickets for a
  fresh voucher once you resume.
  ```
- [ ] If pausing for a scheduled action (migration, epoch rollover), proceed to
  ```
  that action now — the pause alone does nothing else.
  ```

---



## `resume_protocol`



### BEFORE

- [ ] Confirm the protocol IS currently paused (calling this while not paused
  ```
  reverts).
  ```
- [ ] Know the `next_epoch` value — it must be strictly greater than the
  ```
  current `ongoing_epoch`, or this reverts.
  ```
- [ ] If ball ranges (`normal_max`/`bonus_max`) need to change for the new
  ```
  epoch, call `update_epoch` FIRST, while still paused (see next section —
  `update_epoch` requires paused state).
  ```



### CALL

Sets `is_lords_pot_paused = false` and updates `ongoing_epoch`.

### AFTER

- [ ] Confirm `buy_ticket` and `claim_winnings` work again (a quick devnet-style
  ```
  smoke test if this is a scheduled maintenance window).
  ```
- [ ] Any claim vouchers released by the earlier pause can now be re-issued
  ```
  through the normal backend flow.
  ```

---



## `update_epoch`



### BEFORE

- [ ] Protocol must currently be PAUSED (this reverts if not).
- [ ] The new `normal_max`/`bonus_max` must differ from the current values —
  ```
  calling with identical values reverts (`SameAsPreviousEpoch`).
  ```
- [ ] Signed by admin.



### CALL

Updates ball range limits for the upcoming epoch.

### AFTER

- [ ] Call `resume_protocol` when ready to go live with the new ranges — this
  ```
  instruction alone does not unpause.
  ```

---



## `claim_winnings`

Called by the WINNER's wallet, co-signed by admin (as a pre-built voucher from
the backend). Not something you call manually as an admin in normal operation —
documented here so you understand what can make it fail.

### Preconditions checked on-chain

1. `amount > 0`.
2. `amount <= max_claim_amount` — the sanity ceiling. If a REAL win legitimately
  exceeds this, the claim is blocked (fails closed) until an admin raises
   `max_claim_amount` via `set_relay_config`.
3. Vault has enough USDC to cover it.
4. Protocol not paused.
5. Both signatures present: the winner (who is also the fee payer) AND admin.



### If a legitimate large win gets blocked by #2

- [ ] Confirm the win is real (cross-check your own settlement records, not
  ```
  just the user's claim).
  ```
- [ ] Raise `max_claim_amount` via `set_relay_config` to comfortably above the
  ```
  real payout.
  ```
- [ ] Have the user retry — the backend re-issues a fresh voucher automatically
  ```
  once the ceiling allows it.
  ```



### Ongoing responsibility (backend, not this program)

- The chain enforces the ceiling and the two signatures — it has no way to know
if `amount` itself is *correct* for that specific winner. That correctness
lives entirely in the backend's voucher-issuance logic
(`backend/src/routes/claims.ts`). Treat that code and your Postgres backups
with the same seriousness as a security boundary — a bad amount that gets
admin-signed will be paid out exactly as instructed.

---



## `withdraw_vault_funds`

The single most powerful instruction in the program. Uncapped. Moves USDC
straight out of the vault to any USDC token account you name.

### BEFORE

- [ ] Signed by the TREASURY key — not admin. If your treasury key is cold
  ```
  (hardware wallet / Squads), this means physically or procedurally
  producing that signature, which should feel deliberately slower than
  every other admin action here. That friction is the point.
  ```
- [ ] Double, triple check the destination account. `transfer_checked` enforces
  ```
  the mint matches USDC, but it does **not** know if the destination
  address is the one you meant to type.
  ```
- [ ] Know exactly why you're withdrawing (devnet cleanup, CCTP rebalancing,
  ```
  emergency evacuation) — there's no on-chain record of "why," only "who
  and how much," so keep your own operational log.
  ```



### CALL

Moves USDC from the vault to the named destination. Works even while paused
(deliberately — this is the evacuation lever).

### AFTER

- [ ] Confirm the destination actually received the funds (check the
  ```
  transaction, don't just trust it landed).
  ```
- [ ] Log the withdrawal amount, destination, and reason somewhere durable —
  ```
  the `VaultWithdrawalEvent` on-chain has amount/destination/timestamp but
  not your business reason.
  ```
- [ ] If this was a partial evacuation during an incident, plan the rest of
  ```
  your incident response — this instruction moving funds is a step, not a
  resolution.
  ```

---

# Pre-Mainnet Master Checklist

Everything below was found by a full repo sweep done specifically to prepare
for mainnet. It is organized by "what kind of mistake this prevents," not by
file — deployment day goes file-by-file already; this is meant to be read
once, end to end, before that day.

**Ground rule for this whole section: comments starting with `// !`, `// *`,
or `// ->` are the repo owner's own annotations. Never edit or remove them —
not even ones that look stale. If one seems wrong, say so in chat; don't
"fix" it in the file.**

---

## 🔴 Build-blocking — fix this first, nothing else matters until you do

**The `mainnet-beta` Cargo feature does not exist.** `constants.rs` switches
the USDC mint on `#[cfg(feature = "mainnet-beta")]`, but that feature is
never declared in `Cargo.toml`'s `[features]` block. A normal build can only
ever satisfy the `#[cfg(not(...))]` branch — the devnet mint. Passing
`--features mainnet-beta` to `cargo`/`anchor build` currently **errors**
("does not contain this feature"), it does not build the mainnet branch.

Until this is fixed, there is no way to produce a mainnet binary at all,
regardless of what env vars or deploy flags you pass.

- **Where:** `programs/solana_smart_contracts/Cargo.toml` (`[features]`
  block, currently missing `mainnet-beta = []`) and
  `programs/solana_smart_contracts/src/constants.rs:3-9` (the `cfg` switch
  itself, which is otherwise correct).
- **Fix:** add `mainnet-beta = []` to `[features]`, then build with
  `--features mainnet-beta` and confirm via the compiled program (or a quick
  `cfg`-print) that the mainnet USDC mint (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`)
  actually got compiled in.
- Not applied yet — deliberately left alone per your call to defer this until
  mainnet planning actually starts.

---

## Marker comment index

Three annotation styles show up across this codebase, always meaning "the
owner left a note here, read it before touching this code":

| Marker | General meaning here |
|---|---|
| `// !` | A specific pre-deployment action item — usually "change X before mainnet" or a measured value worth remembering (e.g. a real CU consumption number). |
| `// *` | A warning about a dangerous operation or a precondition that must hold before calling a function — several are the *same* fee-recipient-ATA warning repeated at each place it matters. |
| `// ->` | Marks a TESTING-ONLY code path currently active, paired with the PRODUCTION path sitting right next to it, commented out. This is the biggest category, concentrated in `backend/src/workers/harvestWorker.ts`, `backend/src/services/baseService.ts`, and `base_smart_contracts/src/LordsPotBaseVault.sol`. |

File-level index — where each style actually appears (not line numbers,
since those drift; grep for the marker in-file when you get there):

| File | Markers present | Theme |
|---|---|---|
| `solana_smart_contracts/programs/solana_smart_contracts/src/lib.rs` | `// *` | Fee-recipient-ATA warnings on `initialize`, `migrate_state`, `set_relay_config`, and the `BuyTicket`/`Initialize` account structs. |
| `solana_smart_contracts/migrations/deploy.ts` | `// !` | Treasury-authority-must-change-before-mainnet; a recorded CU measurement. |
| `solana_smart_contracts/tests/buyTickets.ts` | `// !` | A recorded CU measurement (informational only). |
| `backend/src/workers/harvestWorker.ts` | `// ->`, plus a `=== TESTING ONLY ===` block header | The single largest concentration — see "Testing-only code paths" below. Nearly every `// ->` in the repo not on the Base contract itself is in this one file. |
| `backend/src/services/baseService.ts` | `// ->` | `tempProvider`/`tempURL` plus commented-out production `claimWinnings` signatures. |
| `backend/src/lib/config.ts` | `// ->` | `tempURL` field, paired with `baseService.ts` above. |
| `backend/src/services/megapotService.ts` | `// ->` | Hardcoded Megapot contract address instead of reading `config.base.megapotJackpotAddress`; a hardcoded jackpot-stats fallback with the real Dune-backed logic commented out beside it. |
| `backend/src/workers/baseConfirmer.ts` | `// !`, `// *`, `// ->` | Informational RPC-method labels and two type-mismatch notes — none are pre-mainnet action items, just left as reading aids. |
| `backend/src/routes/webhook.ts` | `// !` | Explains a BullMQ job-id constraint — informational, not an action item. |
| `base_smart_contracts/src/LordsPotBaseVault.sol` | `// ->` | The real single-argument `claimWinnings` (interface + implementation) is fully commented out; a 5-argument TESTING-shaped version matching `MockJackpot` is what's actually live. |

---

## 🔑 Key & authority separation

### Solana — already built, not yet exercised
The program already supports everything needed (`set_admin`,
`set_treasury_authority`, hot/cold split enforced on-chain). What's still
outstanding is *using* it for real before mainnet:

- [ ] `TREASURY_AUTHORITY` in `migrations/deploy.ts` currently defaults to
  the same key as admin/deployer (`// !` marked). Before mainnet this must
  become a real cold key (hardware wallet or Squads vault) — see
  `set_treasury_authority` above for the rotation call.
- [ ] The program's **upgrade authority** is currently whatever key signs
  deploys (`Anchor.toml`'s `wallet`, or your `deployer-keypair.json`) — no
  Squads multisig is wired in anywhere. Squads is free (open-source
  protocol, you only pay normal Solana network fees). Move it to Squads
  before mainnet: `solana program write-buffer` your built `.so` into a
  buffer keypair you keep, `solana program set-buffer-authority
  <BUFFER_ADDRESS> --new-buffer-authority <SQUADS_VAULT_ADDRESS>`, then
  propose/approve/execute the upgrade in the Squads UI (pointing at the
  Vault account address, not the multisig address itself). After this,
  `anchor program deploy` with your old keypair stops working — every future
  upgrade goes through that same write-buffer → Squads-UI flow, so it's
  worth rehearsing on devnet before you need it for real. This does NOT
  affect `state.admin`'s day-to-day signing (pause/resume/claim-signing
  stays a single hot key, unaffected by this change) — only who can replace
  the program's bytecode.
- [ ] `runbooks/deployment/signers.mainnet.tx` already has an `"authority"`
  signer template, but its `expected_address` line is commented out and it's
  typed as a plain `svm::web_wallet`, not a multisig signer. Fill this in
  once the Squads vault exists, so the runbook actually enforces the right
  key is used.

### Base — NOT yet built, this is new
Unlike Solana, **the Base vault has no hot/cold split at all today.**
`script/DeployVault.s.sol` derives both the vault's `Ownable` owner and the
`relayer` address from the exact same env var,
`RELAYER_BASE_SIGNER_PRIVATEKEY`:

```solidity
uint256 ownerPrivateKey = vm.envUint("RELAYER_BASE_SIGNER_PRIVATEKEY");
address owner = vm.addr(ownerPrivateKey);
uint256 relayerPrivateKey = vm.envUint("RELAYER_BASE_SIGNER_PRIVATEKEY");
address relayer = vm.addr(relayerPrivateKey);
```

That one key — which lives in the backend server and auto-signs
`buyTickets`/`claimWinnings` constantly — is *also* the `onlyOwner` for:

- `withdrawUsdc(address, uint256)` — can drain the entire vault to any address, uncapped
- `pause()` / `unPause()`
- `setVaultRelayer(address)` — can replace the relayer itself
- `setVaultMegapotAddress(address)` — can repoint the vault at an arbitrary contract (this exact function is what points it at `MockJackpot` during local testing)
- `setVaultUsdcAddress(address)`

This is the identical risk the Solana treasury split was built to close —
here it's still wide open. A compromised relayer key on Base doesn't just
let an attacker submit fake purchases; it hands over **total contract
control**, including redirecting the vault at a malicious "Megapot"
contract and then withdrawing everything.

- [ ] Before mainnet, transfer `LordsPotBaseVault`'s ownership (plain
  OpenZeppelin `Ownable.transferOwnership` — single-step, no accept phase,
  so double-check the destination address before calling it) to a Squads
  Safe or hardware wallet, separate from the relayer key.
- [ ] Update the deploy script so `owner` and `relayer` are no longer the
  same env var by construction — otherwise this will just quietly happen
  again on the next fresh deploy.
- [ ] Note the contract uses plain `Ownable`, not `Ownable2Step` — a typo'd
  `transferOwnership` address has no recovery path. Verify the destination
  extremely carefully, the same way `withdraw_vault_funds` above asks you
  to for Solana.

---

## 🧪 Testing-only code paths that must become production code

This is the part of the sweep with the most volume. Almost all of it is
already fenced with `// ->` markers saying exactly what to uncomment and
what to remove — this section is a map of *where those fences are*, not a
restatement of what's inside them (read the actual comments in each file
when you get there; they're more precise than a summary would be).

**`backend/src/workers/harvestWorker.ts`** — by far the largest block. It
contains an entire `=== TESTING ONLY ===`-fenced region (clearly marked at
both ends) covering:
- an import of `hacked_bytecode` from `backend/hacked_bytecode.ts` (used to
  inject fake bytecode via `anvil_setCode` on a local fork) — **this import
  is live at the top of the file even though its only use is inside the
  commented-out block below it.** If you ever delete
  `backend/hacked_bytecode.ts` as testing scaffolding, you must remove this
  import in the same change, or the build breaks.
- a `packTicketForTest()` helper fabricating winning-ticket data instead of
  reading it from a real Megapot response
- a commented-out real `bisectClaimable()` sitting beside the active
  testing version
- a commented-out real batch-claim submission path sitting beside the
  active testing one

**`backend/src/services/baseService.ts`** — `tempProvider`/`getTempProvider()`
(explicitly `// -> remove this in production`), plus commented-out
production-shaped `estimateClaimGas`/`submitClaimWinnings` sitting beside
the currently-active testing-shaped versions (5 arguments, matching
`MockJackpot`, instead of the real single-argument Megapot signature).

**`backend/src/lib/config.ts`** — the `tempURL` field
(`// -> remove this in production`), read from `BASE_RPC_URL`, paired with
`baseService.ts`'s `tempProvider` above. Worth noting while you're in this
file: the comment on `rpcUrl` says *"BASE_RPC_URL in production"*, but the
field is actually sourced from `BASE_SEPOLIA_RPC_URL` / `ANVIL_RPC_URL` —
`BASE_RPC_URL` is what feeds `tempURL` instead. Re-verify which env var
your production `.env` actually needs once `tempURL` is removed; the
comment and the code currently disagree with each other.

**`backend/src/services/megapotService.ts`** — the real Megapot Jackpot
contract address is hardcoded (`0x3bAe6430...`) instead of reading
`config.base.megapotJackpotAddress`, and paired with `getTempProvider()`
from the item above. Separately (different testing setup, not `// ->`
marked the same way): a jackpot-stats block has real Dune-API-backed logic
commented out, replaced with a hardcoded `jackpotsWon = 19` /
`prizesWon = BigInt(86000)` — the comment beside it explains this was to
avoid burning Dune API credits during development; needs the real logic
uncommented before mainnet.

**`base_smart_contracts/src/LordsPotBaseVault.sol`** — the interface and
implementation of `claimWinnings` both have the real single-argument
production version fully commented out, with a 5-argument testing version
(matching `test/mocks/MockJackpot.sol`'s simplified signature) actually
live. This is the contract-level counterpart to the `baseService.ts` item
above — they must be flipped together, or the backend and the deployed
contract will disagree about the function signature and every claim
harvest will fail to encode.

- [ ] Treat all of the above as one coordinated flip, not independent
  edits — the backend's `claimWinnings` call shape must match whatever the
  deployed Base vault actually expects, and the vault's real Megapot
  address must be a genuine mainnet Megapot deployment, not `MockJackpot`.
- [ ] `docs/testing-with-mock-jackpot.md` and the `MockJackpot.sol` header
  comment both already warn: never point the vault at `MockJackpot` on
  anything but a local fork. Confirm `setVaultMegapotAddress` on the
  mainnet vault has only ever been called with the real address (or never
  called at all, if it was set correctly at construction).

---

## 🌐 Network & address configuration

| What | Currently | Needs to become |
|---|---|---|
| Solana state's USDC mint | Devnet mint, hardcoded in `constants.rs` (see the build-blocking item above) | Mainnet mint, once the Cargo feature is fixed and built with it |
| `Anchor.toml` `[provider] cluster` | A devnet Helius URL **with a real API key committed in plaintext** | Your mainnet Helius (or other) RPC endpoint. Also worth rotating that devnet key at some point simply as good hygiene — it's sitting in git history regardless of what the file says today. |
| `frontend/src/solana/constants.ts` `HELIUS_RPC_URL` | Hardcodes the `devnet.` subdomain literally in the template string; only the API key comes from `VITE_HELIUS_API_KEY` | Edit the literal string, not just the env var — the env var alone won't switch clusters |
| `VITE_USDC_MINT` (Vercel env) | Devnet mint | Mainnet mint — flows correctly into every ATA derivation and the balance hook once changed (this part *is* just an env var, verified this session) |
| Base RPC | Sepolia (`BASE_SEPOLIA_RPC_URL` / `ANVIL_RPC_URL`) | Real Base mainnet RPC, plus decide the `BASE_RPC_URL`/`tempURL` naming confusion noted above before relying on it |
| `BASE_CHAIN_ID` | Sepolia (84532) in `.env.example` | 8453 (Base mainnet) |
| Megapot contract address (Base) | Sepolia test address in deploy scripts / hardcoded Sepolia address in `megapotService.ts` | Real mainnet Megapot Jackpot contract |
| USDC address (Base) | Sepolia USDC | Real mainnet Base USDC |
| Referrer wallet | Sepolia test wallet in deploy scripts (`BASE_REWARD_WALLET_ADDRESS`) | Your real mainnet referral wallet — this is the address that actually earns the 10% referral revenue the whole zero-fee strategy depends on. Get this one right. |
| Block explorer links | `frontend/src/pages/Tickets/Tickets.tsx` hardcodes `sepolia.basescan.org` | `basescan.org` (mainnet) |
| Solana explorer links | `?cluster=devnet` hardcoded in a couple of frontend links | Remove the cluster param (or set to mainnet-beta) |

---

## ⚙️ Values to re-check before flipping the switch

- [ ] **`max_claim_amount`** — still the placeholder $100,000 sizing from
  this session. Check Megapot's actual maximum realistic payout before
  mainnet and set this comfortably above it (see the `claim_winnings`
  section above for what happens when a real win exceeds it — it fails
  closed, blocking the claim until you raise it).
- [ ] **`HARD_MAX_TICKETS_PER_PURCHASE = 100`** (compiled into `lib.rs`) vs
  **on-chain `max_tickets_per_purchase = 65`** (set via `deploy.ts`,
  changeable without a redeploy). The 100 ceiling needs a program upgrade
  to ever change; the 65 doesn't. Don't confuse the two when someone asks
  "can we raise the ticket cap" — check which one they mean.
- [ ] **`referralSplit`** in `backend/src/lib/config.ts` is a hardcoded
  literal (`1000000000000000000`, i.e. 1e18/WAD-style — "you get 100% of
  the referral allocation Megapot offers"), **not read from an env var**,
  even though `.env.example` lists `REFERRAL_SPLIT` as if it were
  configurable. It isn't wired up. If you ever want this adjustable without
  a code change, that's a small fix; otherwise just know that env var is
  currently decorative.
- [ ] Relatedly: `backend/src/routes/quote.ts` (currently dormant, not
  mounted in `server.ts`) validates a *different* referral value —
  `10000` basis points — which is a different unit than the `1e18`
  actually sent on-chain. The two are never compared to each other in code
  today, so it's not an active bug, but if `quote.ts` ever gets wired up,
  fix this mismatch first or it'll reject/accept the wrong things.

---

## 📋 Loose ends worth a conscious decision (not urgent, but don't forget them)

- **`base_smart_contracts/MyHackedContract/` and `megapot-mock-server/` are
  their own nested git repos**, not real submodules (not listed in
  `.gitmodules`). A fresh clone of this repo will NOT bring them along.
  `backend/scripts/decode_revert.ts` imports a build artifact from
  `MyHackedContract/out/`, and `harvestWorker.ts`'s testing block references
  `megapot-mock-server`'s existence indirectly via the local-mock URLs
  (currently commented out). Decide before mainnet whether these need to
  become real submodules, get folded in properly, or get removed entirely
  once the testing scaffolding they support is gone.
- **`git status` shows an uncommitted change to
  `base_smart_contracts/MyHackedContract`** — it's a nested repo, so this
  is just its own dirty state, not something this repo's git tracks
  directly. Worth resolving so it's not a permanent "m" in every future
  `git status`.

---

## ✅ Final smoke-test sequence before real traffic

Do this on devnet first, as a full sequence (not instructions tested in
isolation), then repeat once for real on mainnet with small amounts before
any public announcement:

1. Deploy → `initialize` (or `migrate_state` + `set_treasury_authority`
   bootstrap, if upgrading an existing account) → confirm every state field
   via `anchor run view-state`.
2. `buy_ticket` — 1 ticket, then a size larger than
   `max_tickets_per_purchase` so it forces multiple Solana transactions
   behind one wallet approval. Check the frontend Tickets page renders it
   correctly: ONE Solana signature per transaction, with that transaction's
   several Base relay batches nested underneath it — not one row per Base
   batch repeating the same Solana hash.
3. `pause_protocol` → `update_epoch` → `resume_protocol`.
4. A real `claim_winnings` voucher end to end (settlement → harvest →
   voucher → user co-sign → payout confirmer discovering it on-chain).
5. `withdraw_vault_funds`, signed by the real treasury key — this is your
   proof the cold key actually works before you need it in an emergency.
6. Confirm the backend's admin signing key matches on-chain `state.admin`
   exactly, and the Base relayer key matches whatever `setVaultRelayer`
   last set — a mismatch here fails silently until someone notices claims
   or purchases have stopped.

