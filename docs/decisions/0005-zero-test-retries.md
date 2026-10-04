# 0005 — Keep `retries: 0` on the E2E suite

**Status:** accepted · **Date:** 2026-09-27 (revisited 2026-10-02)

## Context

The Playwright suite runs serially against a real Chromium with the extension
loaded. v1.6.0 failed to publish from this commit:

```
CI:      25b503be…  success
Publish: 25b503be…  failure
```

Identical SHA. One browser tab event timed out on one runner and not the other.

## Decision

**`retries: 0`, permanently.** A retry hides a flake rather than fixing it.

Detection was a separate concern: a `pnpm test:flake` script ran the suite N
times and classified each test as deterministic, flaky, or clean, with known
flakes listed in `.github/flake-quarantine.yml` and an expiry date.

> **Amended 2026-10-04.** The `retries: 0` decision stands unchanged. The
> detection tooling above was **removed** in `da99e91` — the flake gate and the
> quarantine file no longer exist, and `pnpm test:flake` is not a script. That
> change is recorded in [0006](0006-e2e-only-what-needs-a-browser.md), which cut
> the suite from 153 tests to 31; with far less surface to race on, the gate was
> judged not worth its upkeep. Until detection exists again, the only honest
> reading of this ADR is: no retries, and a flake will surface as a red build
> rather than as a found-and-filed bug.

## Alternatives considered

**`retries: 2`.** The suite goes green. The race stays in the code, and the next
person to touch it inherits something invisible.

**Skip E2E on release tags.** A tag is exactly when you want the most signal.

## Consequences

Every release is a coin flip unless flakes are actively hunted. That is the
deliberate trade: a caught bug costs one release, an absorbed race costs a
mysterious bug report months later.

## Revisit when

Never — unless the suite stops being race-prone, at which point the flake gate
becomes unnecessary and the whole arrangement can be simplified.

Note that the gate it refers to no longer exists. With `retries: 0` and no
detection, the practical consequence is that a flake is now *found* by CI rather
than *absorbed* — which satisfies the intent of this decision, just with the cost
landing on whoever is watching. Restoring detection is a separate change.