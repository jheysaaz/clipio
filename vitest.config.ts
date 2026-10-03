import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    // Use happy-dom for lightweight DOM support (DOMParser, document.createElement, etc.)
    environment: "happy-dom",

    // Test file patterns
    //
    // `scripts/` is included because the gate scripts carry real logic — the
    // coverage-integrity glob compiler, for one — and a gate that is itself
    // untested is exactly the kind of thing these Testing Standards exist to
    // prevent. Scoped to `*.test.ts` so the `.mjs` gates are not swept up.
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "tests/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],

    // Global setup file for browser API mocks
    setupFiles: ["tests/setup.ts"],

    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "lcov", "html"],
      reportsDirectory: "coverage",

      // Files to include in coverage analysis
      include: ["src/**/*.ts", "src/**/*.tsx"],

      // Coverage exclusions — every entry carries a written reason
      // (AGENTS.md Testing Standards rule 11: no blanket excludes without
      // justification).
      exclude: [
        // Thin entrypoint wiring — exercised end-to-end by Playwright specs
        "src/entrypoints/**",
        // Generic UI primitives — covered by e2e axe scans, not unit logic
        "src/components/ui/**",
        // Editor presentation shells (serialization.ts is NOT excluded and is
        // unit-tested at its own threshold)
        "src/components/editor/RichTextEditor.tsx",
        "src/components/editor/plugins.ts",
        "src/components/editor/index.ts",
        "src/components/editor/components/**",
        // Styles / assets / generated types — no executable branches
        "src/app.css",
        "src/assets/**",
        "src/**/*.d.ts",
        // Test scaffolding
        "src/**/__mocks__/**",
        // React glue — covered indirectly through components and e2e
        "src/hooks/**",
        // Page composition — covered by e2e specs
        "src/pages/**",
        // Options UI — covered by e2e options/image-gif specs
        "src/components/options/**",
        // Static constants
        "src/config/**",
        // Side-effectful Sentry SDK bootstrap (init runs on import)
        "src/lib/sentry.ts",
        // Static manifest fields
        "src/lib/manifest.ts",
        // Trivial class-merge helper (shadcn cn-style)
        "src/lib/utils.ts",
        // Re-export barrel / browser-API wrapper — coverage debt: unit tests
        // not yet written, exercised only via e2e integration paths.
        // (indexeddb.ts was here too and no longer is: the disaster-recovery
        // path is now unit-tested against fake-indexeddb.)
        "src/storage/index.ts",
      ],

      // Per-module coverage thresholds
      // Vitest v4 supports thresholds per file/glob via the `thresholds` object.
      thresholds: {
        // ------------------------------------------------------------------
        // Global minimum — a RATCHET, not a target.
        //
        // These numbers are LOWER than the 80/80/75/80 they replaced, and that
        // is a deliberate correction rather than a relaxation. The old figures
        // were computed over 46 files because four `.tsx` components were
        // being silently dropped from the report (see the `#i18n` alias below
        // and `scripts/check-coverage-integrity.mjs`). They described 46 files
        // while the config asked for 50.
        //
        // With the real file set — all 50, including four at 0% — the honest
        // measurement is 81.76 / 73.94 / 76.58 / 81.76. Setting the bar to the
        // true number means the suite now fails if coverage REGRESSES, and
        // every number in CI describes the whole configured surface.
        //
        // Raising these back toward 80/80/75/80 means writing tests for the
        // untested components listed in `specs/coverage-honesty.spec.md`.
        // They are a known, tracked gap — not an invisible one.
        // ------------------------------------------------------------------
        lines: 81,
        functions: 73,
        branches: 76,
        statements: 81,

        // Per-DIRECTORY floors.
        //
        // A single global average lets a well-tested pure-logic module
        // (`dateUtils` at 100%) mask a directory at 3%. That is not a
        // hypothetical: `src/components/` was reporting 29% while containing a
        // file at 28% and three files that were missing entirely.
        //
        // Vitest applies a glob threshold as an AGGREGATE over every file the
        // glob matches — not per file, and not as the printed directory row. The
        //
        // The values below were read from Vitest's OWN failure output (by
        // setting each floor to 100 and recording what it reported), because
        // recomputing them from `coverage-final.json` produced different
        // numbers: that file only holds files that reached the report, whereas
        // the threshold is evaluated across the whole glob. Each is floored to
        // an integer so a passing run cannot depend on rounding:
        //
        //     src/lib/**         lines 93.26 · funcs 91.40 · stmts 92.08 · branches 87.77
        //     src/storage/**     lines 95.50 · funcs 88.46 · stmts 93.55 · branches 90.62
        //
        // An earlier version set these from the printed report rows and left lib
        // at 80 against a real 93.26 while describing them as "honest current
        // values". A floor thirteen points under the truth will not catch a
        // meaningful regression in that directory.
        //
        // Same rule as the global ratchet: raise these as real tests land.
        // `src/components/**` is near-zero because four components have no tests
        // at all — tracked in `specs/coverage-honesty.spec.md`.
        "src/components/**": {
          lines: 3,
          functions: 1,
          branches: 0,
          statements: 3,
        },
        "src/lib/**": {
          lines: 93,
          functions: 91,
          branches: 87,
          statements: 92,
        },
        "src/storage/**": {
          lines: 95,
          functions: 88,
          branches: 90,
          statements: 93,
        },

        // Critical pure-logic modules — highest bar
        "src/utils/dateUtils.ts": {
          lines: 95,
          functions: 95,
          branches: 90,
          statements: 95,
        },
        "src/types/index.ts": {
          lines: 95,
          functions: 95,
          branches: 90,
          statements: 95,
        },
        "src/lib/importers/detect.ts": {
          lines: 95,
          functions: 95,
          branches: 90,
          statements: 95,
        },
        "src/lib/importers/clipio.ts": {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
        "src/lib/importers/textblaze.ts": {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
        "src/lib/importers/powertext.ts": {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
        "src/lib/exporters/clipio.ts": {
          lines: 95,
          functions: 95,
          branches: 90,
          statements: 95,
        },
        "src/components/editor/serialization.ts": {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
        "src/lib/markdown.ts": {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
        "src/lib/sentry-scrub.ts": {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
        "src/lib/content-helpers.ts": {
          lines: 85,
          functions: 85,
          branches: 80,
          statements: 85,
        },
        "src/storage/types.ts": {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
        "src/storage/manager.ts": {
          lines: 85,
          functions: 80,
          branches: 80,
          statements: 85,
        },
        "src/storage/backends/sync.ts": {
          lines: 85,
          functions: 85,
          branches: 80,
          statements: 85,
        },
        "src/storage/backends/local.ts": {
          lines: 85,
          functions: 85,
          branches: 80,
          statements: 85,
        },
        "src/storage/backends/media.ts": {
          lines: 85,
          functions: 85,
          branches: 80,
          statements: 85,
        },
        "src/lib/giphy.ts": {
          lines: 85,
          functions: 85,
          branches: 80,
          statements: 85,
        },
        "src/lib/update-checker.ts": {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
        "src/utils/usageTracking.ts": {
          lines: 85,
          functions: 85,
          branches: 80,
          statements: 85,
        },
        "src/lib/review-prompt.ts": {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
      },
    },
  },

  resolve: {
    alias: {
      // Match the WXT/tsconfig "~" path alias → "./src"
      "~": resolve(__dirname, "src"),
      "@": resolve(__dirname, "src"),

      // `#i18n` is a WXT virtual module generated into .wxt/i18n/ by
      // `wxt prepare`. Without this alias it is unresolvable, and the
      // consequence is silent: a `.tsx` that imports it can never be loaded by
      // a unit test, so it becomes an "untested file"; coverage then tries to
      // transform it with a pipeline that also cannot resolve `#i18n`, the
      // provider swallows that error and falls back to reading raw TSX, and
      // rollup's JS-only parser fails — dropping the file from the report while
      // still exiting 0. Four components were invisible to the coverage
      // thresholds because of this.
      //
      // The stub resolves real keys against the real `en.yml`, so tests assert
      // on the real user-visible copy rather than a fabricated string.
      // `scripts/check-coverage-integrity.mjs` guards the invariant.
      "#i18n": resolve(__dirname, "tests/mocks/i18n.ts"),
    },
  },
});
