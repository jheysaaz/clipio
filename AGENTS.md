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
│   ├── workflows/           # ci.yml, publish.yml, flake-gate.yml
│   └── flake-quarantine.yml # Known e2e flakes, each with an expiry date
├── .opencode/
│   └── agent/reviewer.md    # The reviewer's contract (grounded, capped)
├── e2e/
│   ├── *.spec.ts            # Playwright E2E tests (13 specs, ~153 tests)
│   ├── fixtures.ts          # Playwright fixtures
│   ├── global-setup.ts      # Global Playwright setup
│   ├── globals.d.ts         # Ambient types for browser-context globals
│   └── helpers/             # E2E helpers (serve.mjs, storage, snippets)
├── review/
│   └── README.md            # Review disposition protocol (records rejections)
├── scripts/
│   ├── verify.mjs           # THE GATE — runs every check in order
│   ├── check-coverage-integrity.mjs
│   ├── check-spec-refs.mjs
│   ├── check-spec-drift.mjs
│   ├── flake-gate.mjs       # N-run flake classifier
│   ├── review-prep.mjs      # Builds the reviewer packet
│   ├── check-locales.mjs
│   ├── check-hardcoded-text.mjs
│   ├── dev-with-qa.mjs
│   └── dev-qa-server.mjs
├── specs/
│   ├── *.spec.md            # Module behavioural specs (47 files)
│   └── changes/README.md    # Change-request template (spec-first step)
├── src/
│   ├── assets/              # Static assets (fonts, styles)
│   ├── components/          # React components
│   │   ├── editor/          # Plate.js rich-text editor
│   │   ├── options/         # Options page (settings/panels/ in the redesign)
│   │   ├── ui/              # Base UI primitives
│   │   └── *.tsx            # Feature components
│   ├── config/constants.ts  # App constants
│   ├── entrypoints/         # WXT entrypoints (background, content, popup, options)
│   ├── hooks/               # Custom React hooks
│   ├── lib/                 # Core logic
│   │   ├── exporters/       # Export formats
│   │   ├── importers/       # Import formats (Clipio, TextBlaze, PowerText)
│   │   ├── locales/         # en.yml, es.yml
│   │   └── *.ts             # Utilities, colocated with *.test.ts
│   ├── pages/               # Page composition (Dashboard, OptionsPage)
│   ├── storage/             # Storage layer (IndexedDB, sync, local, media)
│   ├── types/               # TypeScript types
│   ├── utils/               # dateUtils, usageTracking
│   └── app.css              # Global styles
├── tests/
│   ├── setup.ts             # Vitest global setup
│   └── mocks/               # browser, i18n stubs
├── vitest.config.ts         # Vitest + coverage thresholds
├── playwright.config.ts     # Playwright (retries: 0, workers: 1)
├── stryker.config.mjs       # Mutation testing
├── wxt.config.ts            # WXT configuration
├── tsconfig.json            # TypeScript (src)
├── tsconfig.e2e.json        # TypeScript (e2e) — wired into `pnpm compile`
├── tsconfig.node.json       # TypeScript (root configs)
├── tsconfig.vitest.json     # Stryker sandbox only
├── TEST_AUDIT.md            # Historical test-suite audit
├── CONTRIBUTING.md
├── package.json
├── codecov.yml
└── LICENSE
```

---

## Development Commands

```bash
# The gate — run this before committing
pnpm verify           # Fast gate (~25s): format, lint, types, unit+coverage,
                      #   coverage integrity, locale parity, hardcoded text,
                      #   spec references, spec drift
pnpm verify:full      # Fast gate + build + e2e (~5min). What CI runs.

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

# Code Quality (individual checks — `pnpm verify` runs these in order)
pnpm lint             # ESLint
pnpm lint:fix         # ESLint + auto-fix
pnpm format           # Prettier format
pnpm format:check     # Prettier check
pnpm compile          # TypeScript type-check: src AND e2e (no emit)

# Testing
pnpm test             # Vitest unit tests (run once)
pnpm test:watch       # Vitest watch mode
pnpm test:coverage    # Vitest with coverage + thresholds
pnpm test:e2e         # Playwright E2E tests
pnpm test:e2e:headed  # Playwright headed
pnpm test:e2e:ui      # Playwright UI mode
pnpm test:e2e:debug   # Playwright debug

# Mutation testing — finds tests that cannot fail
pnpm test:mutate      # Pure-logic core, ~5min. See specs/mutation-testing.spec.md
pnpm test:mutate --mutate src/utils/dateUtils.ts   # One module, ~15s

# Flake detection — runs the e2e suite N times, classifies each test
pnpm test:flake       # 3 runs, ~12min. See .github/flake-quarantine.yml
pnpm test:flake --runs=5

# Review — generate the packet a reviewer agent works from
pnpm review:prep                     # Current HEAD
pnpm review:prep -- --sha=<commit>   # A specific commit

# Individual gates (all run by `pnpm verify`)
pnpm check:locales              # Locale parity + dead-key detection
pnpm check:hardcoded-text       # User-visible text that bypassed i18n
pnpm check:coverage-integrity   # Every configured file reached the coverage report
pnpm check:spec-refs            # Every `// spec:` file link resolves
pnpm check:spec-drift           # Specs still describe code that exists
```

> **`pnpm verify` is the gate.** A check that is not in `scripts/verify.mjs` does
> not gate anything. Do not run a subset and call it verified.

---

## Mandatory Workflow: SPEC → TEST → CODE → REVIEW

**The gate is `pnpm verify`.** The rest of this section is about producing a change
worth reviewing; the gate is what proves it.

### 1. SPEC — Write the change request first

Before any code, write `specs/changes/<slug>.md` from the template in
[`specs/changes/README.md`](specs/changes/README.md). It needs a problem, numbered
acceptance criteria, and edge cases.

**This step is a sequencing requirement, not a formality.** Over the 30 commits
before this rule was enforced, 20 changed `src/` and `specs/` in the same commit
and only 4 of 60 touched specs alone — the spec was being written as
documentation _of_ the change rather than before it. That is precisely why review
step 4 had nothing authoritative to check against, and why the reviewer started
inventing requirements.

Module-level behavioural specs live in `specs/*.spec.md`. A change request points
at them; it does not replace them.

### 2. TEST — Write tests that can fail

- Unit tests for pure logic in `src/lib/**`, `src/storage/**`, `src/utils/**`
- Component tests for React components in `src/components/**`
- E2E tests in `e2e/*.spec.ts` for user flows

Every criterion must be asserted by a **named** test, and each happy path needs a
negative test. See **Testing Standards** below — those rules are not stylistic,
they each describe a defect class found in this repo.

Verify with `pnpm test:mutate` when you touch the pure-logic core. A surviving
mutant is a behaviour your tests claim to cover and do not, which is the defect
rules 1 and 4 forbid — found by running rather than by reading.

### 3. CODE — Implement to pass the tests

Minimal, idiomatic TypeScript/React. Follow existing patterns in `src/lib/`,
`src/components/`, `src/storage/`. Path aliases: `~/*` and `@/*` → `src/*`.
Prefer pure functions in `src/lib/`; keep components thin.

**Two WXT virtual modules need care in tests.** `#i18n` is aliased to
`tests/mocks/i18n.ts`, which resolves real keys against the real `en.yml` — so
tests assert on real user-visible copy. Do not add an assertion that depends on
`i18n.t` returning a specific string unless the spec pins that string.

### 4. REVIEW — Grounded, not improvised

**Mandatory. Never skip.**

```bash
pnpm review:prep                     # writes review/<sha>.md
# hand review/<sha>.md to a fresh reviewer agent
```

The reviewer is defined in [`.opencode/agent/reviewer.md`](.opencode/agent/reviewer.md).
Read the important parts here:

- **The acceptance criteria are the definition of done.** A finding not traceable
  to a criterion, a stated spec invariant, or a security/data-loss risk in the
  code as written **is not a finding**. Spec gaps are reported separately and
  never block.
- **The reviewer does not re-run the suite.** The packet carries gate evidence.
  A full e2e run costs ~4 minutes per round.
- **Record every disposition** in `review/<sha>.md` using
  [`review/README.md`](review/README.md) — accepted _and_ rejected. A rejected
  finding with a written reason is what stops the next round re-raising it.
- **Two rounds maximum.** If a change needs a third, the change is wrong, not the
  review. Decompose or escalate to a human.
- **Diff budget: 15 files / 800 changed lines.** Over that, decompose _before_
  reviewing. `pnpm review:prep` flags it.

This shape exists because the ungrounded version failed visibly: five-plus review
rounds on one change, with several rounds whose findings were themselves false
claims ("8 MAJORs, most of them false claims"). The reviewer was not careless; it
had no definition of correct. Give it one.

### 5. VERIFY — Then merge

```bash
pnpm verify        # ~25s, fast gate
pnpm verify:full   # ~5min, what CI runs on the change
```

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
- See **Testing Standards** below for the mandatory test-quality rules

### Spec Reference

See `specs/` for behavioral specifications covering all modules.

### Git & Commits

- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`
- One logical change per commit
- No direct pushes to `main` — use PRs

---

## Testing Standards

> Derived from the test-suite audit (`TEST_AUDIT.md`). Every rule below was a
> real defect class found in the audit. Follow these when adding or modifying
> tests.

### Rules

1. **Assert on behavior, not on local string math.** Never re-implement a
   function's logic inside the test and assert the result of your own
   re-import. Import the production function and assert its output.

   ```ts
   // BAD — decorative
   const isSafe = !url.startsWith("javascript:");
   expect(isSafe).toBe(false);

   // GOOD — exercises real code
   import { sanitizeUrl } from "./markdown";
   expect(sanitizeUrl("javascript:alert(1)")).toBe("");
   ```

2. **Prefer stable selectors over copy / structure.** E2E must prefer, in
   order: `data-testid` → ARIA role + accessible name → stable attribute
   (`name`, `type`, `aria-label`). Avoid:
   - `:has-text("…")` container matching
   - `textContent("body").includes(…)` as the primary signal
   - nth-child / nth-of-type positional nav selectors
   - Copy-keyed navigation when a testid exists (`options-nav-*`)

   A `data-testid` under e2e coverage may not be removed or repurposed
   without updating its test in the same PR (`specs/e2e-suite.spec.md`).

3. **No vacuous or `expect(true).toBe(true)` fallbacks.** If a precondition
   fails (e.g. fewer list items than expected), fail loudly with a real
   assertion. Silent `else { expect(true).toBe(true) }` branches hide
   regressions.

   ```ts
   // BAD
   if (count >= 2) { … } else { expect(true).toBe(true); }

   // GOOD
   await expect(listItems).toHaveCount(2, { timeout: 5_000 });
   ```

4. **Every feature needs a negative test.** For each happy path, cover at
   least one: rejected input, thrown error, blocked security path, or absent
   resource. Known gaps that were filled:
   - `sanitizeUrl`: mixed-case `JaVaScRiPt:`, protocol-relative `//evil`,
     unknown schemes
   - TextBlaze: HTML conversion throw → falls back to `text` field
   - Sentry relay: foreign `sender.id`, empty envelope, missing/malformed DSN

5. **Assert something specific.** `expect(pageText).toBeTruthy()` and
   `expect(body).toBeVisible()` alone are weak. Pair a smoke assertion with
   a behavioral one (storage change, role attribute flip, filtered list
   contents, download filename).

6. **No non-determinism.**
   - Restore globals you stub (`fetch`, timers) in `afterEach` / `finally`.
   - Prefer auto-retrying Playwright assertions over `waitForTimeout`.
   - Never leave `vi.fn()` replacements of `global.fetch` un-restored across
     tests.
   - No fake clocks unless the unit under test accepts an injected clock.

7. **No redundant tests.** One behavioral claim → one test. Do not assert the
   same property twice with different wording (e.g. three `exportedAt` tests
   for one function). Fold overlapping suites instead of maintaining
   parallel copies.

8. **No comments that overclaim.** Do not write "verified against the built
   stylesheet" when the test only checks class strings. Comments must
   describe what the test actually proves.

9. **Tests must import the code under test.** A test file that imports only
   `vitest` and asserts literals is decorative. Every test file must import
   (or e2e must drive) the production module it claims to cover. Page-level
   a11y is covered by e2e axe scans (`AxeBuilder` in `popup.spec.ts` /
   `options.spec.ts`), not by placeholder unit files.

10. **Spec alignment.**
    - Prefer spec-derived tests (`specs/*.spec.md` → `// spec:` comments).
    - When impl and spec disagree, fix the impl or flag the discrepancy in
      the spec — never silently encode the buggy behavior as "expected".

11. **Coverage exclusions need a written reason.** Modules with tests should
    not be blanket-excluded in `vitest.config.ts` without a justification
    comment (see the `coverage.exclude` list).

12. **CI: prefer `retries: 0` locally.** Investigate any CI retry as a flake
    bug, not as noise to suppress. Detection lives in a separate job
    (`pnpm test:flake`), never in a retry.

13. **A surviving mutant is a rule 1 / rule 4 violation.** Run
    `pnpm test:mutate` when changing the pure-logic core. Coverage cannot tell
    you whether a test asserts; mutation testing can. It has already caught
    something coverage hid — `serialization.ts` reads 95.1% coverage and scores
    73.8% under mutation, with 67 mutants in code the line metric calls covered.
    See [`specs/mutation-testing.spec.md`](specs/mutation-testing.spec.md).

14. **A spec reference must resolve.** `// spec: specs/foo.spec.md#anchor`
    is machine-checked by `check:spec-refs`. A dead link asserts traceability
    that does not exist, and renaming a heading breaks it silently. Free-form
    prose (`// spec: MUST …`) is allowed but not checked.

15. **A spec must describe code that exists.** `check:spec-drift` fails when a
    spec's `> Source:` file is gone or a documented symbol is no longer exported.
    When it fires, fix the spec or record the change in its Change History — do
    not delete the criterion.

### Required checks

```bash
pnpm verify        # everything below, in order, ~25s
pnpm verify:full   # + build + e2e, ~5min
```

Individually: `format:check` · `lint` · `compile` (src **and** e2e) ·
`test:coverage` · `check:coverage-integrity` · `check:locales` ·
`check:hardcoded-text` · `check:spec-refs` · `check:spec-drift`.

### Coverage thresholds are ratchets, not targets

The numbers in `vitest.config.ts` are set to each scope's **true current
measurement** — for a `src/**` glob, the aggregate across every file it matches,
which is how Vitest applies it, not the printed report row — and the suite fails if
any of them regresses. They are lower than
the 80/80/75/80 they used to be, because those described 46 files while the
config asked for 50 — four components were being silently dropped from the
report, so the bar excluded exactly the files with no tests.

`scripts/check-coverage-integrity.mjs` now fails the build if that ever happens
again. Raising a threshold is a deliberate act, done when real tests land.

Current honest values: global **81 / 73 / 76 / 81** over 50 files, plus
per-directory floors of `src/lib/**` 93/91/92/87 and `src/storage/**` 95/88/93/90
(lines/functions/statements/branches).

**`src/components/**` has a floor of 3% because four components have no tests
at all.** That is a tracked gap in
[`specs/coverage-honesty.spec.md`](specs/coverage-honesty.spec.md), not a passing
grade. Writing those tests is the highest-value outstanding work in the repo.

---

## CI Pipeline (`.github/workflows/ci.yml`)

| Job                | Runs                          | Gates a merge? |
| ------------------ | ----------------------------- | -------------- |
| `gate`             | `pnpm verify`                 | **yes**        |
| `mutation`         | `pnpm test:mutate`            | **yes**        |
| `e2e-tests`        | `pnpm test:e2e`               | **yes**        |
| `build-validation` | `pnpm zip` (Chrome + Firefox) | **yes**        |

`flake-gate.yml` runs weekly and on demand. It is **not** a required check — a red
main from a known flake is worse than a visible one. See
[`.github/flake-quarantine.yml`](.github/flake-quarantine.yml).

`publish.yml` runs the **same** `pnpm verify` gate as CI. The previous version
reimplemented the checks piecemeal, which is how the release path drifted from
what had been verified on main.

**`retries: 0` everywhere, permanently.** Flake detection is a separate job
(`pnpm test:flake`) rather than a retry, so a race can be found without being
hidden. A test that fails ≥2 of 3 runs is a flake and fails the flake gate; a
test that fails 3/3 is a real failure and fails the ordinary e2e job.

---

## Extension Architecture (WXT / MV3)

| Entrypoint      | Purpose                                                            |
| --------------- | ------------------------------------------------------------------ |
| `background.ts` | Service worker: storage sync, alarms, context menus, notifications |
| `content.ts`    | Content script: snippet expansion, text injection                  |
| `popup/`        | Popup UI (React)                                                   |
| `options/`      | Options page (React)                                               |

**Storage:**

- `indexedDB` (via `idb`) — primary storage for snippets, settings, debug logs
- `chrome.storage.sync` — sync settings across devices

**Messaging:** Defined in `src/lib/messages.ts` (type-safe message passing)

---

## Key Libraries

| Area                | Library                                  |
| ------------------- | ---------------------------------------- |
| Extension Framework | WXT (v0.20)                              |
| UI Framework        | React 19 + Radix UI / Base UI            |
| Rich Text Editor    | Plate.js (Slate-based)                   |
| Styling             | Tailwind CSS v4                          |
| i18n                | @wxt-dev/i18n                            |
| Error Tracking      | Sentry                                   |
| Testing (Unit)      | Vitest + happy-dom + @vitest/coverage-v8 |
| Testing (E2E)       | Playwright + @axe-core/playwright        |
| Linting             | ESLint + TypeScript ESLint + Prettier    |
| Build               | Vite (via WXT) + TypeScript              |

---

## Agent Instructions

When asked to implement a feature or fix:

1. **Write the change request first** — `specs/changes/<slug>.md`, with numbered
   acceptance criteria. Before any code.
2. **Write tests first** — one per acceptance criterion, plus a negative test for
   each happy path.
3. **Implement** the minimum that passes them.
4. **Run `pnpm verify`**. Fix what it reports; do not run a subset.
5. **Generate the review packet** — `pnpm review:prep` — and hand it to a fresh
   reviewer agent following `.opencode/agent/reviewer.md`.
6. **Record every disposition** in `review/<sha>.md`, including rejections.
7. **Run `pnpm verify:full`** before declaring done.

**Never skip the review step, and never skip `pnpm verify`.**

If the change grows past 15 files or 800 changed lines, stop and decompose it
before reviewing. `review:prep` will tell you when you are over.

### Two things worth knowing before you start

- **Coverage numbers here are ratchets.** They will fail on regression, and
  raising them is a deliberate act. A failing threshold means something
  genuinely got less covered — do not adjust the number to make it pass.
- **Four components have no tests** (`ConfirmDialog`, `ImportWizard`,
  `NewSnippetView`, `SnippetDetailView`). They are now measured and visible
  rather than silently dropped. Writing those tests is the highest-value
  outstanding work in this repo.
