/**
 * Playwright global setup — runs once before all tests.
 *
 * Builds the WXT extension so that .output/chrome-mv3/ exists before
 * Playwright launches Chromium with --load-extension.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

export default async function globalSetup() {
  const outputDir = path.resolve(".output/chrome-mv3");

  // Skip the build if --no-build env var is set (useful for rapid local iteration)
  if (process.env.E2E_SKIP_BUILD === "1") {
    if (!fs.existsSync(outputDir)) {
      throw new Error(
        `E2E_SKIP_BUILD=1 but extension not built. Run 'pnpm build' first.\nExpected: ${outputDir}`
      );
    }
    console.log("[E2E] Skipping build — using existing .output/chrome-mv3/");
    return;
  }

  console.log("[E2E] Building extension with pnpm build...");
  const start = Date.now();
  try {
    execSync("pnpm build", { stdio: "inherit" });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[E2E] Extension built in ${elapsed}s`);
  } catch (err) {
    throw new Error(`Extension build failed: ${err}`);
  }

  if (!fs.existsSync(outputDir)) {
    throw new Error(
      `Build completed but expected output not found at: ${outputDir}`
    );
  }
}
