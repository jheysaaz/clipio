# TEST_AUDIT.md — Full Test Suite Audit

> **Read-only audit.** Produced before any remediation. Every flag cites `file:line`.
> Follow-up remediation is tracked in [MANDATORY TASKS](#mandatory-tasks-16--remediation-plan) below.

**Audit date:** 2026-09-23 · **Commit base:** `24d23ed` (plus uncommitted working tree) · **Version:** 1.5.1

---

## PART 1 — Inventory

### 1.1 Tooling

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| Unit | Vitest | 4.1.10 | `environment: happy-dom`, global setup `tests/setup.ts` (mocks `browser` + `wxt/utils/storage`) |
| DOM shim | happy-dom | 20.10.6 | Provides `DOMParser`, `document` |
| IDB shim | fake-indexeddb | 6.2.5 | Storage backend tests |
| E2E | Playwright | 1.61.1 | `workers: 1`, `retries: 1` in CI, `globalSetup` runs `pnpm build` |
| A11y (E2E) | @axe-core/playwright | 4.12.1 | **API: `AxeBuilder` class only** — old `injectAxe`/`checkA11y` removed |
| Coverage | @vitest/coverage-v8 | 4.1.10 | Thresholds global 80/80/75/80; per-module 85–95 |
| Not present | @testing-library/react, MSW, snapshot matchers | — | No `toMatchSnapshot` anywhere; no HTTP mock server |

### 1.2 Test files (44 total)

**Unit — 35 files, 917 tests** (colocated `*.test.ts(x)` under `src/`):

| File | Tests | Lines |
|------|------:|------:|
| `src/components/editor/serialization.test.ts` | 98 | 800 |
| `src/lib/content-helpers.test.ts` | 66 | 627 |
| `src/storage/backends/media.test.ts` | 48 | 843 |
| `src/lib/markdown.test.ts` | 59 | 380 |
| `src/lib/giphy.test.ts` | 39 | 497 |
| `src/storage/manager.test.ts` | 36 | 612 |
| `src/lib/exporters/clipio.test.ts` | 35 | 338 |
| `src/pages/Dashboard.accessibility.test.ts` | 35 | 301 |
| `src/utils/dateUtils.test.ts` | 35 | 213 |
| `src/lib/importers/clipio.test.ts` | 32 | 359 |
| `src/lib/preview-helpers.test.ts` | 31 | 418 |
| `src/lib/importers/textblaze.test.ts` | 30 | 320 |
| `src/lib/content-security-regression.test.ts` | 30 | 343 |
| `src/lib/importers/powertext.test.ts` | 29 | 177 |
| `src/lib/update-checker.test.ts` | 28 | 333 |
| `src/lib/review-prompt.test.ts` | 33 | 467 |
| `src/lib/importers/detect.test.ts` | 24 | 144 |
| `src/lib/dom-text-range.test.ts` | 18 | 251 |
| `src/lib/snippetUtils.test.ts` | 18 | 180 |
| `src/lib/sentry-scrub.test.ts` | 17 | 207 |
| `src/lib/copyMarkdownAsRichText.test.ts` | 16 | 298 |
| `src/lib/snippet-preview-ui.accessibility.test.ts` | 16 | 282 |
| `src/types/index.test.ts` | 15 | 136 |
| `src/storage/backends/sync.test.ts` | 15 | 178 |
| `src/components/editor/.../ResizableMediaWrapper.test.ts` | 13 | 149 |
| `src/lib/preview-privacy.test.ts` | 11 | 279 |
| `src/lib/sentry-relay.test.ts` | 11 | 169 |
| `src/storage/backends/media-idb-errors.test.ts` | 10 | 505 |
| `src/components/ui/icon.test.tsx` | 10 | 90 |
| `src/utils/usageTracking.test.ts` | 21 | 247 |
| `src/storage/backends/local.test.ts` | 7 | 121 |
| `src/lib/debug.test.ts` | 7 | 149 |
| `src/lib/messages.test.ts` | 6 | 51 |
| `src/storage/types.test.ts` | 6 | 47 |
| `src/lib/icons.test.ts` | 5 | 50 |
| **Total** | **917** | |

**E2E — 9 specs, 109 tests:**

| Spec | Tests | Lines |
|------|------:|------:|
| `e2e/options.spec.ts` | 34 | 1052 |
| `e2e/content-script.spec.ts` | 26 | 711 |
| `e2e/image-gif.spec.ts` | 9 | 555 |
| `e2e/popup.spec.ts` | 13 | 427 |
| `e2e/storage.spec.ts` | 8 | 353 |
| `e2e/background.spec.ts` | 8 | 295 |
| `e2e/messaging.spec.ts` | 5 | 276 |
| `e2e/contenteditable-multinode.spec.ts` | 5 | 248 |
| `e2e/manual-qa-page.spec.ts` | 1 | 25 |
| **Total** | **109** | |

Harness: `e2e/fixtures.ts` (persistent context + extension load), `e2e/global-setup.ts` (`pnpm build` unless `E2E_SKIP_BUILD`), `e2e/helpers/{snippets,storage,serve.mjs,test-page.html,manual-qa.html}`.

**Specs:** 28 files in `specs/` (behavioral source for TDD verdicts).

### 1.3 Baseline results (this working tree)

| Suite | Result |
|-------|--------|
| `pnpm test` (unit) | **2 failed / 915 passed (917)** |
| `pnpm test:e2e` | **3 failed / 106 passed (109)** — 3.4 min, workers:1 |

**Unit failures:**

1. `src/lib/importers/textblaze.test.ts:193` — expects `**Bold text**`, received `<p><strong>Bold text</strong></p>`
2. `src/lib/importers/powertext.test.ts:169` — expects `**Hello**`, received `<strong>Hello</strong>`

**Root cause (both):** `deserializeContent()` is called without the `"html"` format argument, so raw HTML is parsed as Markdown and passes through nearly unchanged:
- `src/lib/importers/textblaze.ts:89` → `deserializeContent(cleaned)` (default format `"markdown"`)
- `src/lib/importers/powertext.ts:92` → `deserializeContent(raw)` (same)

Spec mandates HTML→Markdown conversion: `specs/importers.spec.md:108` (“MUST … converting HTML → Clipio markdown”), `:149`. **Tests are correct; implementation has the bug.** Fix belongs in impl (MANDATORY 4).

**E2E failures:**

1. `e2e/content-script.spec.ts:394` — “shows preview when typing trigger prefix”. **Flaky:** passes in isolation (re-run verified), fails under full-suite load. Uses fixed `waitForTimeout(200)` at `:410` (NON-DETERMINISM).
2. `e2e/options.spec.ts:1031` — axe **color-contrast** (serious): `#search-help` kbd, fg `#71717b` on bg `#f4f4f5` = **4.39:1** (needs 4.5:1), font 10px. Real product violation → `src/pages/Dashboard.tsx:566`.
3. `e2e/popup.spec.ts:406` — same `#search-help` violation (same DOM).

Note: the previously reported `injectAxe`/`checkA11y` API break is **already migrated** in the working tree (`popup.spec.ts:415`, `options.spec.ts:1040` both use `new AxeBuilder(...)`). Remaining a11y failures are genuine product violations, not tooling breaks.

### 1.4 Infra debt (greps)

| Check | Result |
|-------|--------|
| `.skip` / `.todo` / `.only` in tests | **None** — good |
| `toMatchSnapshot` / inline snapshots | **None** |
| TODO/FIXME in test files | **None** |
| `waitForTimeout` in e2e | **105 calls** across specs |
| `global.fetch =` assignments in unit tests | `giphy.test.ts` ×10, `update-checker.test.ts` ×5 |
| `afterEach` restores `global.fetch`? | **No** — both only call `vi.unstubAllEnvs()` (`giphy.test.ts:97-99`, `update-checker.test.ts:105-107`) |
| Fake timers (`vi.useFakeTimers`) | **None** — `manager.test.ts:214` uses real `setTimeout(0)`; subagent also flagged `:351`, `:362` |
| `data-testid` in `src/` | Only 17 attrs: `options/{Advanced,Dashboard,Snippets}Section.tsx`, `app-sidebar.tsx`, `snippet-preview-ui.ts:148`. **None** in popup/Dashboard list UI |
| testids referenced by e2e but **missing in src** | `snippet-list`, `empty-state` (`popup.spec.ts:29`), `snippet-list-item` (`image-gif.spec.ts:223`) |
| vitest.config comment | Says “Vitest v2+” — running **v4** (stale) |
| Coverage excludes with tests present | `src/lib/preview-helpers.ts` (31 tests), `src/lib/sentry-relay.ts` (11 tests), `src/pages/**` (35 tests) — tested but excluded from coverage accounting |
| CI (`.github/workflows/ci.yml`) | format → lint → compile → `test:coverage` → codecov; separate e2e job (`E2E_SKIP_BUILD=1`); `retries: 1` in Playwright CI config |
| Axe API | `AxeBuilder` default export confirmed (`node -e "..."`); both a11y specs already on `AxeBuilder` |

### 1.5 Fragile-selector density (e2e)

| Spec | `:has-text(` | `text=` | `.nth(` | `textContent`/`innerText`/`:has-text`/`text=` (combined) |
|------|-------------:|--------:|--------:|----------------------------------------------------------:|
| `options.spec.ts` | 14 | 3 | 2 | 30 |
| `contenteditable-multinode.spec.ts` | 0 | 0 | 0 | 15 |
| `content-script.spec.ts` | 0 | 0 | 1 | 14 |
| `image-gif.spec.ts` | 1 | 0 | 1 | 12 |
| `popup.spec.ts` | 4 | 0 | 0 | 8 |
| `background/messaging/storage/manual-qa` | 0 | 0 | 0 | low |

Helper pages (`test-page.html`, `manual-qa.html`) are well-testid’d; **product UI (popup Dashboard, snippet list) has almost no testids.**

---

## PART 2 — Flagged tests

Criteria: **1** ASSERT-ON-DETAIL · **2** FRAGILE-SELECTOR · **3** IMPL-DERIVED (decorative/test-after) · **4** MISSING-NEGATIVE · **5** WEAK-ASSERTION · **6** NON-DETERMINISM · **7** REDUNDANT

### 2.1 Decorative / fake tests (criterion 3+5) — highest severity

| # | Location | Flags | Evidence |
|---|----------|-------|----------|
| 1 | `src/pages/Dashboard.accessibility.test.ts` (all 35 tests, e.g. `:18`, `:24-25`, `:41-47`, `:62-63`, `:71-75`, `:81-87`, `:141-155`, `:241-242`, `:284-297`) | **3, 5** | Imports **only** `vitest` (`:10`). Every assertion is a literal: `const isKeyboardAccessible = true; expect(...).toBe(true)` (32 such consts). Zero React, zero DOM, zero production imports. Pure theater — claims WCAG coverage it never executes. |
| 2 | `src/lib/content-security-regression.test.ts` (all 30 tests, e.g. `:22-27`, `:29-34`, `:36-41`, `:43-63`) | **3, 5** | Imports **only** `vitest` (`:14`). Asserts behavior of `String.startsWith` / local arrays, not `sanitizeUrl`/`markdownToHtml`/expansion pipeline. The `:60-62` assertion `expect([true,true,true,true,true]).toContain(...)` is tautological. |
| 3 | `src/lib/sentry-relay.test.ts:18-38` (“sender validation”) | **3, 5** | Compares two local string literals (`externalWebsiteId === mockBrowserRuntimeId`) — never invokes `registerSentryRelayListener` (`src/lib/sentry-relay.ts:39`) or the `sender.id !== browser.runtime.id` check (`:48`). Comment at `:19-20` admits “actual validation is done in sentry-relay.ts”. Security-critical path untested. |
| 4 | `e2e/image-gif.spec.ts:244-246` | **2, 5** | `else { expect(true).toBe(true); }` — vacuous pass when `snippet-list-item` count < 2. And that testid **does not exist in src**, so the vacuous branch is the likely path. |
| 5 | `src/components/ui/icon.test.tsx:70-77` | **1, 5** | Comment claims “yielding 12x32 — verified against the built stylesheet”; assertions only check class substrings (`size-3`, `h-8`, `w-3`). Overclaims verification. |

### 2.2 Failing tests (baseline)

| # | Location | Flags | Evidence |
|---|----------|-------|----------|
| 6 | `src/lib/importers/textblaze.test.ts:193` | impl bug, test OK | Spec-derived (`// spec:` at `:178`); fails because `textblaze.ts:89` omits `"html"` format. |
| 7 | `src/lib/importers/powertext.test.ts:169` | impl bug, test OK | Same root cause: `powertext.ts:92`. |
| 8 | `e2e/content-script.spec.ts:394` | **6** | Fixed `waitForTimeout(200)` at `:410`; fails under suite load, passes solo. |
| 9 | `e2e/options.spec.ts:1031` | product a11y bug | axe color-contrast 4.39:1 on `#search-help` (`src/pages/Dashboard.tsx:566`). Test correct; product violates WCAG AA. |
| 10 | `e2e/popup.spec.ts:406` | product a11y bug | Same violation, same element. |

### 2.3 Fragile selectors (criterion 2)

| # | Location | Flags | Evidence |
|---|----------|-------|----------|
| 11 | `e2e/popup.spec.ts:29` | **2, 4** | Waits on `[data-testid="snippet-list"], [data-testid="empty-state"]` — **neither testid exists in src**; falls through to bare `button, input` (matches anything). Also `waitForTimeout(300)` at `:33`. |
| 12 | `e2e/image-gif.spec.ts:223` | **2, 4, 5** | `[data-testid="snippet-list-item"]` — **does not exist in src** → count 0 → vacuous branch `:246`. |
| 13 | `e2e/options.spec.ts` (14× `:has-text(`, 3× `text=`, 2× `.nth(`; 30 text-content selectors total) | **2** | e.g. copy/heading assertions bound to literal UI strings; any i18n/copy change breaks tests. |
| 14 | `e2e/contenteditable-multinode.spec.ts` (8× `textContent`, 7× `innerText`) | **2** | Asserts full text equality against formatted serializations. |
| 15 | `e2e/content-script.spec.ts` (11× `innerText`, 3× `textContent`, 1× `.nth(`) | **2** | e.g. `toContainText("Clipio Snippets")`-style copy coupling (partially mitigated at `:424-431` by asserting logo instead of title — good pattern, applied inconsistently). |
| 16 | `e2e/popup.spec.ts` (4× `:has-text(`) | **2** | Banner/list copy assertions. |
| 17 | `e2e/image-gif.spec.ts:235-239` | **2, 5** | `bodyText.toLowerCase().includes("unsaved")` — copy-or-dialog heuristic; accepts any body containing the word. |

### 2.4 Non-determinism / pollution (criterion 6)

| # | Location | Flags | Evidence |
|---|----------|-------|----------|
| 18 | `src/lib/giphy.test.ts:70,78,86,205,282,290,307,319,330,357` + `afterEach:97-99` | **6** | Overwrites `global.fetch` 10×; `afterEach` only `vi.unstubAllEnvs()` — **never restores fetch**. Leak across files (same pattern in update-checker). |
| 19 | `src/lib/update-checker.test.ts:75,83,91,214,222` + `afterEach:105-107` | **6** | 5× `global.fetch =` assignments; no restore. |
| 20 | `src/storage/manager.test.ts:214` (also `:351`, `:362`) | **6** | Real `setTimeout` waits; no fake timers anywhere in suite. Slow + timing-sensitive. |
| 21 | E2E suite-wide: 105 × `waitForTimeout` | **6** | Fixed sleeps instead of condition-based waits; root cause of flake #8. |
| 22 | `playwright.config.ts:22` | tooling | CI `retries: 1` masks flaky tests (#8) instead of failing them. |

### 2.5 Weak assertions (criterion 5)

| # | Location | Flags | Evidence |
|---|----------|-------|----------|
| 23 | `src/lib/preview-privacy.test.ts` (partial, e.g. `:41` `await new Promise(r => setTimeout(r, 50))`) | **5, 6** | Mixes real `debugLog` tests with fixed sleeps and environment-dependent “off by default” assumptions. |
| 24 | `src/lib/exporters/clipio.test.ts:55-64` | **7, 5** | Two overlapping `exportedAt` tests (ISO parse + regex) for the same requirement. |
| 25 | `e2e/messaging.spec.ts` / `background.spec.ts` (per subagent) | **5** | Several status/string checks without complementary failure-path expectations. |

### 2.6 Missing negative paths (criterion 4)

| # | Area | Evidence of gap |
|---|------|-----------------|
| 26 | Sentry relay listener | No test drives `registerSentryRelayListener` with mock `browser.runtime.onMessage` for: wrong `sender.id`, missing `envelope`, missing DSN, non-object message (`src/lib/sentry-relay.ts:42-58` untested). |
| 27 | HTML→MD conversion | No negative test: malformed HTML → fallback to `text` field is specified (`specs/importers.spec.md:109`) but conversion-failure path only triggered when `deserializeContent` throws — untested because format bug (#6/#7) means it never exercises real HTML parse. |
| 28 | `StorageQuotaError` **instanceof** in manager fallback | `manager.test.ts:174-176` mocks rejection with `new StorageQuotaError()` (good) but no test that a **plain** `Error` with same message does **not** trigger fallback (negative discrimination). |
| 29 | `canParse` discrimination | `detect.test.ts` covers positives; no test that TextBlaze-shaped object with `format: "clipio"` key is claimed by Clipio not TextBlaze (cross-parser collision). |
| 30 | Preview/privacy | Spec `specs/preview-privacy.spec.md:17` names `sanitizeForPreview` — **function does not exist**; no test can cover it (spec drift, see 2.7). |

### 2.7 Spec ↔ code ↔ test drift (blocks true TDD classification)

| Spec location | Drift |
|---------------|-------|
| `specs/preview-helpers.spec.md:17` | Specifies `computePreviewPrivacy` — **not implemented**, not tested. |
| `specs/preview-privacy.spec.md:17` | Specifies `sanitizeForPreview` — **not implemented**. |
| `specs/exporters.spec.md:18` | Specifies `exportToClipio` — impl/tests use `buildClipioExport`. |
| `specs/giphy.spec.md:17,23,43-44` | Specifies `searchGiphy`, “returns `[]` on network error”, “does not throw” — impl exports `search` and **throws** `GiphyNetworkError` (`giphy.ts:70`, tests assert throws at `giphy.test.ts:228-236`). **Tests contradict the spec** (follow impl). |
| `specs/giphy.spec.md:21` | “API key from env” — impl reads storage item with env fallback (`giphy.test.ts:126-129`). |

### 2.8 Redundancy (criterion 7)

| Overlap | Detail |
|---------|--------|
| `Dashboard.accessibility.test.ts` vs `e2e/popup.spec.ts:406` + `options.spec.ts:1031` | Unit file is fake (see #1); real a11y coverage exists only in e2e axe. Unit file is 100% redundant **and** misleading. |
| `content-security-regression.test.ts` vs `markdown.test.ts:19-100` + `content-helpers.test.ts` | Security unit file duplicates `escapeHtml`/`sanitizeUrl` coverage already spec-derived in `markdown.test.ts`, but does so without importing the functions. |
| `exporters/clipio.test.ts:55` vs `:61` | Duplicate `exportedAt` format checks. |
| `preview-privacy.test.ts` debugLog section vs `debug.test.ts` | Overlapping debug-on/off behavior. |

---

## PART 3 — TDD / SDD verdicts by feature area

**(a) = spec-derived (test traces to `specs/*.md` `// spec:` anchor)** · **(b) = impl-derived (written from code, decorative, or contradicts spec)**

| Feature area | Files | Verdict | Notes |
|--------------|-------|---------|-------|
| Markdown utils | `markdown.test.ts` | **(a)** | Explicit `// spec: MUST …` lines matching `specs/markdown.spec.md`. |
| Content helpers / expansion | `content-helpers.test.ts` | **(a)** | Dense spec anchors incl. `content-expansion.spec.md#…`. |
| Review prompt | `review-prompt.test.ts` | **(a)** | Anchors to every condition + resilience + store URL. |
| Importers (detect/clipio/textblaze/powertext) | `importers/*.test.ts` | **(a)** | Spec anchors; 2 failures are **impl bugs**, not test bugs (#6/#7). |
| Exporters | `exporters/clipio.test.ts` | **(a)** w/ drift | Anchors to `exporters.spec.md` but spec names `exportToClipio` (2.7). |
| Serialization | `serialization.test.ts` | **(a)** | Spec anchors for HTML/markdown node handling. |
| Storage backends + manager | `storage/**` | **(a)** | `// spec:` anchors; gaps: no fake timers, weak negative #28. |
| Date utils / types / debug / messages / sentry-scrub / snippetUtils / usageTracking / preview-helpers / dom-text-range / icons | respective files | **(a)** | Clean spec-derived pure-logic suites. |
| **Giphy** | `giphy.test.ts` | **(b) contradicts spec** | Spec: return `[]`, never throw. Impl+tests: throw typed errors. One side must change (2.7). |
| **Copy markdown as rich text** | `copyMarkdownAsRichText.test.ts` | **(b)** | Written from impl behavior (clipboard writes, fallbacks); spec `copy-markdown.spec.md` is thinner than test matrix. |
| **Dashboard a11y (unit)** | `Dashboard.accessibility.test.ts` | **(b) decorative** | No spec anchor executed; pure literals (#1). Real coverage only via e2e axe. |
| **Content security (unit)** | `content-security-regression.test.ts` | **(b) decorative** | Claims spec refs in header (`:4`) but imports nothing from prod (#2). |
| **Sentry relay** | `sentry-relay.test.ts` | **(b)** | Type constant real; sender-validation section decorative (#3). No `messages.spec.md` coverage of relay. |
| **Preview privacy** | `preview-privacy.test.ts` | **mixed (a)/(b)** | Real `debugLog` mocking (a) + fixed sleeps/weak env assumptions (b). Spec names nonexistent `sanitizeForPreview` (2.7). |
| **Icon component** | `icon.test.tsx` | **(b)** | Asserts tailwind class matrix from impl; overclaimed comment (#5). |
| **E2E popup/options** | `popup.spec.ts`, `options.spec.ts` | **(a)** mostly | Anchor `specs/e2e-suite.spec.md`; selector strategy fragile (2.3); axe tests valid but currently red on product bug. |
| **E2E content-script** | `content-script.spec.ts` | **(a)** w/ flake | Preview test spec-aligned but timing-based (#8). |
| **E2E image-gif** | `image-gif.spec.ts` | **mixed** | CRUD flows real; unsaved-changes guard vacuous (#4/#12). |
| **E2E storage/background/messaging/contenteditable/manual-qa** | | **(a)/(b) mixed** | Flows exercise real extension; some copy-coupled assertions (2.3). |

**Summary:** ~24 of 35 unit files are solidly spec-derived. **5 files/sections are decorative or contradict spec** (Dashboard a11y unit, content-security unit, sentry-relay sender section, giphy error contract, icon overclaims). E2E is mostly spec-anchored but selector strategy and fixed sleeps undermine reliability.

---

## PART 4 — Risk-ranked gaps

| Rank | Gap | Risk | Evidence |
|-----:|-----|------|----------|
| **P0** | 5 red tests on baseline (2 unit + 3 e2e) block CI / mask regressions | CI broken today | 1.3 |
| **P0** | HTML→MD format bug in both importers — **user data corruption** on import (HTML saved as content instead of markdown) | Data integrity | `textblaze.ts:89`, `powertext.ts:92` |
| **P0** | 65 fake/decorative unit tests (Dashboard a11y 35 + content-security 30 + relay sender section) give false confidence on **security & a11y** | Security theater | 2.1 |
| **P1** | Missing testids (`snippet-list`, `empty-state`, `snippet-list-item`) — e2e either no-ops or binds to wrong nodes | Silent e2e coverage loss | 2.3 #11–12 |
| **P1** | `#search-help` WCAG contrast failure (4.39 < 4.5) | Product a11y violation | 1.3, `Dashboard.tsx:566` |
| **P1** | Spec drift on giphy error contract + 3 nonexistent spec APIs | TDD broken; spec unusable as source of truth | 2.7 |
| **P1** | `global.fetch` never restored (giphy, update-checker) | Cross-file test pollution, order-dependent flakes | 2.4 #18–19 |
| **P2** | 105 `waitForTimeout` + CI `retries:1` | Chronic flake masked not fixed | 2.4 #21–22 |
| **P2** | Fragile copy-bound selectors (options 30, contenteditable 15, content-script 14) | Copy/i18n churn breaks e2e | 2.3, 1.5 |
| **P2** | Coverage excludes modules that have tests (preview-helpers, sentry-relay, pages) | Coverage % understates reality; thresholds mislead | 1.4 |
| **P3** | No fake timers; real `setTimeout` in storage tests | Slow suite | 2.4 #20 |
| **P3** | Redundant overlapping tests (exportedAt ×2, security vs markdown, preview-privacy vs debug) | Maintenance drag | 2.8 |
| **P3** | Stale “Vitest v2+” comment; no MSW/RTL | Tooling docs drift; component testing relies on SSR markup only | 1.4 |

---

## MANDATORY TASKS (1–6) — remediation plan

> Executed **after** this report, as a separate reviewable pass. Each task lists scope + acceptance checks.

### 1 — Rewrite impl-derived / decorative tests

- **Delete or rebuild** `src/pages/Dashboard.accessibility.test.ts`: replace literal tautologies with real render assertions (SSR `renderToStaticMarkup` or mount via `react-dom/client` in happy-dom) checking actual ARIA (`role="listbox"` at `Dashboard.tsx:641`, `aria-describedby`, focus hooks) — or remove entirely and rely on e2e axe (document the choice).
- **Rewrite** `src/lib/content-security-regression.test.ts` to import and assert **real** `sanitizeUrl`, `markdownToHtml`, `escapeHtml`, and expansion HTML path; every case must fail if the prod function regresses.
- **Rewrite** `sentry-relay.test.ts` sender section to invoke `registerSentryRelayListener()` with mocked `browser.runtime.onMessage`, asserting reject on `sender.id` mismatch, missing envelope, missing DSN.
- Fix `icon.test.tsx:70-77` comment (remove unverified claim) or assert computed dimensions if stylesheet available.
- **Accept:** killing `sanitizeUrl`/`sender.id` check in prod turns these tests red.

### 2 — Replace fragile selectors (+ add missing testids)

- Add `data-testid="snippet-list" | "empty-state" | "snippet-list-item"` to popup Dashboard list UI (`src/pages/Dashboard.tsx` / snippet list child).
- Migrate `popup.spec.ts:29`, `image-gif.spec.ts:223` to those testids; remove vacuous `else expect(true)` branch — fail if items missing.
- Sweep `options.spec.ts` `:has-text`/`text=` → roles (`getByRole`) or testids; keep copy assertions only where copy is the contract (i18n specs).
- **Accept:** `rg ':has-text\(' e2e/options.spec.ts` count drops ≥50%; `snippet-list*` testids exist in src.

### 3 — Add negative-path tests

- Relay: wrong sender / no envelope / no DSN (shares work with Task 1).
- Importers: malformed HTML → text-field fallback (`importers.spec.md:109`); cross-parser collision (`format`/`version`/`folders` keys).
- Manager: plain `Error` does **not** trigger local fallback (only `StorageQuotaError`).
- Markdown/sanitize: protocol-relative `//evil`, `JaVaScRiPt:` mixed case, whitespace-obfuscated schemes.
- **Accept:** each new test references a `specs/` line or an issue; coverage branches for listed paths > 0.

### 4 — Fix tooling mismatches / red baseline

- **Impl fix (tests already correct):** pass `"html"` format — `textblaze.ts:89` and `powertext.ts:92` → `deserializeContent(x, "html")`.
- **Product fix:** raise `#search-help` contrast to ≥4.5:1 (`Dashboard.tsx:566`).
- **Flake fix:** replace `waitForTimeout(200)` in `content-script.spec.ts:410` (and critical paths) with `expect(...).toBeVisible()` polling.
- **Pollution fix:** save/restore `global.fetch` in `giphy.test.ts` + `update-checker.test.ts` `afterEach`.
- Update stale “Vitest v2+” comment in `vitest.config.ts`.
- Re-evaluate coverage excludes for modules that now have real tests (`preview-helpers`, `sentry-relay`).
- **Accept:** `pnpm test` → 917/917 green; `pnpm test:e2e` → 109/109 green; `pnpm compile`, `pnpm lint` clean.

### 5 — Consolidate redundant tests

- Merge/remove `content-security-regression` overlaps with `markdown.test.ts` post-rewrite (keep one authoritative security suite).
- Dedupe `exporters/clipio.test.ts:55` vs `:61`.
- Fold `preview-privacy` debugLog cases into `debug.test.ts` or vice versa.
- **Accept:** no duplicated assertion pairs; test count may drop without coverage drop (`pnpm test:coverage` before/after).

### 6 — Codify testing standards (now in `AGENTS.md`)

Rules codified from this audit (SPEC → TEST → CODE → REVIEW already in AGENTS.md; this adds **test-quality** rules):

1. Every test must import the production unit under test — **no literal-only assertions**.
2. Spec anchor comment (`// spec: specs/….md#…`) required for behavioral tests; drift bugs filed against spec or impl within the same PR.
3. E2E locators: `data-testid` (added to src in same PR) or ARIA role selectors first; `:has-text`/`text=` requires justification comment.
4. No `expect(true).toBe(true)` / vacuous branches — `test.fail()` or hard assert instead.
5. No bare `waitForTimeout` > 0 without comment; prefer Playwright auto-waiting/`expect.poll`.
6. Mock hygiene: every `global.*` / `fetch` / timer override restored in `afterEach`.
7. Negative test required for every new validation/security branch.
8. A11y: unit tests must render real DOM; page-level scans use `AxeBuilder` (v4 API only).
9. CI: prefer `retries: 0` locally; investigate any CI retry as a flake bug (Task 4).
10. Coverage: modules with tests should not be blanket-excluded without a written reason.

### Remediation status (post-pass)

- **Task 1** — `content-security-regression.test.ts` asserts real production
  sanitizers; `Dashboard.accessibility.test.ts` removed (a11y moved to e2e axe
  scans, choice documented in spec); `sentry-relay.test.ts` drives the real
  listener via `registerSentryRelayListener()`.
- **Task 2** — `snippet-list`, `snippet-list-item`, `empty-state` testids live
  in src; `:has-text(` count in `e2e/` is 0; vacuous else-branches removed.
- **Task 3** — negative paths added: relay wrong-sender/no-envelope/no-DSN;
  cross-parser collisions (Clipio envelope vs TextBlaze shape both ways,
  `detect.test.ts`); manager plain `Error` with quota-like message does **not**
  fall back (only `StorageQuotaError` instanceof); mixed-case `JaVaScRiPt:`
  and protocol-relative `//evil` sanitizing.
- **Task 4** — impl fixes (`deserializeContent(x, "html")`), `#search-help`
  contrast, `waitForContentScriptReady()` flake fix, fetch save/restore,
  coverage excludes re-evaluated (`sentry-relay.ts` and `preview-helpers.ts`
  no longer excluded; remaining excludes each carry a written reason).
- **Task 5** — overlap pairs merged: `exporters/clipio` dedup; content-security
  ↔ `markdown.test.ts` de-duplicated (unit authority for `markdown.ts`
  primitives stays in `markdown.test.ts`; content-security keeps only
  expansion-pipeline-specific security, and GIF ID cases assert through
  `markdownInlineToHtml` instead of a re-implemented regex); `preview-privacy`
  debugLog behavior cases folded into `debug.test.ts`.
- **Task 6** — testing standards codified (10 rules) and merged into
  `AGENTS.md` (Testing Standards section); the standalone
  `TESTING_STANDARDS.md` was removed.

---

## Appendix — Audit method

- Full reads: all 9 e2e specs, fixtures/setup/helpers, `vitest.config.ts`, `playwright.config.ts`, `ci.yml`, `package.json`, worst-offender unit files spot-verified line-by-line (Dashboard a11y, content-security, sentry-relay, preview-privacy, giphy, markdown, icon, exporters, update-checker, manager, image-gif).
- Parallel subagent audits (4): storage · content/UI · import/export · utils/platform — findings reconciled and **spot-verified** before inclusion (claims that failed verification were dropped or corrected, e.g. `StorageQuotaError` instanceof coverage already exists in `types.test.ts:13-18`; `injectAxe` already migrated).
- Commands run: `pnpm test` (baseline), `pnpm test:e2e` (baseline), targeted re-run of flaky test, axe failure artifact inspection, greps for flags 1–7.
