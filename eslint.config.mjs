// @ts-check

import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";

export default defineConfig([
  globalIgnores([
    ".output/",
    ".wxt/",
    "coverage/",
    "node_modules/",
    "playwright-report/",
    "test-results/",
    "**/dist/",
    "**/*.js",
    // `.mjs` is deliberately NOT ignored. The gate scripts under `scripts/` are
    // real code that runs on every `pnpm verify` and on every release tag, and
    // excluding them left an entire directory of logic unlinted. Keep them in
    // the lint program so dead or duplicated logic there gets reported.
    "**/*.cjs",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      "jsx-a11y": jsxA11yPlugin,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      ...reactHooksPlugin.configs.recommended.rules,
      "react/jsx-no-target-blank": "error",
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/role-supports-aria-props": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // Node-side tooling: the gate scripts in `scripts/`, and the root configs.
    //
    // `.mjs` is no longer globally ignored (see above), so these files are
    // actually linted now. They are plain Node ESM — no JSX, no browser
    // globals, no React — so they get their own environment rather than
    // inheriting the browser setup the `**/*.{ts,tsx}` block provides.
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        fetch: "readonly",
        AbortSignal: "readonly",
      },
    },
    rules: {
      // The gate scripts strip ANSI escapes out of Playwright/Vitest output with
      // a character class containing the ESC control character. That is the
      // correct expression for the job; the rule flags any control character in
      // a regex, this one included.
      "no-control-regex": "off",
      // These are command-line tools: reporting to stdout is the point, and
      // `console.warn`/`console.error` are the only diagnostics channel.
      "no-console": "off",
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: ["e2e/**/*.{ts,tsx}"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/rules-of-hooks": "off",
    },
  },
  {
    files: [
      "src/components/ui/**/*.{ts,tsx}",
      "src/components/editor/**/*.{ts,tsx}",
    ],
    rules: {
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/set-state-in-effect": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);
