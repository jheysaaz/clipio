# Wave 4 — test the modules the test suite mocks away

## Problem

One foundational module has **no tests at all**, and it is the module every other test mocks or
stubs out. That combination is the worst kind of gap: the code is load-bearing, and the suite is
structurally incapable of noticing a bug in it.

### `src/storage/items.ts` — 295 lines, zero tests

Every storage item the extension has is declared here. It is the single source of truth for
storage **keys** and **default values**, and it is `vi.mock`ed in at least three test files
(`debug.test.ts`, `giphy.test.ts`, `preview-privacy.test.ts`) and stubbed inline in more.

So a typo in a key, or a wrong default, is invisible. There is no test that would fail if:

- a key string were changed (`"local:themeMode"` → `"local:themeMod"`), silently orphaning
  every user's saved theme;
- a `defaultValue` were changed (`storageModeItem` `"sync"` → `"local"`, which would flip
  every fresh install to the local backend and make sync appear broken);
- two items were declared with the same key, so one silently shadows the other and the second
  is dead.

None of these are hypothetical style concerns. They are the exact class of bug that produces
"my settings disappeared after the update" reports, and the module that would be responsible
has no test.

### `src/lib/sentry-content.ts` — 156 lines, zero tests

Globally mocked away in `tests/setup.ts`, so it is never exercised. It is the code that decides
**what snippet content is allowed into Sentry**. A regression here is a privacy regression: too
permissive and a user's snippet body — which may contain a pasted password or a customer name —
is shipped to a third party.

## Solution

Test both modules directly, against their real behaviour, with the properties that actually
matter:

- **`items.ts`** — every item's **key** and **default value** are contract. Assert the exact
  key strings (a typo is a data-loss bug), assert the defaults, and assert that **no two items
  share a key or an effective key** (shadowing would make one silently dead).
- **`sentry-content.ts`** — assert the redaction boundary in both directions: content that
  must be stripped is stripped, and content that must be preserved is preserved. Include the
  negative cases, because "strip everything" would pass a naive test while destroying the
  debuggability the function exists to provide.

## Acceptance Criteria

- [x] `src/storage/items.ts` has a test file that imports the real module (not a mock).
- [x] Every declared item's key string is asserted, so renaming a key fails the suite.
- [x] Every declared item's default value is asserted.
- [x] A test fails if two items resolve to the same storage key.
- [x] The `sentry-scrub.ts` redaction boundary is confirmed covered in both directions. It
      already is (66 tests); this criterion records that the check was actually run rather than
      assumed, because this wave's original premise was that privacy coverage was missing.
      Verified: explicit "preserves non-sensitive keys" tests exist, and deleting `"content"`
      from the redaction list fails 3 tests.
- [ ] Redaction is asserted in both directions, including the negative cases.
- [x] Each new test is mutation-sensitive: breaking a key, a default, or a redaction rule makes
      the suite fail. Verified, not assumed. Four mutations run against `items.ts`, each caught by
      2–3 tests: renaming `local:themeMode`, flipping the `storageMode` default to `"local"`,
      dropping the `blockedSites` default, and pointing `legacyThemeItem` at a duplicate key.
- [x] `pnpm test:coverage` still exits 0.

## Edge Cases

- **The two storage items that intentionally share a name.** `localSnippetsItem` and
  `cachedSnippetsItem` both hold `Snippet[]` but must have _different_ keys — that difference is
  the entire point of the cache. A duplicate-key test must not simply assert "all unique"
  without checking this pair is genuinely distinct, or it would be asserting a property the
  design depends on without naming it.
- **`storageModeItem`'s default is load-bearing.** `"sync"` is not an arbitrary default: it is
  what makes a fresh install sync by default. This is asserted explicitly with a comment saying
  why, so a well-meaning "simplify the default" change fails loudly.
- **A redactor that strips everything passes a one-directional test.** Every redaction test
  therefore has a paired assertion that ordinary content survives.

## Non-Goals

- Testing WXT's `defineItem` itself. That is the framework's job. These tests assert _our_
  keys and defaults, not WXT's behaviour.
- Migrating off `vi.mock("../items")` in other suites. Mocking the items module is legitimate
  for testing consumers; the gap is that nothing tests the module itself.
- Wave 4.2, the write-only `latestVersionCheckedAtItem`. Tracked separately below because it is
  a behavioural question (implement the cache, or delete the dead write) rather than a test gap.

## Wave 4.2 — the update checker has no throttle, though it records one

Surfaced while verifying this wave. A real defect, not a test gap.

`checkForUpdate()` **writes** `latestVersionCheckedAtItem` on every check and **never reads
it** — verified by grep: every reference is a `setValue`. The item is dead state.

Meanwhile `background.ts` calls `checkForUpdate()` in two places:

- at the **top level of the service worker** (`:158`), so on _every_ wake-up, and
- on a 6-hour alarm (`:166`).

An MV3 service worker is evicted after roughly 30 seconds idle, so "every wake-up" is frequent
in practice — many times a day for an idle extension. Every one of those is an unconditional
`fetch` to the GitHub releases API. Unauthenticated GitHub API requests are rate limited per
IP, and the failure mode compounds: a `403` is an `!response.ok`, so it throws into the `catch`,
which does **not** write the timestamp — so a rate-limited client keeps retrying and makes the
rate limit worse. That is the fetch storm the timestamp was evidently introduced to prevent.

`specs/update-checker.spec.md` already claims a 24-hour cache, so the implementation is the
thing that is wrong, not the spec.

### Solution

Read the timestamp and skip the network call when the last check was recent enough. Pure
decision in a separately testable helper, so the time arithmetic is verifiable without mocking
a clock into the fetch path.

- `shouldCheckForUpdate(lastCheckedAt, now)` — pure. `true` when there is no timestamp, when the
  timestamp is unparseable (fail open: a corrupt value must not disable updates forever), or
  when more than 24 hours have elapsed.
- `checkForUpdate()` consults it before fetching.
- The `catch` writes the timestamp too, so a failing endpoint is backed off instead of retried on
  every wake. **Stated trade-off:** a failed check now delays the next attempt by up to 24 hours.
  That is the right way round — an update check arriving a day late is harmless, whereas a
  rate-limited client that keeps hammering the API never recovers.

### Acceptance Criteria

- [x] A check is skipped when the previous check was less than 24 hours ago, and **no fetch is
      made** (assert fetch was not called, not merely that nothing was stored).
- [x] A check proceeds when there is no timestamp.
- [x] A check proceeds when the timestamp is unparseable or in the future (fail open).
- [x] A check proceeds once more than 24 hours have elapsed.
- [x] A thrown fetch records the timestamp, so a failing endpoint is backed off.
- [x] The throttle window is a named constant (`UPDATE_CHECK_MIN_INTERVAL_HOURS`), not a magic number at the call site.
- [x] `specs/update-checker.spec.md` matches the implementation.
- [x] Each new test is mutation-sensitive. Four mutations run, each caught by 3–4 tests:
      shrinking the window to ~0, failing _closed_ on an unparseable timestamp, deleting the
      failure-path timestamp write, and disabling the throttle call.

## Change History

| Date       | Change                                                                                                                                                                                | Author |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2026-09-27 | Initial spec                                                                                                                                                                          | —      |
| 2026-09-27 | `items.ts` tested. The wave's premise about `sentry-content.ts` was investigated and **rejected** on evidence: the redaction boundary is `sentry-scrub.ts`, which is already covered. | —      |
