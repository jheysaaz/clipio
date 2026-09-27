import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    // Use happy-dom for lightweight DOM support (DOMParser, document.createElement, etc.)
    environment: "happy-dom",

    // Test file patterns
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],

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
        // Global minimum — keep the bar high but achievable
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,

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
    },
  },
});
