# Security policy

This package builds and signs Solana transactions that move real funds. Please
treat security reports here as high priority — they will be.

## Reporting a vulnerability

**Do not open a public issue for a security problem.** A public report tells
everyone else how to exploit it before there is a fix.

Use GitHub's private vulnerability reporting instead:

1. Go to the **Security** tab of this repository
2. Click **Report a vulnerability**

That opens a private channel visible only to the maintainers. If the Security tab
is not available to you, open a normal issue saying only *"I have a security
report, please enable private reporting"* — with **no details** — and wait to be
contacted.

Please include, as far as you can: what an attacker gains, the steps to
reproduce, and which version you tested.

## What is in scope

The SDK's job is to refuse to sign anything that is not a plain, expected
transaction. Anything that defeats that is in scope:

- A claim voucher shape that `verifyClaimVoucher` **accepts** but should reject
  — a smuggled instruction, a redirected payout account, an inflated amount, an
  unexpected signer, a substituted fee payer
- Any path where a secret key could be logged, transmitted, persisted, or handed
  to a third party
- Ticket encoding that produces a transaction meaningfully different from the
  one the caller asked for
- A way to make the SDK talk to a different program, mint, cluster, or API host
  than the network it was constructed with

## What is out of scope

- **A compromised LordsPot admin key.** That key co-signs claim vouchers by
  design. An attacker holding it can produce correctly-shaped, correctly-signed
  vouchers that pass every check here, bounded only by the on-chain
  `max_claim_amount`. That is the definition of the key's authority, not a flaw
  in this SDK.
- Vulnerabilities in `@solana/web3.js` or `@solana/spl-token` — report those to
  their maintainers. Do tell us if this SDK *reaches* a vulnerable code path,
  because that part is ours to fix.
- Denial of service against the LordsPot API. Not nothing, but not a wallet
  risk, and not fixable in a client library.

## Supported versions

Only the most recently published version receives security fixes. While the
package is `0.x-alpha`, expect fixes as new versions rather than backports.

## A note on the trust boundary

Voucher verification protects an integrator against a **compromised LordsPot
API** returning a malicious transaction to sign. It does not, and cannot, protect
against a compromised LordsPot **signing key**.

Using this SDK means trusting LordsPot's key custody — not merely its server.
That distinction is deliberate, and stated here so nobody has to infer it.
