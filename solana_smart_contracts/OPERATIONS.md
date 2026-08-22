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
  from admin, ideally a hardware wallet or Squads vault (see the Mainnet
  Checklist at the bottom). Passing the same wallet as both is allowed by
  the program but defeats the entire point of the split.
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
  (See the "Sizing max_claim_amount" note below.)
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

