# 0006 — Reserve E2E for what actually needs a browser

**Status:** accepted · **Date:** 2026-10-03

## Context

The Playwright suite had reached **153 tests and ~7 minutes**. Most of it was not
testing anything a browser is required for. A drift check found the shape of it:

- `options.spec.ts` re-proved font, theme and confetti rules that
  `ui-font.test.ts` already covered in 12 unit tests.
- Its review-banner tests duplicated `review-prompt.test.ts`, which already had
  37 tests covering the identical logic.
- Its update-banner tests duplicated 70 tests in `update-checker.test.ts`.
- Export/import was driven through the options page when both halves are pure
  functions with unit tests already.
- `blocked-sites.spec.ts` asserted hostname matching — pure string work.

Meanwhile the tests that *did* need a browser were mixed in with them, so the
signal was diluted in both directions.

## Decision

**An E2E test must fail in a real browser and pass in happy-dom.** Anything else
belongs in a unit test, however it was written.

The 153 were classified one by one. **31 kept, ~85 moved to unit tests, ~44
deleted** for asserting nothing valuable (axe scans, which run fine in jsdom;
a test that checked an HTML file had inputs; a heading-uniqueness assertion).

What genuinely needs a browser, and why:

| Kept | Why a browser is required |
|---|---|
| 12 × insert/expand | The content script must be injected by the extension into a real page. Injection wiring, debounce timing, and caret position against real layout. |
| 4 × CRUD + reload | `storage.sync` behaviour under a real extension origin. |
| 3 × survives restart | Service worker lifecycle and storage durability across a browser restart. |
| 5 × messaging relay | `runtime.sendMessage` between genuinely separate JS contexts. |

**Result at the time: 153 → 31 tests, ~7 min → ~52 s**, with the unit suite
absorbing the moved work and staying under 10 s.

## Amendment (2026-11-27)

A later pruning commit (`a8fe027`) cut the suite again for runtime, taking it to
**30 tests across 8 spec files**. The boundary above is unchanged: the remaining
tests still need a real browser (injection, storage durability, cross-context
messaging, popup/options rendering). The current count is the one to measure
drift against; the 31 in the original decision is historical.

## Alternatives considered

**Keep them all, just accept 7 minutes.** The suite was already the slowest gate
by an order of magnitude, and most of the cost bought nothing. E2E minutes are
the scarcest resource in the repo because they are also the least likely to be
re-run by hand before a commit.

**Delete the duplicated E2E tests without writing unit tests first.** Rejected:
the coverage would have gone to zero and the logic would have become untested
rather than cheaper to test.

## Consequences

A behaviour change that only shows up in a real page context — caret placement,
injection timing, cross-context messaging — has no cheap guard and must be
checked by running `pnpm test:e2e`. That is the trade this decision makes, and
it is why `AGENTS.md` requires `pnpm test:e2e` before anything that touches
visible copy or a component's DOM.

## Revisit when

A test category grows past ~15 E2E tests without a stated browser requirement.
That is the signal this boundary is being eroded.