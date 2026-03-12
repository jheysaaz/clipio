import { defineConfig, devices } from "@playwright/test";
import path from "path";

/**
 * Playwright configuration for Clipio browser extension E2E tests.
 *
 * Architecture:
 *   pnpm build        → WXT builds extension to .output/chrome-mv3/
 *   pnpm test:e2e     → Playwright loads extension into real Chromium
 *
 * Extensions require a persistent context (not the default incognito context),
 * so we use the `chromium` project with `launchOptions` that load the extension.
 * Each fixture in e2e/fixtures.ts sets up the persistent context.
 */

const extensionPath = path.resolve(".output/chrome-mv3");

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  globalTimeout: 5 * 60 * 1_000, // 5 minutes
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Extensions share a single browser context — run serially
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [
        ["list"],
        ["html", { outputFolder: "playwright-report", open: "on-failure" }],
      ],

  use: {
    // Base URL for serving the test-page.html helper via file:// is handled
    // per-test via page.goto(); no baseURL needed here.
    trace: "on-first-retry",
    video: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium-extension",
      use: {
        ...devices["Desktop Chrome"],
        // Extensions are Chrome-only and require a persistent context.
        // The actual context creation (with --load-extension) is done in
        // e2e/fixtures.ts using chromium.launchPersistentContext().
        // We set channel here for metadata / device descriptor only.
        channel: "chromium",
        launchOptions: {
          args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
            // Allow clipboard access in tests without user gesture prompts
            "--use-fake-ui-for-media-stream",
            // Ensure headless mode works with extensions (requires new headless)
            "--headless=new",
          ],
        },
      },
    },
  ],

  // Build the extension once before running any tests.
  globalSetup: "./e2e/global-setup.ts",

  // Serve e2e/helpers/ over HTTP so content scripts can inject.
  // Chrome restricts content scripts from file:// URLs unless the user
  // explicitly grants "Allow access to file URLs" — using HTTP avoids that.
  webServer: {
    command: "node e2e/helpers/serve.mjs",
    url: "http://localhost:7777/test-page.html",
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },

  outputDir: "test-results",
});
