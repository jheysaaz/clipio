# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
pnpm dev                  # Chrome dev server with hot-reload
pnpm dev:firefox          # Firefox dev server

# Build
pnpm build                # Build unpacked Chrome extension
pnpm zip                  # Package as ZIP for Chrome Web Store

# Type checking & formatting
pnpm compile              # TypeScript type check (no emit)
pnpm format:check         # Check Prettier formatting
pnpm format               # Auto-format all code

# Unit tests
pnpm test                 # Run once
pnpm test:watch           # Watch mode
pnpm test:coverage        # With per-module coverage thresholds (enforced)

# Run a single test file
pnpm test src/lib/snippetUtils.test.ts

# E2E tests (Playwright — builds extension first)
pnpm test:e2e
pnpm test:e2e:headed      # Watch the browser
pnpm test:e2e:ui          # Playwright UI
```

## Architecture

Clipio is a **Manifest V3 browser extension** built with [WXT](https://wxt.dev/), React 19, Tailwind CSS v4, and TypeScript. The extension has four runtime contexts:

| Context | Entry | Role |
|---|---|---|
| Background service worker | `src/entrypoints/background.ts` | Storage orchestration, alarms, context menu, Sentry relay |
| Content script | `src/entrypoints/content.ts` | Detects shortcut triggers on web pages, expands snippets |
| Popup | `src/entrypoints/popup/` | Quick access UI |
| Options page | `src/entrypoints/options/` | Settings, import/export, developers tools |

### Storage Layer (`src/storage/`)

Three-tier backend with automatic fallback:
1. **SyncBackend** — `browser.storage.sync` (primary; syncs across devices)
2. **LocalBackend** — `browser.storage.local` (fallback when sync quota exceeded)
3. **IndexedDBBackend** — Shadow backup (fire-and-forget disaster recovery)

`StorageManager` (`src/storage/manager.ts`) orchestrates all backends. Snippets are stored per-key as `snip:<id>`. On `StorageQuotaError`, the manager transparently switches from sync to local. All backends are mocked in `tests/mocks/browser.ts` for unit tests.

### Rich Text Pipeline

Snippets are stored as Markdown. The editor (Plate.js / Slate) works with a JSON AST. `src/components/editor/serialization.ts` handles bidirectional Markdown ↔ JSON conversion. `src/lib/content-helpers.ts` handles expansion: template variable substitution, cursor positioning, and insertion into the active DOM element.

### Message Passing

Background ↔ Content communication uses `browser.runtime.sendMessage()` with typed contracts defined in `src/lib/messages.ts`.

## Spec-Driven Development (SDD) + TDD

This is the core workflow for all behavioral changes:

```
1. SPEC   — Update specs/<module>.spec.md
2. TEST   — Write failing tests for each MUST clause
3. CODE   — Implement until tests pass
4. REVIEW — PR must include spec + tests + implementation
```

- Every `MUST` clause in a spec → at least one test
- Tests reference their spec: `// spec: <module>.spec.md#section`
- When behavior changes: update **spec first**, then tests, then code
- Spec index and coverage targets: `specs/README.md`

## Testing Conventions

**Unit tests** (Vitest + happy-dom):
- Co-located with source: `src/**/*.test.ts`
- Global mocks in `tests/setup.ts` (browser API, WXT storage, Sentry, canvas-confetti)
- Per-module coverage thresholds are enforced — see `vitest.config.ts`
- Path alias `~` maps to `src/` (matches WXT's tsconfig alias)

**E2E tests** (Playwright):
- `e2e/global-setup.ts` builds the extension before running
- Tests load the real extension into Chromium via `--load-extension`
- An HTTP server at `localhost:7777` serves test pages (`e2e/helpers/serve.mjs`) — required because content scripts don't work on `file://` URLs
- Fixtures in `e2e/fixtures.ts` provide the extension context

## PR Checklist

Before opening a PR, verify:
- [ ] `pnpm compile` passes
- [ ] `pnpm format:check` passes
- [ ] `pnpm test` passes
- [ ] `pnpm test:coverage` shows no threshold violations
- [ ] Spec updated if behavior changed
- [ ] New browser API calls have mocks in `tests/mocks/`
