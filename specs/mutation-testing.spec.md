# Mutation Testing on the Pure-Logic Core

> Added by `specs/coverage-honesty.spec.md`'s follow-on work. Records what
> mutation testing found that coverage could not.

## Problem

This repo has an unusually mature anti-decorative-test culture, and every part of
it was discovered **by a human reading tests**:

- `TEST_AUDIT.md`
- AGENTS.md Testing Standards rules 1, 3, 4, 8, 9 — never re-implement a
  function's logic inside a test; no vacuous branches; every feature needs a
  negative test; no overclaiming comments; tests must import the code under test
- `specs/test-honesty.spec.md` — an entire spec titled _"remove the tests that
  cannot fail"_
- commit `c339b04 test: remove the tests that cannot fail`

That process does not scale and does not repeat. It runs when someone chooses to
run it, and stops silently the moment nobody does. Meanwhile the coverage gate
says nothing about whether a test _asserts_ — it only measures which lines
execute. A test can execute every line of a function and still assert nothing
about it.

## Solution

Stryker mutates the source — flips `>` to `>=`, removes a null guard, negates a
boolean, changes a string constant — and reports which mutants **survived**.

A surviving mutant is a behaviour the tests claim to cover and do not. That is
rule 1 and rule 4 violations, found by running something rather than by reading
everything.

## Scope, and why it is narrow

The mutation scope is the pure-logic core — the same modules `vitest.config.ts`
already holds to 85–95% coverage:

```
src/utils/dateUtils.ts            src/utils/usageTracking.ts
src/types/index.ts                src/lib/markdown.ts
src/lib/content-helpers.ts        src/lib/sentry-scrub.ts
src/lib/exporters/clipio.ts       src/lib/importers/{clipio,detect,powertext,textblaze}.ts
src/lib/update-checker.ts         src/lib/review-prompt.ts
src/components/editor/serialization.ts
src/storage/{normalize,types,quota-preflight}.ts
```

Deliberately **not** the React components. Mutation testing them would mean
rendering them in tests — a different and much larger project — and would produce
thousands of surviving mutants nobody would act on.

## Result — first full run

**81.00% mutation score, 5m16s, threshold 80%.**

| File                   | Score    | Killed | Survived | No cov |
| ---------------------- | -------- | ------ | -------- | ------ |
| `dateUtils.ts`         | 100.0    | 81     | 0        | 0      |
| `normalize.ts`         | 100.0    | 1      | 0        | 0      |
| `types/index.ts`       | 100.0    | 4      | 0        | 0      |
| `exporters/clipio.ts`  | 94.7     | 36     | 2        | 0      |
| `importers/detect.ts`  | 94.7     | 89     | 5        | 0      |
| `content-helpers.ts`   | 89.9     | 125    | 13       | 1      |
| `quota-preflight.ts`   | 89.4     | 42     | 5        | 0      |
| `markdown.ts`          | 91.2     | 136    | 15       | 0      |
| `storage/normalize.ts` | 100.0    | 1      | 0        | 0      |
| `usageTracking.ts`     | **63.6** | 21     | **10**   | 2      |
| `serialization.ts`     | **73.8** | 557    | **138**  | **67** |
| `sentry-scrub.ts`      | **79.6** | 162    | **43**   | 0      |
| `powertext.ts`         | **75.0** | 81     | **26**   | 1      |
| `textblaze.ts`         | **77.8** | 83     | **22**   | 2      |
| `review-prompt.ts`     | **76.9** | 60     | **17**   | 1      |

### What this found that coverage did not

`serialization.ts` reports **95.1% statement coverage** in
`vitest.config.ts` and holds a 90% per-module threshold. Under mutation testing
it scores **73.8%**, with **67 mutants classified "no coverage"** — code that
coverage's own line metric calls covered, where no test actually distinguishes
the correct output from the mutated one.

That is precisely the gap rules 1 and 4 describe, discovered by running rather
than by reading. It is the concrete argument for this tool in this repo.

`usageTracking.ts` at 63.6% is the weakest module in scope.

## Running it

```bash
pnpm test:mutate                                       # full core, ~5min
pnpm test:mutate --mutate src/utils/dateUtils.ts       # one module, ~15s
```

Note there is **no `--` separator** — pnpm forwards flags to the Stryker CLI
directly, and inserting one makes it read the flags as positional arguments
(`error: too many arguments for 'run'`).

## Threshold

A ratchet, like the coverage numbers: `high: 80`, `low: 60`, `break: null`. The
first full run landed at 81.00%, so the gate is already meaningful and does not
need to be lowered to pass.

## Implementation notes worth keeping

Three things had to be right, and each is a trap:

1. **`inPlace: true`.** Stryker builds its sandbox by copying files while
   respecting `.gitignore`. `.wxt/` is gitignored (correctly — `wxt prepare`
   regenerates it), so it was never copied — but `tsconfig.json`, which _is_
   copied, opens with `"extends": "./.wxt/tsconfig.json"`, and Vite resolves
   `extends` per-file. Every source file in the sandbox failed to resolve it and
   **all 54 test suites failed to load before a single mutant was generated**.
   `inPlace` writes mutants to the real tree, where `.wxt/` is present exactly as
   for every other command. Stryker restores the originals afterwards.

   The tempting alternative — un-ignoring `.wxt/` in `.gitignore` — would put
   seven generated build artifacts under version control. Verified and rejected.

2. **Do not install the package named `stryker`.** It resolves to an unrelated
   package last published around 2018 (v0.35.1) that shadows the real CLI and
   fails with 54/54 test failures and a confusing tsconfig error. The CLI ships
   inside `@stryker-mutator/core`.

3. **The `vitest` config block is strict.** Stryker 10 accepts only `dir`,
   `related` and `configFile`. Passing `pool`, `poolOptions` or `tsconfigFile`
   is a hard validation error.

## Change History

| Date       | Change                                                 | Author |
| ---------- | ------------------------------------------------------ | ------ |
| 2026-10-02 | Stryker added; first full run 81.00% over 2160 mutants | —      |
