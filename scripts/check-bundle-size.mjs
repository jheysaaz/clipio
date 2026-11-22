/**
 * Bundle-size ratchet.
 *
 * A size warning in the build log is not a gate: it can be scrolled past, and a
 * new chunk can grow without anyone whose PR is green ever seeing the number.
 * This check turns the built JavaScript into a hard, reviewable budget.
 *
 * The budgets below were measured from the build at the commit that introduced
 * this script, not chosen as round numbers. They are a ratchet, like the
 * coverage thresholds: shrinking a bundle always passes, growing one fails, and
 * raising a budget is a deliberate change visible in the diff.
 *
 * Only JavaScript is measured. Fonts and images are fixed assets whose size is
 * decided by the design system, not by a PR's imports; the failure this gate
 * exists to catch is a dependency or chunk silently landing in a hot bundle.
 *
 * Usage: pnpm check:bundle-size   (runs automatically after build in verify:full)
 */

import { existsSync, readdirSync, statSync } from "fs";
import { dirname, join, relative, resolve, sep } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUTPUT_DIR = join(ROOT, ".output", "chrome-mv3");

const posix = (p) => p.split(sep).join("/");

/**
 * Measured baseline: update only when the increase is intentional.
 *
 * Raised once from 2_698_488 / 217_315 / 1_566_549 when the IndexedDB schema
 * and backfill seams were exported for direct tests. That added 100 bytes to
 * background.js and 102 bytes to the shared OnboardingLoader chunk.
 *
 * Raised again for context-aware ranking: a local hostname-only usage store,
 * the popup's current-site lookup, and the tie-break comparator add code to the
 * content script (insertion recording) and to the popup/shared chunks (context
 * loading and ranking). The options entry did not grow. Sizes were measured
 * twice from clean builds and did not vary.
 *
 * Raised a third time for full backups: the options UI, ZIP envelope handling,
 * per-key settings validation and the restore preview add code to the options
 * entry and the shared chunks. The popup moved by seven bytes in the same clean
 * builds despite no popup source change, so its exact budget moved too. All
 * four affected sizes were measured twice from clean builds and did not vary.
 *
 * Raised a fourth time for moving the post-onboarding checklist into the
 * options rail. The options entry grows by the card and its snippets-store
 * wiring; removing the strip from the popup shrinks that chunk by more, so the
 * all-JavaScript and shared-chunk totals move by only 256 bytes. The popup budget
 * is left high — a ratchet, not a target. All affected sizes were measured twice
 * from clean builds and did not vary.
 *
 * Raised a fifth time for the checklist's final copy and derivation changes:
 * bigger text, per-snippet usage counts (instead of a lifetime insertion
 * counter), and the "Use a placeholder" step. The options entry grows by 186
 * bytes and the aggregate by 173; the popup, background and content budgets did
 * not move. All affected sizes were measured twice from clean builds and did
 * not vary.
 *
 * Raised a sixth time for autosave, the persisted write queue and local version
 * history. The background gains the queue drain and rate limiting, the popup
 * gains draft staging plus undo/redo, and the options entry grows because the
 * same storage and history modules are shared there. The content script grows
 * slightly from the shared LWW/queue types. The popup entry chunk itself shrank
 * (the Save button and its wiring are gone), so its budget is left high. All
 * raised sizes were measured twice from clean builds and did not vary.
 *
 * Raised a seventh time for the queue drain's wake-up scheduling: operations
 * blocked by the inter-send gap or backoff now get a timer so they are retried
 * without waiting for another storage write. That adds 646 bytes to
 * background.js and therefore to the all-JavaScript total; no other budget
 * moved. Both sizes were measured twice from clean builds and did not vary.
 *
 * Raised an eighth time because the create form now lives in the detail pane
 * instead of a second full-page view. Removing NewSnippetView and its own
 * validation code is offset by sharing the detail pane's editor with the
 * create flow: the popup chunk shrinks further, while the options chunk and
 * shared chunks grow slightly because they already import that pane. Three
 * budgets move up by 28/260/28 bytes; all were measured twice from clean
 * builds and did not vary.
 *
 * Raised a ninth time for the queue review fixes: the cross-context Web Lock,
 * in-flight claims and startup reconciliation in the background, the popup's
 * per-snippet outcomes and commit waiting, and self-write metadata handling.
 * The background grows 1,266 bytes, the options entry 2, the shared chunks
 * 3,035, and the all-JavaScript total 4,301. The content and popup budgets did
 * not move. All raised sizes were measured twice from clean builds and did not
 * vary.
 *
 * Raised a tenth time for the Sentry context guard that keeps DOM-only browser
 * tracing out of the service worker. The background grows 83 bytes and the
 * all-JavaScript total 82; the shared chunks shrink by one byte, so that
 * budget is unchanged. Both raised sizes were measured twice from clean builds
 * and did not vary.
 */
const BUDGETS = [
  { name: "all JavaScript", pattern: "**/*.js", maxBytes: 2_757_453 },
  { name: "background entry", pattern: "background.js", maxBytes: 225_859 },
  {
    name: "content script entry",
    pattern: "content-scripts/content.js",
    maxBytes: 918_247,
  },
  {
    name: "popup entry chunk",
    pattern: "chunks/popup-*.js",
    maxBytes: 63_445,
  },
  {
    name: "options entry chunk",
    pattern: "chunks/options-*.js",
    maxBytes: 201_444,
  },
  {
    // Shared chunks are included here even when their individual hashed names
    // change: a rename must not be a way around the budget.
    name: "all shared chunks",
    pattern: "chunks/*.js",
    maxBytes: 1_613_348,
  },
];

/** Translate the small glob dialect used by BUDGETS into a regex. */
function globToRegExp(glob) {
  let source = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        // `**/` means "any number of directories, including none".
        source += "(?:.*/)?";
        i += 1;
        if (glob[i + 1] === "/") i += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`${source}$`);
}

function matchesPattern(pattern, path) {
  return globToRegExp(pattern).test(path);
}

/**
 * Evaluate budgets against a map of repo-relative path → byte count.
 *
 * A pattern that matches nothing is a failure, not a zero-size pass: a rename in
 * the build output would otherwise remove a budget without changing the gate.
 */
function evaluateBudgets(fileSizes, budgets) {
  return budgets.map((budget) => {
    const matches = Object.entries(fileSizes).filter(([path]) =>
      matchesPattern(budget.pattern, path)
    );
    const bytes = matches.reduce((sum, [, size]) => sum + size, 0);
    return {
      ...budget,
      bytes,
      matched: matches.map(([path]) => path),
      overBy: Math.max(0, bytes - budget.maxBytes),
      ok: matches.length > 0 && bytes <= budget.maxBytes,
    };
  });
}

function collectJavaScriptSizes(dir) {
  const sizes = {};
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        sizes[posix(relative(OUTPUT_DIR, full))] = statSync(full).size;
      }
    }
  };
  walk(dir);
  return sizes;
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function fail(lines) {
  console.error("\n❌ Bundle size check failed\n");
  for (const line of lines) console.error(`   ${line}`);
  console.error(
    "\n   Budgets are a ratchet measured from a real build. Shrinking a bundle\n" +
      "   always passes. If the increase is deliberate, raise the specific budget\n" +
      "   in scripts/check-bundle-size.mjs and explain why in the PR.\n"
  );
  process.exit(1);
}

function main() {
  if (!existsSync(OUTPUT_DIR)) {
    fail([
      `Build output not found at ${posix(relative(ROOT, OUTPUT_DIR))}.`,
      "Run pnpm build before checking bundle size.",
    ]);
  }

  const results = evaluateBudgets(collectJavaScriptSizes(OUTPUT_DIR), BUDGETS);

  for (const result of results) {
    const status = result.ok ? "✓" : "✗";
    console.log(
      `  ${status} ${result.name.padEnd(24)} ${formatBytes(result.bytes)} / ${formatBytes(result.maxBytes)}`
    );
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    fail(
      failed.map((result) => {
        if (result.matched.length === 0) {
          return `${result.name}: no file matched "${result.pattern}". Did the build output layout change?`;
        }
        return `${result.name}: over by ${formatBytes(result.overBy)} (${result.matched.join(", ")})`;
      })
    );
  }

  console.log(
    `\n✅ Bundle size: ${results.length}/${results.length} budgets within limits.`
  );
}

const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
