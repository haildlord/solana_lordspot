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

Make sure the backend is running (`npm run dev` in `backend/`), then:

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

### Fix the API URL first

`src/config.ts` still points devnet at `http://localhost:3000`
(marked `TODO(mainnet-launch)`). **Published as-is, the SDK works only on your
machine.** Replace it with your deployed devnet API host before anyone else
installs it.

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

### Recommended: publish with provenance

If the repo is on GitHub, publishing from GitHub Actions with `--provenance`
attaches a signed attestation that the tarball was built from a specific public
commit. Integrators can then verify the published code matches the source. For a
signing library, that's worth the setup.

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

## Test suite

```bash
npm test
```

41 tests. The 13 voucher-attack cases in `src/verifyVoucher.test.ts` are
**release blockers** — each simulates a malicious voucher a compromised API
might return and asserts the SDK refuses to sign it.

If one of those starts failing, do not publish. A regression there means a
partner's users can be drained.
