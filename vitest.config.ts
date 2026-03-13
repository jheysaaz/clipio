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

      // Files to exclude from coverage (entrypoints, UI shells, generated types,
      // and modules not yet covered by tests — these will be added back as tests are written)
      exclude: [
        "src/entrypoints/**",
        "src/components/ui/**",
        "src/components/editor/RichTextEditor.tsx",
        "src/components/editor/plugins.ts",
        "src/components/editor/index.ts",
        "src/components/editor/components/**",
        "src/components/ConfirmDialog.tsx",
        "src/components/ImportWizard.tsx",
        "src/components/SnippetDetailView.tsx",
        "src/components/SnippetListItem.tsx",
        "src/components/SnippetView.tsx",
        "src/components/NewSnippetView.tsx",
        "src/app.css",
        "src/assets/**",
        "src/hooks/**",
        "src/pages/**",
        "src/config/**",
        "src/lib/sentry.ts",
        "src/lib/sentry-relay.ts",
        "src/lib/utils.ts",
        "src/lib/importers/types.ts",
        "src/storage/index.ts",
        "src/storage/items.ts",
        "src/storage/backends/indexeddb.ts",
        "src/**/*.d.ts",
        "src/**/__mocks__/**",
      ],

      // Per-module coverage thresholds
      // Vitest v2+ supports thresholds per file/glob via the `thresholds` object.
      thresholds: {
        // Global minimum
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,

        // Critical pure-logic modules — higher bar
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
          lines: 80,
          functions: 80,
          branches: 75,
          statements: 80,
        },
        "src/storage/backends/sync.ts": {
          lines: 80,
          functions: 80,
          branches: 75,
          statements: 80,
        },
        "src/storage/backends/local.ts": {
          lines: 80,
          functions: 80,
          branches: 75,
          statements: 80,
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
      },
    },
  },

  resolve: {
    alias: {
      // Match the WXT/tsconfig "~" path alias → "./src"
      "~": resolve(__dirname, "src"),
    },
  },
});
