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

Detection is separate: `pnpm test:flake` runs the suite N times and classifies each
test as deterministic, flaky, or clean, so a race is *found* rather than absorbed.
Known flakes are listed in `.github/flake-quarantine.yml` with an expiry date.

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