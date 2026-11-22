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
        // Entrypoint wiring: listener registration, not logic.
        //
        // This exclusion previously read "Thin entrypoint wiring — exercised
        // end-to-end by Playwright specs", and the second half was false. It was
        // the stated justification for excluding `background.ts`, whose
        // sign-out detector and context-menu routing table had no test anywhere —
        // and one of those branches had already shipped broken ("Give feedback"
        // pointed at `options.html#feedback`, never a section id, so the user
        // landed on Library while every layer reported success).
        //
        // Both decisions have been extracted into `src/lib/` and are measured
        // there: `sync-change.ts` and `context-menu.ts`. What remains here is
        // registration and side effects.
        //
        // `content.ts` is the other half of this exclusion, and it is genuinely
        // hard rather than thin: 1479 lines of timers, MutationObservers and DOM
        // insertion. Its one piece of real logic — the check that decides whether
        // an insertion landed, which gates confetti and the Sentry revert report
        // — is already extracted, as `insertion-verification.ts`, and measured at
        // well above the threshold.
        //
        // Un-excluding the directory is therefore not a matter of writing tests;
        // it would put the flat-80 `perFile` ratchet behind listener wiring, and
        // the pressure at the end of that is the pressure AGENTS.md forbids
        // answering by lowering a threshold. Listed as one path so the exclusion
        // is visible rather than inherited.
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
        // FontContext lived there. Both were replaced by `src/store/settings.ts`
        // in Phase 4a and the directory no longer exists. The entry was removed
        // rather than left to rot, because this file's own comment on the editor
        // exclusion calls a glob that quietly stops matching "worse than a longer
        // list" — an exclusion that excludes nothing still reads as enforcement.
        // `check-coverage-integrity.mjs` checks configured files against the
        // report but not excludes against the tree, so nothing else would notice.
        // Page composition — covered by e2e specs
        "src/pages/**",
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
