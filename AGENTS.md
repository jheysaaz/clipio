# AGENTS.md — Clipio Agent Instructions

## Project Overview

**Clipio** — A browser extension for managing and inserting text snippets with lightning speed.

- **Framework**: React 19 + TypeScript + WXT (Web Extension Tools)
- **Package Manager**: pnpm
- **Testing**: Vitest (unit) + Playwright (E2E)
- **Styling**: Tailwind CSS v4 + Radix UI / Base UI
- **Editor**: Plate.js (Plate.js/Slate) for rich-text snippets

---

## Project Structure

```
clipio/
├── .github/
│   └── workflows/           # CI/CD workflows (ci.yml, publish.yml)
├── .opencode/               # Opencode configuration (if any)
├── e2e/
│   ├── *.spec.ts            # Playwright E2E tests
│   ├── fixtures.ts          # Playwright fixtures
│   ├── global-setup.ts      # Global Playwright setup
│   └── helpers/             # E2E test helpers (servers, pages, snippets)
├── scripts/
│   ├── dev-with-qa.mjs      # Dev server with QA server
│   ├── dev-qa-server.mjs    # Static server for QA pages
│   └── check-locales.mjs    # Locale validation script
├── src/
│   ├── assets/              # Static assets (fonts, styles)
│   ├── components/          # React components
│   │   ├── editor/          # Plate.js rich-text editor components
│   │   ├── options/         # Options page components
│   │   ├── ui/              # Base UI components (Radix/Base UI)
│   │   └── *.tsx            # Feature components (Dashboard, SnippetList, etc.)
│   ├── config/
│   │   └── constants.ts     # App constants
│   ├── entrypoints/         # WXT entrypoints
│   │   ├── background.ts    # Service worker (MV3)
│   │   ├── content.ts       # Content script
│   │   ├── popup/           # Popup UI
│   │   └── options/         # Options page
│   ├── hooks/               # Custom React hooks
│   ├── lib/                 # Core library / business logic
│   │   ├── exporters/       # Export formats (Clipio format)
│   │   ├── importers/       # Import formats (Clipio, TextBlaze, PowerText)
│   │   ├── *.ts             # Core utilities (markdown, snippets, giphy, sentry, etc.)
│   │   └── *.test.ts        # Unit tests colocated with source
│   ├── pages/               # Page components (Dashboard, etc.)
│   ├── storage/             # Storage layer (IndexedDB, chrome.storage.sync)
│   │   ├── backends/        # Storage backends (IndexedDB, chrome.storage.sync, local)
│   │   ├── items.ts         # Storage item definitions
│   │   └── manager.ts       # Storage manager
│   ├── types/               # TypeScript types
│   ├── utils/               # Utility functions
│   ├── app.css              # Global styles
│   └── lib/messages.ts      # i18n messages
├── tests/
│   └── setup.ts             # Vitest global setup
├── vitest.config.ts         # Vitest configuration
├── vitest.config.ts         # Playwright configuration
├── wxt.config.ts            # WXT configuration
├── tsconfig.json            # TypeScript config
├── tsconfig.node.json       # Node TypeScript config
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── codecov.yml
├── components.json          # shadcn/ui config
├── .prettierrc
├── .prettierignore
├── .gitignore
├── .env.example
└── LICENSE
```

---

## Development Commands

```bash
# Development
pnpm dev              # Start dev with QA server (background + content + popup)
pnpm dev:wxt          # Start WXT dev server only
pnpm dev:qa-server    # Start QA static server only
pnpm dev:firefox      # Start Firefox dev build

# Building
pnpm build            # Production build (Chrome MV3)
pnpm build:firefox    # Production build (Firefox MV3)
pnpm zip              # Create Chrome extension zip
pnpm zip:firefox      # Create Firefox extension zip

# Code Quality
pnpm lint             # ESLint
pnpm lint:fix         # ESLint + auto-fix
pnpm format           # Prettier format
pnpm format:check     # Prettier check
pnpm compile          # TypeScript type-check (no emit)

# Testing
pnpm test             # Vitest unit tests (run once)
pnpm test:watch       # Vitest watch mode
pnpm test:coverage    # Vitest with coverage
pnpm test:e2e         # Playwright E2E tests
pnpm test:e2e:headed  # Playwright headed
pnpm test:e2e:ui      # Playwright UI mode
pnpm test:e2e:debug   # Playwright debug
```

---

## Mandatory Workflow: SPEC → TEST → CODE → REVIEW

### 1. SPEC — Write the Spec First
Before writing any code, create a **specification** (markdown or inline comments) that defines:
- **What** the feature/fix does (user-facing behavior)
- **Why** it's needed (problem statement)
- **How** it should behave (edge cases, error states, edge cases)
- **Acceptance criteria** (testable outcomes)

**Template:**
```markdown
## Spec: [Feature/Fix Name]

### Problem
[What problem does this solve?]

### Solution
[High-level approach]

### Acceptance Criteria
- [ ] Criterion 1 (testable)
- [ ] Criterion 2 (testable)
- [ ] Edge case handled

### Edge Cases
- [ ] Edge case 1
- [ ] Edge case 2
```

### 2. TEST — Write Tests First (TDD)
- Write **unit tests** (Vitest) for pure logic in `src/lib/**/*.test.ts` and `src/utils/**/*.test.ts`
- Write **component tests** for React components in `src/components/**/*.test.tsx`
- Write **E2E tests** (Playwright) in `e2e/*.spec.ts` for user flows
- **Coverage thresholds** (enforced in CI):
  - Global: 80% lines/functions/statements, 75% branches
  - Critical modules: 85-95% (see `vitest.config.ts` thresholds)
- Run `pnpm test:coverage` locally before pushing

### 3. CODE — Implement to Pass Tests
- Write minimal, idiomatic TypeScript/React code
- Follow existing patterns in `src/lib/`, `src/components/`, `src/storage/`
- Use path aliases: `~/*` or `@/*` → `src/*`
- Prefer pure functions in `src/lib/`; keep components thin
- Run `pnpm compile` (type-check) and `pnpm lint` before committing

### 4. REVIEW — Independent Code Review (Required)
**Mandatory: Use a separate agent for review.**
- Spawn a fresh agent (`subagent_type: "general"`) to review your changes
- Reviewer must:
  - Verify tests pass (`pnpm test`, `pnpm test:coverage`, `pnpm test:e2e`)
  - Verify types pass (`pnpm compile`)
  - Verify lint passes (`pnpm lint`)
  - Check spec adherence (all acceptance criteria met)
  - Check code style, naming, patterns match codebase
  - Check test coverage meets thresholds
  - Look for edge cases, error handling, security issues
- Only merge after reviewer approves

---

## Code Style & Conventions

### TypeScript
- Strict mode enabled (`tsconfig.json`)
- Use `type` over `interface` for unions/intersections
- Prefer `type` imports: `import type { Foo } from "..."`
- Path aliases: `~/*` or `@/*` → `src/*`

### React
- Functional components with hooks
- Colocate tests: `Component.tsx` + `Component.test.tsx`
- Accessibility: use `@axe-core/playwright` in E2E, `@testing-library/react` in unit

### Testing
- **Unit**: `src/**/*.test.ts(x)` — pure logic, utilities, hooks
- **Component**: `src/components/**/*.test.tsx` — React Testing Library
- **E2E**: `e2e/*.spec.ts` — Playwright with extension loaded
- Colocate tests next to source when possible

### Spec Reference

See `specs/` for behavioral specifications covering all modules.

### Git & Commits
- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`
- One logical change per commit
- No direct pushes to `main` — use PRs

---

## CI Pipeline (`.github/workflows/ci.yml`)

1. **Install** → `pnpm install --frozen-lockfile`
2. **Lint** → `pnpm lint`
3. **Type-check** → `pnpm compile`
4. **Unit Tests** → `pnpm test:coverage` (with thresholds)
5. **Build** → `pnpm build` (Chrome + Firefox)
6. **E2E Tests** → `pnpm test:e2e` (Playwright with built extension)

All steps must pass for PR to merge.

---

## Extension Architecture (WXT / MV3)

| Entrypoint | Purpose |
|------------|---------|
| `background.ts` | Service worker: storage sync, alarms, context menus, notifications |
| `content.ts` | Content script: snippet expansion, text injection |
| `popup/` | Popup UI (React) |
| `options/` | Options page (React) |

**Storage:**
- `indexedDB` (via `idb`) — primary storage for snippets, settings, debug logs
- `chrome.storage.sync` — sync settings across devices

**Messaging:** Defined in `src/lib/messages.ts` (type-safe message passing)

---

## Key Libraries

| Area | Library |
|------|---------|
| Extension Framework | WXT (v0.20) |
| UI Framework | React 19 + Radix UI / Base UI |
| Rich Text Editor | Plate.js (Slate-based) |
| Styling | Tailwind CSS v4 |
| i18n | @wxt-dev/i18n |
| Error Tracking | Sentry |
| Testing (Unit) | Vitest + happy-dom + @vitest/coverage-v8 |
| Testing (E2E) | Playwright + @axe-core/playwright |
| Linting | ESLint + TypeScript ESLint + Prettier |
| Build | Vite (via WXT) + TypeScript |

---

## Agent Instructions

When asked to implement a feature/fix:
1. **First**: Write a SPEC (markdown file or detailed comment) with acceptance criteria
2. **Second**: Write failing tests (unit + E2E if user-facing)
3. **Third**: Implement minimal code to pass tests
4. **Fourth**: Run `pnpm test:coverage && pnpm compile && pnpm lint`
5. **Fifth**: Spawn a review agent to verify all checks pass and spec is met

**Never skip the review step.** Spawn a separate agent for review.