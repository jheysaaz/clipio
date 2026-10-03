# AGENTS.md

Notes for working on Clipio. Not a tutorial — the [README](./README.md) covers
setup, and [`docs/architecture.md`](./docs/architecture.md) covers how it is built.

## Commands

```bash
pnpm verify        # the gate — format, lint, types, unit+coverage, locale/i18n checks
pnpm verify:full   # + build + e2e. What CI runs.
pnpm test:watch    # unit tests, watching
pnpm test:e2e      # e2e only
pnpm dev           # dev build with the QA page
```

**`pnpm verify` is the gate.** A check not in `scripts/verify.mjs` gates nothing.
Do not run a subset and call it verified.

## Structure

```
src/lib/         pure logic — no DOM, no browser APIs. Where the tests are.
src/storage/     backends (sync, local, indexeddb, media) + manager
src/components/  React. Thin — logic belongs in lib/.
src/pages/       page composition
src/entrypoints/ background, content, popup, options
e2e/             Playwright. Only what needs a real browser.
docs/decisions/  why things are the way they are — read before changing them
```

WXT owns the entrypoint layout. Don't restructure it.

## Conventions

- Tests colocated: `foo.ts` → `foo.test.ts`.
- `#i18n` is aliased in `vitest.config.ts` to a stub reading the real `en.yml`, so
  tests assert on real copy. `check:hardcoded-text` enforces the same in source.
- Path aliases `~/*` and `@/*` both resolve to `src/*`.
- Prefer `type` over `interface`; `import type` for type-only imports.

## Testing rules

Each of these came from a real defect in this repo, not from theory.

1. **A test must import the code it claims to test.** Asserting on a value the test
   built itself proves nothing.
2. **Every feature needs a negative test** — rejected input, thrown error, blocked
   path, or absent resource.
3. **No conditional branches that swallow a test.** `if (guard) {…} else
   { expect(true).toBe(true) }` hides regressions. Make the guard an assertion.
4. **E2E selects by `data-testid` → ARIA role + name → stable attribute.** Never by
   literal UI copy, never by `:has-text()` containers, never by position.
   Changing a copy string must not break a test.
5. **Restore what you stub** — `fetch`, timers, storage — in `afterEach`.
6. **Prefer auto-retrying Playwright assertions** over `waitForTimeout`.
7. **Comments in tests describe what the test proves**, not what you hoped it
   proves.
8. **`retries: 0`, permanently.** A retry hides a flake instead of fixing it.
   Detection is `pnpm test:flake`. See
   [0005](docs/decisions/0005-zero-test-retries.md).
9. **When the app looks wrong, say so — do not adapt the test to it.** Loosening an
   assertion, adding a timeout, or switching to a stabler selector to reach green
   is the one move that makes a suite worthless. Flag it for a human instead.
10. **A `data-testid` an e2e test selects on is a contract.** Renaming or
    repurposing one means updating the test in the same change. Anything touching
    visible copy or a component's DOM runs `pnpm test:e2e` before it lands.

## Coverage

**80% across all code, enforced.** `scripts/check-coverage-integrity.mjs` fails if
any configured file is missing from the report — that check exists because four
components were silently dropped and the gate stayed green.

Thresholds are a **ratchet**: they fail on regression. Raising one is deliberate;
adjusting one to make a red build pass is not. Excluding a file needs a written
reason in `vitest.config.ts`.

**Never lower a threshold, for any reason.** Not to make a build pass, not
because a refactor "temporarily" reduced coverage, not to silence a flaky test.
A lower number is invisible in review and permanent in effect: the next person
reads the gate as evidence and has no way to know it used to be higher. If
coverage genuinely cannot be restored, the fix is a test or a deletion — not a
smaller number. A deleted file lowers the denominator honestly; a lowered
threshold just stops measuring.

The floor is flat 80% on all four metrics. Do not let branches or functions sit
below it — the repo briefly ran 73/76 there while claiming an 80% floor, which
is the same dishonesty as reporting green over a smaller file set.

## Git

Conventional commits, one logical change per commit. PR, not a direct push to
`main`.

## Boundaries

**Always** — run `pnpm verify` before calling anything done.

**Ask first** — adding a dependency · changing a coverage threshold · changing a
documented decision in `docs/decisions/` · changing a snapshot.

**Never** — lower a coverage threshold · add a test retry · delete a failing test
without understanding why it fails · weaken an assertion to make a test pass.