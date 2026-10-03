# Dependency major-version upgrade

## Problem

`package.json` trails the published registry on **34 direct dependencies**, and 13 of
those are behind a **major** version. Some majors are not cosmetic — `lucide-react`
1.x removed 14 exported symbols the UI imports, and TypeScript 7 removed a compiler
option three of this repo's tsconfigs set. Leaving the tree on the old majors means
the release path keeps building against versions whose upstream support window is
closing.

The request is to move every direct dependency to its latest published version,
including major bumps, and keep every gate green.

## Baseline (measured before any change, at HEAD `6da8954`)

| Gate step | State |
| --- | --- |
| `format` | pass |
| `lint` | pass |
| `types (src + e2e)` | pass |
| `unit + coverage` | **FAIL — 40 coverage-threshold errors** |
| `coverage integrity` … `spec drift` | not reached |

All **1712 unit tests across 55 files pass**. The `unit + coverage` failure is a
**pre-existing defect, not a dependency problem**: it reproduces identically at HEAD
with the committed `vitest.config.ts`, on both Node 24 (CI's version) and Node 26.

The specific pre-existing defect: commit `6da8954` set the coverage floors by
"reading Vitest's own failure output". Branch coverage is actually **~56% globally**,
not the **76.58** that commit recorded, so 40 thresholds fail. Recorded separately in
§Out of scope — this change must not be blamed for it, and must not quietly paper
over it either.

## Acceptance criteria

1. Every direct dependency in `package.json` resolves to its latest published
   version, **except** `typescript`, which is pinned to the newest version the
   toolchain supports (see criterion 2).
2. `typescript` is **6.0.3**, not 7.x. `typescript-eslint@8.71.0` declares
   `typescript >=4.8.4 <6.1.0` and **hard-throws** on TS 7:
   `typescript-eslint does not support TS 7.0`. `pnpm lint` cannot run on TS 7, so
   TS 7 is not reachable until typescript-eslint ships support. 5.9 → 6.0 is still a
   major bump.
3. `pnpm compile` passes on TS 6. Every tsconfig that set
   `"esModuleInterop": false` is changed — that value is **deprecated in TS 6.0**
   (`TS5107`) and **removed in TS 7** (`TS5108`), so it fails today and would fail
   harder on the next bump.
4. `pnpm lint` passes. `.stryker-tmp/` (a gitignored transient Stryker directory)
   is added to ESLint's global ignores: `typescript-eslint@8.71` raises
   `No tsconfigRootDir was set, and multiple candidate TSConfigRootDirs are present`
   when it walks a leftover Stryker backup dir, so a transient artifact can fail a
   gate.
5. Every `lucide-react` symbol imported under `src/` resolves under 1.49.0. Thirteen
   were removed and must be renamed to their 1.x canonical names.
6. `pnpm test:coverage` reports **no new failing threshold** relative to the 40-failure
   baseline. `@vitest/coverage-v8` 5 changes branch instrumentation, so floors that
   were wrong before may move; that is recorded explicitly, not silently absorbed.
7. `pnpm verify` passes end to end, or every remaining failure is individually traced
   to a pre-existing defect and listed in the disposition.
8. `pnpm verify:full` (build + e2e) passes.

## Edge cases

- **`esModuleInterop: false` → `true`** changes default-import interop. The configs
  already set `allowSyntheticDefaultImports: true`, so type-level behaviour is
  unchanged; `tsconfig.e2e.json` already used `true`. Verified `true` type-checks
  under **both** TS 6.0.3 and TS 7.0.2, so the fix is forward-compatible.
- **`FileJson`** has no JSON-named icon left in lucide 1.x. It must map to a real
  export, not a near-miss name.
- **Suffixed aliases** (`CheckIcon`, `ChevronDownIcon`, `MonitorIcon`, …) are gone
  from the main entry point; the unsuffixed name is the canonical one.
- **`typescript` must not be floated by a later `pnpm update --latest`**, which would
  silently reintroduce the TS 7 lint failure. The `~` range on `6.0.3` is the guard.
- **Unmet peers that pre-date this change** (`eslint-plugin-react@7.37.5` and
  `eslint-plugin-jsx-a11y@6.10.2` both cap at `eslint@9`; both are already at their
  latest published version) stay unmet. Lint passes; recorded, not fixed.

## Out of scope

- The 40 pre-existing coverage-threshold failures. Recalibrating them is a
  deliberate act under AGENTS.md and belongs in its own change. Criterion 6 only
  requires that this upgrade not **add** to the set.
- `stryker-setup-*.js` files left untracked at the repo root by a mutation run.

## Change history

- 2026-10-02 — written before any dependency was changed.