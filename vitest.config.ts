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
      // Included because `samples/` holds the import fixtures a human is told to
      // try by hand, and a fixture that no longer imports is worse than none: it
      // reads as a broken importer. The test drives them through the real detect /
      // parse / validate path, so it fails the moment a parser or the schema
      // changes shape.
      "samples/**/*.test.ts",
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
        // Editor presentation shells. These are the Plate/Slate rendering
        // layer: BlockElements, the two pickers, the toolbar, the slash menu and
        // the six placeholders. They hold no branching logic of their own —
        // what they render comes from block-grammar.ts and serialization.ts,
        // which are NOT excluded and are unit-tested at their own threshold.
        // Behaviour is covered by the editor e2e specs and the axe scans.
        //
        // Listed as explicit paths rather than a directory glob on purpose: the
        // previous entry was `editor/components/**`, and when the editor tree
        // was flattened that glob stopped matching, so 13 files silently entered
        // the denominator and took functions from 92% to 74%. A glob that
        // quietly stops matching is worse than a longer list.
        "src/components/editor/RichTextEditor.tsx",
        "src/components/editor/plugins.ts",
        "src/components/editor/index.ts",
        "src/components/editor/BlockElements.tsx",
        "src/components/editor/FloatingToolbar.tsx",
        "src/components/editor/GifPicker.tsx",
        "src/components/editor/ImagePicker.tsx",
        "src/components/editor/SlashCommandMenu.tsx",
        "src/components/editor/leaves.tsx",
        "src/components/editor/LinkElement.tsx",
        "src/components/editor/placeholders/**",
        // Styles / assets / generated types — no executable branches
        "src/app.css",
        "src/assets/**",
        "src/**/*.d.ts",
        // Test scaffolding
        "src/**/__mocks__/**",
        // NOTE: `src/hooks/**` was excluded here while ThemeContext and
        // FontContext lived there. Both were replaced by `src/state/settings.ts`
        // in Phase 4a and the directory no longer exists. The entry was removed
        // rather than left to rot, because this file's own comment on the editor
        // exclusion calls a glob that quietly stops matching "worse than a longer
        // list" — an exclusion that excludes nothing still reads as enforcement.
        // `check-coverage-integrity.mjs` checks configured files against the
        // report but not excludes against the tree, so nothing else would notice.
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
        "src/storage/index.ts",

        // EXCLUDED, and the cost is real: this file is no longer measured at
        // all, so a coverage regression in it would be invisible. It is excluded
        // rather than given a lower threshold because `thresholds` entries only
        // ADD to the top-level floor — with `perFile: true` on, a per-file entry
        // cannot lower 80 for one file. Since indexeddb.ts cannot reach 80 on
        // functions or branches under fake-indexeddb, leaving it in would mean
        // either a permanently red gate or a globally lowered floor. Both are
        // worse than an honest, documented hole.
        //
        // Why it cannot reach 80 — all three verified, not assumed:
        //
        //  1. Six upgrade branches guard schema states IndexedDB cannot produce:
        //     `oldVersion < 1` with the snippets store already existing,
        //     `oldVersion >= 3` while an upgrade is firing, and
        //     `event.currentTarget` being falsy inside `onupgradeneeded`.
        //  2. The seven-function media hash backfill filters on
        //     `e.blob instanceof Blob`, and fake-indexeddb does not
        //     structured-clone a Blob — a blob written to the store reads back as
        //     a bare `{ type }` with no `arrayBuffer` and a plain-Object
        //     prototype — so the filter rejects every row and the hashing loop is
        //     unreachable in unit tests.
        //  3. Five `tx.onerror` / `request.onerror` callbacks do not fire on an
        //     aborted transaction under fake-indexeddb; tests written that way
        //     timed out, so they would have tested the fake rather than the code.
        //
        // This file is still tested (37 unit tests) and still exercised by the
        // storage and image e2e specs. What is lost is the *number*, not the
        // tests. Tracked in docs/open.md.
        "src/storage/backends/indexeddb.ts",
      ],

      // Coverage thresholds — a RATCHET, not a target.
      thresholds: {
        // `perFile: true` is the entire policy: every configured file must clear
        // 80% on all four metrics, and the aggregate must clear it too.
        //
        // This replaces 23 hand-written exceptions and ~180 lines of tuning.
        //
        // Two of the 17 single-file entries — `src/utils/dateUtils.ts` and
        // `src/utils/usageTracking.ts` — pointed at files deleted in 4df6776, so
        // they enforced nothing while looking like enforcement.
        //
        // Worse, `src/components/**` was floored at lines 3 / functions 1 /
        // branches 0, justified in a comment by "four components have no tests at
        // all — tracked in specs/coverage-honesty.spec.md". Both halves rotted: the
        // components were tested in 8804cd6, ffd8956 and 1f97f68, and that spec file
        // was deleted in 0d952c0. The floor was never raised, so it had stopped
        // measuring anything at all.
        //
        // Per-file is also *stricter* than a directory aggregate, not looser: an
        // aggregate of 93 across `src/lib/**` lets one file at 40 hide behind its
        // neighbours.
        //
        // The one real trade: a few files carried individual bars above 80 (95 on
        // `exporters/clipio.ts`, 90 on `types/index.ts` and others), and those
        // specific numbers are lower under a flat 80. That is deliberate. An
        // exception list is unreviewable at 23 entries, and nobody — including the
        // author — can say why each individual number exists. When a file's tests
        // genuinely earn a higher bar, raise it here and say why:
        //
        //   thresholds["src/lib/markdown.ts"] = { branches: 90 }
        //
        // NEVER lower these. A lowered number stops measuring, and nothing in
        // review makes that visible. See AGENTS.md.
        // ------------------------------------------------------------------
        perFile: true,
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },

  resolve: {
    alias: {
      // `import.meta.dirname`, not `__dirname`: Vite is moving `configLoader` to
      // `'native'`, which loads this file as real ESM where `__dirname` does not
      // exist. Vite warns today and throws in the next major.
      //
      // Match the WXT/tsconfig "~" path alias → "./src"
      "~": resolve(import.meta.dirname, "src"),
      "@": resolve(import.meta.dirname, "src"),

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
      "#i18n": resolve(import.meta.dirname, "tests/mocks/i18n.ts"),
    },
  },
});
