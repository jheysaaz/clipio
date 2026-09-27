# Module: E2E Suite — Regression Fixes & Testing Standards

> Source: `e2e/*.spec.ts`, `e2e/fixtures.ts`
> Coverage target: All e2e tests must assert real behavior

## Purpose

Repair 7 failing e2e tests (stale copy/selectors and a broken axe API) and
codify the testing standards required so this suite catches real regressions
instead of decorating the CI pipeline.

## Problem

1. Two a11y tests call `injectAxe`/`checkA11y`, which do not exist in the
   installed `@axe-core/playwright@4.12.1` (class `AxeBuilder` API only), so
   accessibility has never actually been scanned.
2. Five tests assert against stale UI copy or stale DOM structure:
   - Preview header copy changed "Clipio Snippets" → "Snippets" (logo is now
     the branding) in commit `81cd5e5`.
   - Options sidebar is a `<div>` (no `nav`/`aside` element) and its nav item
     for the Developers section was renamed "Developers" → "Advanced" during
     the options restructure (`febcb71`).
   - Developer cards moved: Extension Version and Top 5 Usage now render on
     the Dashboard; Content Script Health / Storage Mode & Quota / Clear IDB
     Backup render in the Developers (Advanced) section; Typing Timeout moved
     to the Snippets section.
   - `navigateToDevelopers()` silently no-ops when its copy-based nav selector
     matches nothing, so several "Developers" tests were green by never
     exercising the section.

## Solution

- Add stable, behavior-oriented selectors to source components
  (`data-testid`, `role="navigation"`) and rewrite the five tests against
  them. No assertion is loosened: every test must still prove the underlying
  behavior (preview renders with branding, nav switches sections, all five
  cards render where the product actually places them, storage-mode card
  tracks the active backend across a real mode switch, typing-timeout slider
  renders the default 300 ms).
- Migrate both a11y tests to `AxeBuilder` and fail on any `critical` or
  `serious` violation; attach full axe results to the test report.
- Fix intermittent content-script expansion flakes (root cause, not retries):
  the content script binds input listeners only at the end of its async
  `initialize()` (`content.ts`), while tests typed after a blind
  `waitForTimeout(600)`. When init occasionally exceeded the sleep (fresh
  Chrome / service-worker cold start), keystrokes hit a page with **no
  listeners** — no debounce timer was ever set, so the field still contained
  the raw shortcut. Fix: source sets `data-clipio-ready="true"` on `<html>`
  when init finishes; a shared helper `waitForContentScriptReady()` replaces
  the five post-reload blind sleeps in `content-script`,
  `contenteditable-multinode`, and `image-gif` specs. Assertions unchanged.

## Acceptance Criteria

- [x] All 7 previously failing tests pass for behavioral reasons (verified
      against source, not just green).
- [x] Options/popup a11y tests run real axe scans; full results attached to
      the report; zero critical/serious violations (or violations reported
      as bugs, not suppressed).
- [x] `navigateToDevelopers()` navigates via a stable selector and fails
      loudly if the section is missing (no silent no-op).
- [x] Tests touched by this change no longer assert literal copy via
      `textContent("body")` or bare `:has-text()` container matching.
- [x] `pnpm test:e2e`, `pnpm compile`, `pnpm lint` pass.
- [x] CONTRIBUTING documents: copy/DOM changes must run e2e locally; a
      `data-testid` under e2e coverage may not be removed/repurposed without
      updating its test in the same PR.

## Edge Cases

- Storage-mode switch test must read the backend from extension storage and
  switch both directions safely, restoring the initial mode.
- Typing-timeout default (300) must be read on a fresh, isolated browser
  context (fixtures already give each test its own user-data dir).
- Non-English locales: tests must not key off translated strings for
  navigation (data-testid based).

## Known discrepancies (flagged, NOT silently adapted)

- `specs/developers-section.spec.md` (original content from `a91ac61`) says
  all five cards live in the Developers section and all strings must be
  i18n'd; the implementation now splits cards across Dashboard/Developers/
  Snippets with hardcoded English (`DashboardSection`, `SnippetsSection`),
  leaving dead `options.developers.versionUpdate|topUsage|typingTimeout`
  keys in `en.yml`/`es.yml`.
- Card title "Extension Version" (rendered) vs i18n
  `options.developers.versionUpdate.title: "Extension Version & Update"`.
- The sidebar item is labelled "Advanced" while the section heading it opens
  is "Developers".
- **Bug (fixed, flag for review):** manifest had no `web_accessible_resources`;
  the preview header logo (`chrome-extension://…/icon/16.png`) and Inter font
  were blocked on web pages, so the preview branding `onerror`-hid itself.
  Fixed in `wxt.config.ts` (WAR entry) so test #1 passes legitimately.
- **Bug (fixed, flag for review):** real axe scans found
  `aria-progressbar-name` (serious ×4) — `Progress` roots lacked accessible
  names; fixed with `aria-label`s at all six call sites.
- **Bug (fixed, flag for review):** popup `#search-help` kbd failed
  `color-contrast` (serious): `text-muted-foreground` on `bg-muted` at 10px
  = 4.39:1 (< 4.5). Fixed with `text-foreground/70` (scoped).
- **Product-robustness flag (NOT changed):** because listeners attach only
  after async init, real users can lose their first keystrokes on a slow
  device during page load. Consider binding listeners before config load and
  gating expansion on readiness instead.
- **Harness note (environmental, not a test defect):** this session saw one
  silent Playwright node-process death under macOS swap pressure (4.6 GB
  swap used, load ~6) — distinct from assertion flakes; no test change made.

## Change History

| Date       | Change                     | Author |
| ---------- | -------------------------- | ------ |
| 2026-09-23 | Initial spec (e2e repair)  | —      |
