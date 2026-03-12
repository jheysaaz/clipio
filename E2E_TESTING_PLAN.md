# E2E Testing Plan for Clipio Browser Extension

## Overview

This document outlines the comprehensive plan to implement end-to-end browser tests using Playwright for the Clipio browser extension. These tests will complement the existing 416 Vitest unit tests by validating real browser behaviors that cannot be mocked.

## Architecture

```
pnpm test          → Vitest (416 unit tests, ~2s, happy-dom)
pnpm test:e2e      → Playwright (browser tests, ~1-3min, real Chromium)
pnpm build         → WXT → .output/chrome-mv3/  (required before e2e)
```

Playwright loads the built extension via `--load-extension=.output/chrome-mv3/` into a persistent Chromium context. Each test gets the real extension with real browser APIs.

## Why Playwright?

- **Real browser APIs**: Tests use actual `browser.storage`, `browser.runtime`, `browser.contextMenus` instead of mocks
- **Extension support**: Playwright has built-in support for loading Chrome extensions with persistent contexts
- **Content script validation**: Can test snippet expansion in real DOM environments with React/Vue/Angular compatibility
- **Cross-context testing**: Can validate message passing between background, content scripts, popup, and options pages
- **Real clipboard & storage quotas**: Tests interact with actual browser clipboard and storage with real quota limits

## Behaviors That Require Browser Testing

These cannot be adequately tested with happy-dom mocks:

### Critical Areas

1. **Content Script Expansion**
   - Snippet expansion in `<input>`, `<textarea>`, `contenteditable`
   - Real `selectionStart`, `element.value` mutation
   - Synthetic event dispatch accepted by React/Angular/Vue
   - Real `window.getSelection()`, `Range`, `DocumentFragment`
   - Clipboard reading via `execCommand("paste")` with real permissions
   - Insertion verification via `requestAnimationFrame` timing
   - Confetti canvas rendering
   - Debounce + immediate Space/Tab expansion

2. **Background Script**
   - Context menu creation + click handling
   - `action.openPopup()` with fallback to `tabs.create()`
   - Sync-wipe detection via `storage.onChanged`
   - Uninstall URL registration
   - Service worker lifecycle

3. **Cross-Context Communication**
   - Sentry relay: content → background → Sentry ingest
   - Context menu draft: background writes, popup reads
   - Options → content script message passing
   - Storage change propagation across contexts

4. **Storage Layer**
   - Real sync quota limits (8KB per item, 100KB total)
   - Automatic fallback from sync → local on quota error
   - Per-key storage layout with diff-based writes
   - IndexedDB backup + recovery
   - Content-script cache watch() reactivity

5. **UI Components**
   - Popup dimensions (680x460)
   - Options page hash-based routing
   - Theme system with `matchMedia` OS preference detection
   - Rich clipboard write with `navigator.clipboard.write([ClipboardItem])`
   - Export blob download via anchor click

## Phase 0: Infrastructure Setup

### 0.1 Dependencies ✅

- [x] Install `@playwright/test` as dev dependency
- [ ] Run `npx playwright install chromium` to download browser binary

### 0.2 Config: `playwright.config.ts`

Create Playwright configuration with:

- Single Chromium project (extensions are Chrome-only)
- `globalSetup` to run `pnpm build` before tests
- `testDir: 'e2e'`
- Timeouts: 30s per test, 5min global
- Retries: 1 in CI, 0 locally
- Headless mode with `channel: 'chromium'`
- Output directories for reports/traces

### 0.3 Fixtures: `e2e/fixtures.ts`

Custom Playwright fixtures providing:

- `context` — persistent Chromium context with extension loaded
- `extensionId` — extracted from service worker URL
- `popupPage` — navigates to `chrome-extension://{id}/popup.html`
- `optionsPage` — navigates to `chrome-extension://{id}/options.html`
- `testPage` — controlled page with form fields for content script testing
- `storageHelper` — utilities to seed/read extension storage

### 0.4 Test Helpers: `e2e/helpers/`

- `test-page.html` — Controlled HTML with `<input>`, `<textarea>`, `contenteditable`
- `storage.ts` — Functions to seed snippets, read storage state
- `snippets.ts` — Factory functions to create test snippet data

### 0.5 Package.json Scripts

```json
{
  "test:e2e": "playwright test",
  "test:e2e:headed": "playwright test --headed",
  "test:e2e:ui": "playwright test --ui",
  "test:e2e:debug": "playwright test --debug"
}
```

### 0.6 CI Workflow: `.github/workflows/test.yml`

Update to add E2E job:

- Install Chromium: `npx playwright install --with-deps chromium`
- Build extension: `pnpm build`
- Run E2E tests: `pnpm test:e2e`
- Upload Playwright traces on failure
- Run on every push (as per user preference)

### 0.7 Gitignore

Add:

```
test-results/
playwright-report/
blob-report/
playwright/.cache/
```

## Phase 1: Content Script Expansion Tests (15 tests)

**File: `e2e/content-script.spec.ts`**

Tests validate snippet expansion in real DOM environments.

| #   | Test Name                                             | What It Validates                                                                             |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | `expands shortcut in text input`                      | Types `/hello` + space in `<input type="text">`, verifies value replaced with snippet content |
| 2   | `expands shortcut in textarea`                        | Same for multi-line `<textarea>`                                                              |
| 3   | `expands shortcut in contenteditable`                 | Types shortcut in contenteditable div, verifies innerHTML contains expanded markdown-as-HTML  |
| 4   | `does not expand partial match`                       | Types `x/hello` (no word boundary), verifies no expansion                                     |
| 5   | `expands on Tab key`                                  | Types shortcut + Tab, verifies immediate expansion with no focus change                       |
| 6   | `expands on Space key immediately`                    | Verifies immediate expansion on Space (no 300ms debounce)                                     |
| 7   | `debounced expansion on regular typing`               | Types shortcut then waits 300ms+ for debounce to fire                                         |
| 8   | `positions cursor with {{cursor}} in input`           | Expands snippet with cursor placeholder, verifies `selectionStart` at correct offset          |
| 9   | `positions cursor with {{cursor}} in contenteditable` | Verifies cursor marker element removed, Selection placed correctly                            |
| 10  | `inserts clipboard content with {{clipboard}}`        | Copies text to clipboard, expands snippet with clipboard placeholder                          |
| 11  | `formats date with {{date:FORMAT}}`                   | Verifies date placeholder replaced with formatted current date                                |
| 12  | `renders markdown in contenteditable`                 | Snippet with `**bold**`, `*italic*` renders as `<strong>`, `<em>`                             |
| 13  | `matches longest shortcut first`                      | Two snippets `/h` and `/hello`, typing `/hello` matches longer one                            |
| 14  | `updates index on storage change`                     | Create snippet via popup, verify content script can expand it without page reload             |
| 15  | `handles extension context invalidation`              | Verify graceful degradation when extension unloaded mid-session                               |

### Test Strategy

1. Use `page.route()` to intercept navigation and serve controlled HTML
2. Seed snippets via `page.evaluate()` to write to `browser.storage.local`
3. Wait for content script injection with `page.waitForFunction()`
4. Interact with input fields using Playwright locators
5. Verify DOM changes and cursor positions

## Phase 2: Background Script Tests (8 tests)

**File: `e2e/background.spec.ts`**

Tests validate service worker behavior and browser API integration.

| #   | Test Name                               | What It Validates                                                      |
| --- | --------------------------------------- | ---------------------------------------------------------------------- |
| 1   | `creates context menu items on install` | Verify 5 menu entries exist via service worker evaluation              |
| 2   | `save selection context menu flow`      | Select text, trigger menu action, verify draft stored and popup opens  |
| 3   | `open dashboard context menu action`    | Trigger action, verify new tab with options page opens                 |
| 4   | `popup opening with fallback`           | Test `action.openPopup()` with fallback to `tabs.create()`             |
| 5   | `detects sync storage wipe`             | Simulate bulk removal of `snip:*` keys, verify `syncDataLost` flag set |
| 6   | `sets uninstall URL on install`         | Verify `runtime.setUninstallURL` called correctly                      |
| 7   | `service worker remains active`         | Verify background doesn't terminate mid-operation                      |
| 8   | `recreates menus after browser restart` | Test menu persistence across service worker restarts                   |

### Test Strategy

1. Access service worker via `context.serviceWorkers()[0]`
2. Use `serviceWorker.evaluate()` to call extension APIs
3. Listen to browser events via service worker evaluation
4. Simulate user actions that trigger background behavior

## Phase 3: Popup (Dashboard) Tests (12 tests)

**File: `e2e/popup.spec.ts`**

Navigate to `chrome-extension://{extensionId}/popup.html` and test CRUD operations.

| #   | Test Name                                   | What It Validates                                                 |
| --- | ------------------------------------------- | ----------------------------------------------------------------- |
| 1   | `loads and shows empty state`               | No snippets, shows empty list or get-started message              |
| 2   | `creates new snippet`                       | Fill form (label, shortcut, content), save, verify in list        |
| 3   | `edits existing snippet`                    | Click snippet, modify content, save, verify updated               |
| 4   | `deletes snippet with confirmation`         | Click delete, confirm dialog, verify removed                      |
| 5   | `searches and filters snippets`             | Create 3 snippets, type in search, verify filtered list           |
| 6   | `keyboard navigation with arrow keys`       | Use arrow keys to navigate list                                   |
| 7   | `copies snippet to clipboard (rich format)` | Click copy, verify clipboard contains HTML                        |
| 8   | `consumes context menu draft`               | Pre-seed `contextMenuDraftItem`, open popup, verify draft in form |
| 9   | `shows sync-wipe recovery banner`           | Set `syncDataLost` flag, verify warning banner displayed          |
| 10  | `shows quota warning banner`                | Fill storage near quota, verify warning appears                   |
| 11  | `import button opens options page`          | Click import button, verify options page opens in new tab         |
| 12  | `popup has correct dimensions`              | Verify viewport is 680x460 pixels                                 |

### Test Strategy

1. Use `popupPage` fixture to navigate to popup
2. Wait for React hydration with appropriate locators
3. Interact with UI using Playwright's `fill()`, `click()`, `press()` actions
4. Verify storage changes via `page.evaluate()`
5. Test clipboard via `page.evaluate(() => navigator.clipboard.read())`

## Phase 4: Options Page Tests (10 tests)

**File: `e2e/options.spec.ts`**

Navigate to `chrome-extension://{extensionId}/options.html` and test settings/import/export.

| #   | Test Name                           | What It Validates                                                        |
| --- | ----------------------------------- | ------------------------------------------------------------------------ |
| 1   | `loads with sidebar navigation`     | Verify 4 sections visible (General, Import/Export, Appearance, Feedback) |
| 2   | `displays storage statistics`       | Shows bytes in use, snippet count, quota progress bars                   |
| 3   | `exports snippets to JSON`          | Click export, verify download with correct content                       |
| 4   | `imports from Clipio JSON`          | Upload valid JSON file, verify snippets imported                         |
| 5   | `imports from TextBlaze format`     | Upload TextBlaze export, verify parsed and imported                      |
| 6   | `imports from PowerText format`     | Upload PowerText export, verify parsed and imported                      |
| 7   | `toggles theme (light/dark/system)` | Switch themes, verify `documentElement.classList` changes                |
| 8   | `toggles confetti setting`          | Toggle confetti, verify persisted in storage                             |
| 9   | `hash-based navigation`             | Navigate with `#feedback`, verify correct section shown                  |
| 10  | `submits feedback form`             | Fill form, verify Sentry capture (intercept network request)             |

### Test Strategy

1. Use `optionsPage` fixture to navigate
2. Test file uploads with `page.setInputFiles()`
3. Intercept downloads with `page.waitForEvent('download')`
4. Verify theme changes via `page.evaluate(() => document.documentElement.className)`
5. Mock Sentry endpoints with `page.route()` to verify feedback submission

## Phase 5: Storage Integration Tests (8 tests)

**File: `e2e/storage.spec.ts`**

Test real browser storage with quota limits and fallback behavior.

| #   | Test Name                                    | What It Validates                                                     |
| --- | -------------------------------------------- | --------------------------------------------------------------------- |
| 1   | `persists snippets in sync storage`          | Create snippet, close/reopen popup, verify persistence                |
| 2   | `uses per-key storage layout`                | Create snippet, verify `snip:{id}` key exists in sync storage         |
| 3   | `falls back to local on sync quota overflow` | Fill sync beyond quota, verify automatic switch to local mode         |
| 4   | `updates content script cache on changes`    | Create snippet in popup, verify content script can expand immediately |
| 5   | `maintains IndexedDB shadow backup`          | Create snippet, verify IndexedDB contains backup copy                 |
| 6   | `persists storage mode selection`            | Switch to local mode, reopen extension, verify stays in local         |
| 7   | `handles concurrent writes correctly`        | Rapid create/edit/delete operations, verify data integrity            |
| 8   | `migrates legacy single-key format`          | Seed old format, verify automatic migration to per-key                |

### Test Strategy

1. Use `page.evaluate()` to directly access `browser.storage` APIs
2. Fill storage to trigger quota errors with large snippets
3. Verify fallback behavior by checking `storageModeItem`
4. Open IndexedDB directly via `page.evaluate()` to verify backup
5. Test concurrent operations with `Promise.all()`

## Phase 6: Cross-Context Communication Tests (5 tests)

**File: `e2e/messaging.spec.ts`**

Test message passing and state propagation between extension contexts.

| #   | Test Name                                      | What It Validates                                                           |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | `relays Sentry from content to background`     | Trigger error in content script, verify background forwards to Sentry       |
| 2   | `sends test message from options to content`   | Trigger Sentry test in options, verify content script receives it           |
| 3   | `propagates storage changes to content script` | Modify snippet in popup, verify content script index updates without reload |
| 4   | `shares state across multiple tabs`            | Open two tabs, create snippet in one popup, expand in both tabs             |
| 5   | `communicates via storage between contexts`    | Background sets flag, popup reads it on next open                           |

### Test Strategy

1. Intercept Sentry network requests with `page.route()`
2. Open multiple pages in same context to test multi-tab behavior
3. Use `page.waitForEvent()` to listen for storage changes
4. Verify message passing via service worker evaluation

## Total Test Count: 58 tests across 6 files

## File Structure

```
e2e/
  fixtures.ts                    # Playwright fixtures (context, extensionId, pages)
  helpers/
    test-page.html               # Controlled HTML with form fields
    storage.ts                   # Storage helper functions
    snippets.ts                  # Test snippet factory functions
  content-script.spec.ts         # Phase 1: 15 tests
  background.spec.ts             # Phase 2: 8 tests
  popup.spec.ts                  # Phase 3: 12 tests
  options.spec.ts                # Phase 4: 10 tests
  storage.spec.ts                # Phase 5: 8 tests
  messaging.spec.ts              # Phase 6: 5 tests
playwright.config.ts             # Playwright configuration
E2E_TESTING_PLAN.md             # This document
```

## Implementation Progress

### Phase 0: Infrastructure ✅

- [x] 0.1: Install `@playwright/test` dependency
- [x] 0.2: Create `playwright.config.ts`
- [x] 0.3: Create `e2e/fixtures.ts`
- [x] 0.4: Create test helper files (`test-page.html`, `storage.ts`, `snippets.ts`)
- [x] 0.5: Update `package.json` scripts
- [x] 0.6: Update CI workflow
- [x] 0.7: Update `.gitignore`
- [x] Install Chromium binary (`npx playwright install chromium`)
- [x] Create `e2e/global-setup.ts` (builds extension before tests)
- [x] Create `tsconfig.e2e.json` (Node.js types for e2e files)

### Phase 1: Content Script Tests ✅

- [x] Implement all 15 content script expansion tests

### Phase 2: Background Script Tests ✅

- [x] Implement all 8 background script tests

### Phase 3: Popup Tests ✅

- [x] Implement all 12 popup CRUD tests

### Phase 4: Options Page Tests ✅

- [x] Implement all 10 options page tests

### Phase 5: Storage Tests ✅

- [x] Implement all 8 storage integration tests

### Phase 6: Messaging Tests ✅

- [x] Implement all 5 cross-context communication tests

### Final Steps

- [ ] Run full E2E test suite locally
- [ ] Verify CI pipeline passes
- [ ] Document any known issues or flaky tests
- [ ] Commit and push all changes

## Known Challenges & Solutions

### 1. Extension Build Required Before Tests

**Challenge**: E2E tests need the extension built first (~10-15s overhead)
**Solution**: Use Playwright's `globalSetup` to run `pnpm build` once before all tests

### 2. Context Menus Cannot Be Clicked

**Challenge**: No `page.contextMenu()` API in Playwright
**Solution**: Evaluate extension APIs directly via service worker or simulate `contextMenus.onClicked` events

### 3. Clipboard Access Permissions

**Challenge**: Clipboard requires permissions and may need flags
**Solution**: Use `browserContext.grantPermissions(['clipboard-read', 'clipboard-write'])` and `--use-fake-ui-for-media-stream` flag if needed

### 4. Content Script Injection Timing

**Challenge**: Scripts inject at `document_idle`, timing is unpredictable
**Solution**: Use `page.waitForFunction()` to poll for a marker or wait for content script to set a flag

### 5. Service Worker Lifecycle

**Challenge**: MV3 service workers can terminate and restart
**Solution**: Tests should handle re-activation and verify persistence across restarts

### 6. Real Storage Quotas

**Challenge**: Sync storage has real 100KB limit, easy to hit in tests
**Solution**: Create utility to calculate snippet sizes, fill to specific thresholds for quota testing

### 7. Headless Mode Compatibility

**Challenge**: Some extension features may behave differently headless
**Solution**: Use Playwright's `channel: 'chromium'` which supports extensions in headless mode as of recent versions

## CI Strategy

- **Unit tests** (`pnpm test`): Run on every push, fast (~2s)
- **E2E tests** (`pnpm test:e2e`): Run on every push per user preference (~1-3min)
- **Separate jobs**: Unit and E2E tests run in parallel for faster CI
- **Artifact uploads**: Playwright traces/videos uploaded only on failure
- **Retry strategy**: 1 retry in CI for flaky test tolerance

## Success Criteria

- [ ] All 58 E2E tests pass locally
- [ ] All tests pass in CI (headless Chromium)
- [ ] Extension builds successfully in CI
- [ ] No flaky tests (or documented with retry strategy)
- [ ] Test execution time under 3 minutes in CI
- [ ] Playwright HTML report generated on failure
- [ ] Coverage of all critical user flows
- [ ] Documentation updated with E2E testing instructions

## Future Enhancements

- Firefox support (requires separate Playwright project)
- Visual regression testing with Playwright screenshots
- Performance benchmarks (snippet expansion latency)
- Accessibility testing with `@axe-core/playwright`
- Mobile extension testing (if applicable)
- Multi-browser testing (Edge, Opera)
- Stress testing (1000+ snippets)

## References

- [Playwright Chrome Extensions Guide](https://playwright.dev/docs/chrome-extensions)
- [WXT Framework Documentation](https://wxt.dev/)
- [Chrome Extension MV3 Service Workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers)
- [Existing Clipio Test Infrastructure](vitest.config.ts)

---

**Document Version**: 1.0  
**Last Updated**: March 11, 2026  
**Status**: Planning Complete, Implementation In Progress
