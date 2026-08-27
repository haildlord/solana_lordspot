# Setup, testing, and publishing

For the SDK maintainer (you) — not for integrators. Integrators only need
[README.md](./README.md).

---

## Stage 1 — Use it locally, WITHOUT publishing anything

Do this first. You do not need npm, an account, or a package name to try the SDK
end to end. Nothing here is public or undoable.

```bash
cd sdk
npm install
npm test      # 41 tests — must be green
npm run build
```

### Try it against devnet

The SDK talks to whichever host is baked into `src/config.ts` for `devnet` —
the deployed devnet API, not localhost. Nothing needs to be running locally:

```bash
cd sdk
AGENT_PRIVATE_KEY=<base58-secret-key> npx tsx examples/agent.ts
```

That buys 3 tickets, lists your tickets with draw results, and claims anything
claimable — the full lifecycle.

> The key is read from an environment variable, never written to a file and
> never logged. Use a devnet wallet, not one holding anything real.

### Use it from another local project

To integrate it into a separate app on your machine without publishing:

```bash
cd sdk && npm run build && npm link      # register locally
cd ../my-other-project && npm link @lordspot/sdk
```

Or install the built tarball directly, which is closer to what a real consumer
gets:

```bash
cd sdk && npm pack                       # produces lordspot-sdk-0.1.0-alpha.0.tgz
cd ../my-other-project
npm install ../solana_lordspot/sdk/lordspot-sdk-0.1.0-alpha.0.tgz
```

**Prefer `npm pack` for a final check.** `npm link` symlinks the whole folder, so
it can hide packaging mistakes — a missing file in `dist/` still resolves from
source. The tarball is exactly what npm would publish.

---

## Stage 2 — Before publishing anything

### The API host is baked in, and guarded

`src/config.ts` holds one API host per network, and there is **no runtime
override** — `apiUrl` was deliberately removed from `createLordsPot()`. A caller
who could redirect the API host could point claim-voucher requests at a server
of their choosing; `verifyVoucher` would still refuse to sign anything
malicious, but they could deny service and learn which wallets you query.

The host itself is **not a secret** — every integrator's traffic reaches it and
the web app calls it from browsers. It is baked in for integrity, not secrecy.

`npm run guard:hosts` fails if `localhost`, `127.0.0.1`, or a `__SET_`
placeholder survives into `dist/`, and it runs as part of `prepublishOnly`, so a
localhost build physically cannot be published. To develop against a local
backend, edit `src/config.ts` temporarily and **never commit that edit**.

### Decide the package name

`@lordspot/sdk` is a scoped name and requires an npm **organisation** called
`lordspot`. Either:

- create the org (free for public packages) at npmjs.com, **or**
- rename to an unscoped name you own, e.g. `lordspot-sdk`.

Scoped packages are private by default, so publishing a public one needs
`--access public` (already handled in the command below).

### Turn on 2FA

For a package that signs money-moving transactions, this is not optional.
Enable two-factor auth on your npm account, set to require it for publishing.
If your npm token leaks without 2FA, an attacker publishes a malicious version
and every integrator pulls it on their next install.

---

## Stage 3 — Publish

```bash
cd sdk
npm login
npm publish --access public --tag alpha
```

`prepublishOnly` runs the full test suite and a clean build first, so a broken
verifier physically cannot be published.

`--tag alpha` matters: it publishes without moving the `latest` tag, so
`npm install @lordspot/sdk` does **not** pick this up by default. Testers opt in
explicitly:

```bash
npm install @lordspot/sdk@alpha
```

When it's genuinely ready:

```bash
npm version 1.0.0
npm publish --access public       # no tag → becomes `latest`
```

### Provenance — blocked while the repo is private

Publishing from GitHub Actions with `--provenance` attaches a signed attestation
that the tarball was built from a specific commit, so integrators can verify the
published code matches the source. For a library that signs money-moving
transactions, that is worth real effort.

**It requires a PUBLIC source repository.** `haildlord/solana_lordspot` is
currently private, so provenance is unavailable today. Two ways forward:

- Make the monorepo public — unlikely, it holds the backend and deployment docs.
- **Split the SDK into its own public repo.** This is the better option anyway:
  integrators can read exactly what they are asked to trust, `verifyVoucher.ts`
  becomes publicly auditable, and provenance works. The SDK has no dependency on
  the rest of the monorepo.

Until then, `repository` is deliberately omitted from `package.json` — pointing
npm at a private repo puts a 404 link on the package page.

---

## Verify what actually ships

```bash
npm pack --dry-run
```

Should list **only** `dist/*.js`, `dist/*.d.ts`, `README.md`, `package.json`.

If you ever see `src/`, `*.test.*`, `examples/`, `.env`, or anything key-shaped,
**stop and fix `.npmignore` before publishing.** Published versions cannot be
meaningfully unpublished — npm blocks re-publishing the same version number, and
anything leaked is public permanently.

---

## Releasing an update

1. `npm test` — green
2. `npm version patch|minor|major`
3. `npm publish --access public`
4. `git push --follow-tags`

**Semver, interpreted for this SDK:**
- **patch** — bug fix, no API change
- **minor** — new method or field, existing code unaffected
- **major** — anything that breaks existing integrations, including *tightening*
  a verifier check. A stricter check is a breaking change even though it's a
  security improvement, because it can reject vouchers that previously worked.

---

## Mainnet readiness

`network: 'mainnet'` currently throws by design — the program isn't deployed
there, and shipping a placeholder address risks it later being mistaken for a
real one.

When mainnet is live, add its entry to `NETWORKS` in `src/config.ts`. That is
the only file that changes:

```ts
mainnet: {
  programId:     new PublicKey('<deployed mainnet program id>'),
  usdcMint:      new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  apiUrl:        'https://<your mainnet api host>',
  genesisHash:   '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  defaultRpcUrl: 'https://api.mainnet-beta.solana.com',
},
```

The mainnet genesis hash above is verified. `defaultRpcUrl` should be a paid
endpoint in practice — the public one rate-limits hard.

**Do not ship a mainnet build until the wider mainnet checklist in
`solana_smart_contracts/OPERATIONS.md` is done.** The SDK working is necessary
but not sufficient; that checklist covers the deployment and key-custody work
that has to happen first.

---

## Supply chain

Third-party packages are the most common cause of wallet drains in this
ecosystem, so the dependency set is deliberately tiny and worth re-checking
before every release.

### The SDK ships ZERO bundled dependencies

`dependencies` is empty. `@solana/web3.js` and `@solana/spl-token` are
**peerDependencies**, meaning the consumer installs and controls them. The SDK
cannot drag in a compromised transitive package of its own, and a consumer who
pins or patches those libraries keeps that control.

### The @solana/web3.js incident — why the peer range starts at 1.95.8

In December 2024, `@solana/web3.js` **1.95.6** and **1.95.7** were published
with a backdoor that exfiltrated private keys. Both were unpublished from npm
(verifiable: 1.95.5 and 1.95.8 resolve, those two do not).

The peer range is therefore `^1.95.8`, not `^1.95.0` — a `^1.95.0` range
*semantically permits* the two compromised versions, and while npm can no
longer serve them, a stale local cache, a lockfile written before the pull, or
a private registry mirror still could. Do not widen this range.

**Before each release:** check whether any newer `@solana/web3.js` has been
flagged, and raise the floor if so.

### `bigint-buffer` — a known advisory with no fix, and why it is accepted

`npm audit` reports a **high** severity buffer-overflow in `bigint-buffer`
([GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg)),
reached transitively through the Solana packages.

Facts, so this isn't rediscovered every release:

- Its vulnerable range is `*` — **every published version**. There is no patched
  release to upgrade to.
- npm's suggested "fix" is downgrading `@solana/spl-token` to `0.1.8`, a
  semver-major **downgrade** to an ancient version. Do not do this.
- It affects essentially every Solana project; it is not specific to LordsPot.
- **This SDK's exposure is minimal**: the overflow is in `toBigIntLE()`, and we
  never call it. Every `u64` here is decoded with Node's native
  `readBigUInt64LE` (`src/protocol.ts`, `src/verifyVoucher.ts`), and the only
  `@solana/spl-token` imports are `getAssociatedTokenAddressSync` (pure address
  derivation) plus two program-id constants. No account-decoding function —
  `unpackAccount`, `getAccount`, `unpackMint` — is ever called, so
  attacker-controlled bytes are never handed to a vulnerable decoder.

Re-evaluate if a patched `bigint-buffer` ships, or if the SDK ever starts
decoding token accounts directly.

### The other advisories, and how to re-verify all of this

`npm audit` currently reports 8 findings (5 moderate, 3 high) — `bigint-buffer`,
`uuid` (missing buffer bounds check in v3/v5/v6), `jayson`, and several
`@solana/*` packages carrying those transitively. **`npm audit --omit=dev`
reports 0**, because `dependencies` is empty; every one of these arrives through
the peer packages a consumer installs themselves, and affects any Solana project
equally.

What actually bounds the exposure is that the SDK never calls the vulnerable
code. Re-verify that claim mechanically rather than trusting this paragraph —
run it against `dist/` before each release:

```bash
cd dist && grep -ohE 'require\("[^"]+"\)' *.js | grep -v '"\./' | sort -u
cd dist && for f in toBigIntLE toBufferLE unpackAccount unpackMint; do echo "$f: $(grep -ohE "\b$f\b" *.js | wc -l)"; done
```

Expected: exactly two external requires (`@solana/web3.js`, `@solana/spl-token`),
and **zero** occurrences of all four functions. The only `@solana/spl-token`
symbols used are `getAssociatedTokenAddressSync` plus two program-id constants —
pure address derivation, no attacker-controlled bytes reaching a decoder.

If either command starts producing different output, re-do the exposure analysis
before publishing.

### Checks to run before publishing

```bash
npm audit                 # review; understand each finding rather than auto-fixing
npm audit --omit=dev      # note: reports 0 because `dependencies` is empty —
                          # it does NOT cover the peer deps a consumer installs
npm pack --dry-run        # confirm no keys, tests, or examples ship
```

Never run `npm audit fix --force` here. It resolves advisories by making
semver-major changes — including the `spl-token` downgrade above — and can
silently swap the libraries that sign transactions.

---

## Test suite

```bash
npm test
```

41 tests. The 13 voucher-attack cases in `src/verifyVoucher.test.ts` are
**release blockers** — each simulates a malicious voucher a compromised API
might return and asserts the SDK refuses to sign it.

If one of those starts failing, do not publish. A regression there means a
partner's users can be drained.

### Also run the live check — the unit tests have a blind spot

The unit tests build vouchers from synthetic fixtures. They prove the verifier
rejects malicious *shapes*. They cannot prove it **accepts what the real backend
actually issues** — a verifier that rejected everything would pass all 41 tests
and be useless in production.

```bash
AGENT_PRIVATE_KEY=<devnet-base58> node scripts/verify-against-live-api.js
```

Needs a devnet wallet **with claimable winnings** (it refuses to run otherwise,
rather than passing vacuously). It asserts an over-claim is stopped at three
independent layers — backend ignores an injected amount, SDK refuses tampered
vouchers, chain rejects them anyway — and checks a genuine voucher still
verifies. It requests one real voucher and deliberately never submits it, so the
voucher expires and the bound tickets are released automatically. No funds move.

Exit code is non-zero if any layer fails. Run it before every release.
