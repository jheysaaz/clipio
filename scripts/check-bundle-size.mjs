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
 *
 * Raised an eleventh time when the delete confirmation dialog was removed. The
 * dialog was the popup's only other importer of Base UI's floating internals, so
 * Rollup no longer puts them in a shared chunk with the options Select and moves
 * them into the options entry instead. Total JavaScript and all shared chunks
 * both shrink; only the options entry grows. Its new size was measured twice
 * from clean builds and did not vary.
 *
 * Raised a twelfth time for replacing Sonner with the shared inline feedback
 * provider. Options now mounts the provider, owns the two live regions, and
 * drives the review banner through the one Tier 2 slot; dropping Sonner shrinks
 * the aggregate and shared chunks, but this entry grows by 383 bytes. Measured
 * twice from clean builds and did not vary.
 *
 * Raised a thirteenth time for full-regex blocked-site entries and the live
 * favicon preview in the add field. Background gains regex-aware dedupe when
 * the context menu adds a site, the content script gains regex matching, and
 * the options entry gains the parser, the favicon component and the preview.
 * The all-JavaScript and shared-chunk totals went down over the same change, so
 * those budgets are unchanged. All raised sizes were measured twice from clean
 * builds and did not vary.
 *
 * Raised a fourteenth time for the shadcn base-nova realignment. Dialog and
 * Tooltip now use the registry's Portal, Backdrop and Positioner structure, and
 * Alert, Spinner and Kbd replace hand-rolled chrome in the options and popup.
 * That adds code to the shared chunks and therefore to the all-JavaScript total;
 * the individual entry budgets do not move. Both raised sizes were measured
 * twice from clean builds and did not vary.
 *
 * Raised a fifteenth time for the image-library redesign and snippet deep links.
 * Debounced description writes live in the shared media store, the background
 * handles the new popup message and route, and the options page carries the
 * storage tile and reference links. The aggregate grows 869 bytes, the background
 * 278, the content script 35 and the shared chunks 556; the popup and options
 * entries stay below their existing budgets. All raised sizes were measured
 * twice from clean builds and did not vary.
 *
 * Raised a sixteenth time for the image-description unmount fix. Flushing the
 * debounced write on a section switch (and waiting for it before a remount reads
 * storage) adds lifecycle bookkeeping to the shared media store. The aggregate
 * and shared chunks grow 565 bytes each; the individual entries do not move.
 * Both sizes were measured twice from clean builds and did not vary.
 *
 * Raised a seventeenth time for media-placeholder reliability: one shared id
 * grammar for imported and generated ids, dedup alias remapping after ZIP/backup
 * restore, a visible label for missing blobs, and a link wrapper for remote
 * GIFs. The content script grows 87 bytes, shared chunks 378, and the aggregate
 * 465; the background, popup and options entries do not move. All three sizes
 * were measured twice from clean builds and did not vary.
 *
 * Raised for popup sync feedback: the neutral local-only footer state, the
 * inline quota error in the editor's reserved status slot, and the background
 * badge decision plus storage-change listener. The aggregate grows 1,268
 * bytes, the background entry 546, the content script 57 and the shared chunks
 * 665; the popup and options entries stay below their existing budgets. All
 * raised sizes were measured twice from clean builds and did not vary.
 *
 * Raised again for the Diagnostics toolkit. The snapshot panel, log filters,
 * report formatter and their English/Spanish copy live in the options entry;
 * generated locale messages also reach the background worker. On its own the
 * aggregate grows 13,317 bytes, shared chunks 13,258 and the background entry
 * 59; the options entry stays below its existing budget. Combined with the
 * media-placeholder raise and the other merged fixes, the aggregate is
 * 2,782,587 bytes, the content script 919,205 and shared chunks 1,636,895.
 * The autosave-race fix adds 3 bytes to the aggregate and shared chunks; the
 * other entries do not move. All sizes were measured twice from clean builds
 * and did not vary.
 *
 * Raised for compact, section-scoped feedback: the options banner is now a
 * caption-sized normal-weight line, import success is a local confirmation
 * beside the Import button, and section-scoped errors clear on navigation. The
 * aggregate and shared chunks each grow 508 bytes; the background, content,
 * popup and options entries stay below their existing budgets. Both sizes were
 * measured twice from clean builds and did not vary.
 *
 * Raised for the shadcn date picker: `react-day-picker` and `date-fns` add the
 * calendar and its date helpers to the shared editor chunk. The popup entry,
 * background, content script and options entry stay below their budgets; only
 * the aggregate and shared-chunk totals move. Both sizes were measured from a
 * clean build after the final editor changes.
 *
 * Raised again for the release editor fixes: the distinct `code_block` node key,
 * the typed trailing paragraph that keeps serialisation from throwing, and the
 * title's important utilities add 110 bytes to both the aggregate and the shared
 * chunks. The individual entries stay below their budgets. Both sizes were
 * measured twice from clean builds and did not vary.
 *
 * Raised for Prism-backed syntax highlighting in the snippet editor. Importing
 * Prism's core plus the 19 grammars offered by the language picker adds about
 * 64 KiB to the shared snippet-editor chunk and therefore to the aggregate.
 * The background and content entries gain 66 and 85 bytes from the shared
 * chunk graph; the popup and options entries stay below their budgets. All
 * raised sizes were measured twice from clean builds and did not vary.
 *
 * Raised again for the per-UI-theme code presets. The two Appearance pickers,
 * live highlighted sample, palette variables and cross-context settings wiring
 * add 4,562 bytes to the aggregate, 158 to the background, 146 to the content
 * script and 4,258 to the shared chunks. The popup and options entries stay
 * below their existing budgets. Sizes were measured from a clean build.
 *
 * Raised once more for the Appearance picker repair: the explicit kebab-id to
 * camelCase-locale-key map, its regression assertion, and the lint-safe
 * normalization of a missing or invalid stored theme add 2,055 bytes to the
 * aggregate and shared chunks. The individual entries do not grow. Sizes were
 * measured twice from clean builds and did not vary.
 *
 * Raised for the popup editor repairs that shipped with it: explicit paragraph
 * creation after media insertion, label-authoritative link insertion, the
 * popup-bound slash-menu surface and the stable datepicker node lookup add 369
 * bytes to the aggregate and shared chunks. The individual entries stay below
 * their existing budgets. Sizes were measured twice from clean builds and did
 * not vary.
 */
const BUDGETS = [
  { name: "all JavaScript", pattern: "**/*.js", maxBytes: 2_941_163 },
  { name: "background entry", pattern: "background.js", maxBytes: 227_257 },
  {
    name: "content script entry",
    pattern: "content-scripts/content.js",
    maxBytes: 919_493,
  },
  {
    name: "popup entry chunk",
    pattern: "chunks/popup-*.js",
    maxBytes: 63_445,
  },
  {
    name: "options entry chunk",
    pattern: "chunks/options-*.js",
    maxBytes: 239_489,
  },
  {
    // Shared chunks are included here even when their individual hashed names
    // change: a rename must not be a way around the budget.
    name: "all shared chunks",
    pattern: "chunks/*.js",
    maxBytes: 1_794_413,
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
