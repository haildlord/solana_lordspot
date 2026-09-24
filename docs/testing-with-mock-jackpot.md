# Testing harvest/claim locally without waiting on real Megapot drawings

## The problem

Your mock epoch API fast-forwards a new "drawing" every 5 minutes so you can
test quickly. But your Anvil fork is a snapshot of the *real* Megapot
contract on Base mainnet, which is only actually at drawing ~125-ish in real
life. The moment your mock API says "drawing 162 happened," the real Megapot
contract on your fork has no idea what you're talking about — as far as it's
concerned, drawing 162 is still in the future. So `claimWinnings` always
reverts with `TicketFromFutureDrawing()`, no matter how "fresh" you make the
fork — restarting Anvil doesn't help, because real mainnet won't actually
reach drawing 162 for a long time.

## The fix: swap in a fake Megapot contract, just for testing

`MockJackpot.sol` (`base_smart_contracts/test/mocks/MockJackpot.sol`) is a
tiny stand-in contract with no concept of drawings or timing at all — every
claim just succeeds and pays out a flat test amount (5 USDC per ticket).
Point your vault at it instead of the real Megapot address, and the entire
buy → settle → harvest → claim → payout loop can be tested as fast as you
want, completely independent of what real mainnet is doing.

## Important: restarting Anvil with a fresh fork wipes your vault too

A plain `anvil --fork-url ...` restart gives you a blank local chain (plus
whatever real contracts exist on mainnet, like the real Megapot and USDC).
Anything **you** deployed locally on the previous Anvil session — including
`LordsPotBaseVault` itself, not just the mock — is gone. So after a fresh
restart, redeploy the vault first:

```bash
forge script script/DeployVault.s.sol --broadcast --rpc-url http://localhost:8545
```

Copy the new vault address into `LORDSPOT_BASE_VAULT` in `backend/.env`, and
restart the backend so it picks it up. *Then* do the mock setup below.

### Avoid this entirely: give Anvil a state file

Instead of a plain fork restart, run Anvil with `--state`:

```bash
anvil --fork-url https://base-mainnet.g.alchemy.com/v2/YOUR_KEY --state ./anvil-state.json
```

Deploy the vault + mock once. From then on, restarting Anvil with that same
`--state ./anvil-state.json` flag reloads everything exactly as you left
it — vault, mock, funding, all of it. No redeploying, ever, unless you
delete that file on purpose for a truly clean slate.

## One-time setup, every time you (re)deploy the mock

Run these from `base_smart_contracts/`, with Anvil already running and the
vault deployed:

```bash
forge build
forge script script/DeployMockJackpot.s.sol --broadcast --rpc-url http://localhost:8545
```

This prints the deployed mock's address, something like:

```
MockJackpot address:  0xSOME_ADDRESS_HERE
```

The vault is now pointed at it — copy that address for the next step.

### Fund the mock with test USDC

The mock starts with 0 USDC, so it can't pay out yet. This writes a large
test balance directly into it (only works on a local Anvil fork — it's
Anvil's own storage-editing feature, not a real transaction):

```bash
MOCK=0xSOME_ADDRESS_HERE   # paste the address the deploy script printed

cast rpc anvil_setStorageAt \
  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  $(cast index address $MOCK 9) \
  0x000000000000000000000000000000000000000000000000000009184e72a000 \
  --rpc-url http://localhost:8545
```

That gives the mock 10,000,000 USDC to pay out with (plenty for a lot of
testing — at 5 USDC/ticket that's 2 million claims). Verify it landed:

```bash
cast call 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  "balanceOf(address)(uint256)" $MOCK --rpc-url http://localhost:8545
```

That's it — buy tickets, let your mock epoch API roll forward, and harvest
will now actually succeed and move money for real (on your local fork).

## Going back to the real Megapot contract

When you want to test against the real one again:

```bash
forge script script/RestoreRealJackpot.s.sol --broadcast --rpc-url http://localhost:8545
```

## Restarting your test loop (buying the same tickets again)

Wipe Postgres + flush Redis as usual — you do **not** need to redeploy the
mock or restart Anvil again unless you actually restart Anvil itself. The
mock contract and its funding stay in place across backend restarts, since
they live on the (still-running) Anvil chain, not in your database.
