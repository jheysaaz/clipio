/**
 * Coverage integrity gate.
 *
 * A coverage threshold is only meaningful if it is computed over the files it
 * claims to cover. This script asserts that invariant and fails loudly when it
 * does not hold.
 *
 * THE DEFECT THIS EXISTS TO CATCH
 *
 * `vitest.config.ts` lists `src/**` + `.ts` and `src/**` + `.tsx` under
 * `coverage.include`. Between that list and the files that actually appear in
 * `coverage-final.json`, files can disappear — and vitest reports that as a
 * *warning*, not an error, with exit code 0.
 *
 * The concrete instance: four `.tsx` components imported the `#i18n` WXT
 * virtual module. Vitest could not resolve it, so the coverage provider's
 * uncovered-file transform failed; `getSources` catches that with
 * `.catch(() => null)`, falls back to reading the RAW `.tsx`, and hands
 * TypeScript to rollup's JavaScript-only parser. That parser fails on the type
 * annotations, and the provider logs:
 *
 *     Failed to parse .../ConfirmDialog.tsx. Excluding it from coverage.
 *
 * Four files with no tests — 0% coverage by any honest reading — were removed
 * from the denominator instead. The global 91.76% stayed green while four
 * uncovered components sat outside it. `coverage.exclude` is the honest way to
 * say "do not measure this file"; being unable to parse a file is not.
 *
 * WHAT THIS CHECKS
 *
 *   1. Reconstructs the intended file set from `vitest.config.ts` itself, so
 *      this stays correct as `coverage.exclude` changes.
 *   2. Compares it to the keys actually present in `coverage-final.json`.
 *   3. Any glob it cannot expand is a hard error rather than a silent skip,
 *      because an unexpanded glob would understate the intended set — the exact
 *      failure this script exists to prevent.
 *
 * It does not scrape vitest's own log for "Excluding it from coverage" lines;
 * an earlier draft of this header claimed it did, and the code never had that
 * check. Comparing the two sets catches the same condition more reliably, since
 * it does not depend on parsing console output.
 *
 * Exits non-zero on any discrepancy.
 *
 * Usage: pnpm check:coverage-integrity   (run automatically by `pnpm verify`)
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join, relative, resolve, sep } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONFIG_PATH = join(ROOT, "vitest.config.ts");
const REPORT_PATH = join(ROOT, "coverage/coverage-final.json");

/** Normalise to POSIX separators so paths compare cleanly on every platform. */
const posix = (p) => p.split(sep).join("/");

function fail(lines) {
  console.error(`\n❌ Coverage integrity check failed\n`);
  for (const line of lines) console.error(`   ${line}`);
  console.error(
    `\n   Coverage thresholds are computed only over the files that reached the\n` +
      `   report. A file missing from the report is missing from the bar — so a\n` +
      `   green run can be measuring less than it claims to.\n`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. The intended file set, read from the config rather than hardcoded here.
// ---------------------------------------------------------------------------

const config = readFileSync(CONFIG_PATH, "utf-8");

/** Pull the `coverage: { … }` object out of the exported config. */
const coverageBlock = config.match(/coverage:\s*\{([\s\S]*?)\n {4}\},?\n/);
if (!coverageBlock) {
  fail([
    "Could not locate the `coverage: { … }` block in vitest.config.ts.",
    "This script reads the real exclude list from the config so it cannot drift.",
    "If the config was restructured, update the matcher in this script.",
  ]);
}

/**
 * The `include` globs specifically.
 *
 * Reading every string in the coverage block would also pick up entries from
 * `exclude` and `thresholds`, which are paths, not include globs. `include`
 * comes first in the config, so it is read as the run of strings between the
 * `include: [` key and the next top-level key.
 */
const includeMatch = coverageBlock[1].match(/include:\s*\[([^\]]*)\]/);
if (!includeMatch) {
  fail([
    "Could not locate `coverage.include` in vitest.config.ts.",
    "This script reads the real include globs from the config so it cannot drift.",
    "If the config was restructured, update the matcher in this script.",
  ]);
}
const includeGlobs = [...includeMatch[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map(
  (m) => m[1]
);

/**
 * Expand one `src/**` style include glob into concrete repo-relative files.
 *
 * Only the `dir/**` shape the config actually uses is supported, and anything
 * else is a hard error rather than a silent skip — a glob this cannot expand
 * would quietly shrink the intended set, which is the exact failure mode this
 * script exists to prevent.
 */
function expandInclude(pattern) {
  const match = pattern.match(/^(.+?)\/\*\*\/\*(\.[a-z]+)$/);
  if (!match) {
    fail([
      `Cannot expand include glob "${pattern}".`,
      "This script understands the `dir/**.ext` form used by vitest.config.ts.",
      "Extend expandInclude() in this script rather than letting the glob be",
      "skipped — an unexpanded glob would understate the intended file set.",
    ]);
  }
  const [, base, ext] = match;
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (
        full.endsWith(ext) &&
        !/\.d\.ts$/.test(full) &&
        !/\.test\.tsx?$/.test(full)
      ) {
        out.push(posix(relative(ROOT, full)));
      }
    }
  };
  walk(join(ROOT, base));
  return out;
}

/**
 * Extract the `exclude` array specifically. The config interleaves it with
 * comment lines, so anchor on the key and read until the closing bracket.
 */
const excludeMatch = coverageBlock[1].match(/exclude:\s*\[([\s\S]*?)\n {6}\]/);
// Strip `//` comments before extracting paths.
//
// The pattern matcher below is a naive quote-delimited regex, and it cannot tell
// prose from code. A comment inside the exclude block containing a straight
// double quote — `"worse than a longer list"` — therefore opened a "string" that
// swallowed every real exclude after it, and the reconstructed set silently lost
// them. That made 31 excluded files look configured-and-missing, so the gate went
// red for a reason unrelated to coverage.
//
// Existing comments happened to avoid the character, which is why this lay
// undiscovered. Stripping comments is the fix: prose belongs in these comments,
// and a gate that cannot carry a sentence is a gate that gets worked around.
const excludeBody = excludeMatch
  ? excludeMatch[1].replace(/^\s*\/\/.*$/gm, "")
  : "";
const excludePatterns = [...excludeBody.matchAll(/["'`]([^"'`]+)["'`]/g)].map(
  (m) => m[1]
);

if (includeGlobs.length === 0) {
  fail(["No `src/` include globs found in the coverage config."]);
}

/**
 * Does `rel` match an exclude pattern?
 *
 * The exclude list uses three shapes and all three are handled exactly:
 *
 *   `src/hooks/glob-star`     a directory and everything under it
 *   `src/glob-star/glob-star/__mocks__/glob-star`   spanning any segments
 *   `src/<glob-star-glob-star>.d.ts`      star-glob spanning segments, then a suffix
 *   `src/lib/sentry.ts`       an exact path
 *
 * Converted to a regex segment by segment rather than with string replacement:
 *
 *   An earlier version replaced `**` with a NUL sentinel and then swapped the
 *   NUL back for `.*`. That embedded a literal 0x00 byte in this file, so git
 *   stored it as binary — `git show --stat` reported `Bin 0 -> 8470 bytes` and
 *   every diff rendered it as "Binary files differ". A gate that runs on every
 *   `pnpm verify` had become structurally invisible to code review, in the very
 *   change whose thesis was "make the gates trustworthy".
 *
 *   Splitting on `/` and handling each segment also gets `**` right in the
 *   middle of a pattern, which the sentinel version did not.
 */
function isExcluded(rel) {
  return excludePatterns.some((pattern) => {
    if (!pattern.includes("*")) return rel === pattern;

    const segments = pattern.split("/");

    // A TRAILING `**` means "this directory and everything under it", so it has
    // to match `src/hooks` itself as well as `src/hooks/FontContext.tsx`.
    // Compiling `**` as "zero or more segments each ending in a slash" — the
    // natural reading for a middle `**` — produces `^src/hooks/(?:[^/]+/)*$`,
    // which cannot match a bare filename and silently stops excluding the whole
    // directory. That mistake made this gate report 67 phantom missing files and
    // fail on a perfectly healthy run.
    const trailing = segments[segments.length - 1] === "**";
    const body = trailing ? segments.slice(0, -1) : segments;

    // `**` is emitted as "zero or more segments, each with its slash", i.e.
    // `(?:[^/]+/)*`. It therefore already supplies the separator that would
    // otherwise come from the join, so the join must not add another — that
    // stray slash is what stopped `src/<star>/<star>.d.ts` from matching.
    // Emitted segment by segment rather than via a `join("/")`.
    //
    // `**` compiles to `(?:[^/]+/)*` — zero or more whole segments, each WITH
    // its trailing slash. So the separator that precedes it must still be
    // emitted, while the separator that would follow it must not. That is
    // exactly what a plain `join("/")` gets wrong in both directions:
    //
    //   src/<star>/x  →  src/<star>//x   (double slash — matches nothing)
    //   src/x/<star>  →  srcx            (missing slash — matches nothing)
    //
    // Both of those shapes occur in this config's exclude list
    // (`src/**` + `.d.ts`, `src/**` + `__mocks__/**`), and both silently
    // excluded nothing.
    const parts = body.map((segment) =>
      segment === "**"
        ? "(?:[^/]+/)*"
        : // Escape regex metacharacters FIRST, then substitute the remaining
          // `*`. The other order escapes the `[` of the substitution itself,
          // producing `\[^/]*`, which matches a literal `[`.
          segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")
    );

    // A `**` part already ends in a slash, so it swallows the separator that
    // would come after it; a normal part needs one before it.
    const source = parts.reduce((acc, part, i) => {
      if (i === 0) return part;
      const needsSeparator = !acc.endsWith("(?:[^/]+/)*");
      return needsSeparator ? `${acc}/${part}` : acc + part;
    }, "");

    // A trailing `**` appends an optional "/anything".
    const suffix = trailing ? "(?:/.*)?" : "";
    return new RegExp(`^${source}${suffix}$`).test(rel);
  });
}

const intended = [...new Set(includeGlobs.flatMap(expandInclude))]
  .filter((rel) => !isExcluded(rel))
  .sort();

// ---------------------------------------------------------------------------
// 2. What actually reached the report.
// ---------------------------------------------------------------------------

if (!existsSync(REPORT_PATH)) {
  fail([
    "coverage/coverage-final.json does not exist.",
    "Run `pnpm test:coverage` before `pnpm check:coverage-integrity`.",
  ]);
}

const report = JSON.parse(readFileSync(REPORT_PATH, "utf-8"));
const present = new Set(
  Object.keys(report).map((k) => posix(relative(ROOT, k)))
);

const missing = intended.filter((rel) => !present.has(rel));
const unexpected = [...present].filter((p) => !intended.includes(p)).sort();

// ---------------------------------------------------------------------------
// 3. Report.
// ---------------------------------------------------------------------------

if (missing.length > 0) {
  fail([
    `${missing.length} file(s) are configured for coverage but absent from the report:`,
    ...missing.map((m) => `  ${m}`),
    "",
    "Vitest excludes unparseable files with a warning and a zero exit code.",
    "The usual cause is an unresolvable import (e.g. a WXT virtual module such as",
    "`#i18n`) that defeats the coverage provider's own transform, after which it",
    "parses raw TypeScript as JavaScript and gives up.",
  ]);
}

if (unexpected.length > 0) {
  fail([
    `${unexpected.length} file(s) are in the report but not in the intended set:`,
    ...unexpected.map((m) => `  ${m}`),
    "",
    "Either the exclude list is incomplete or a file is being measured that you",
    "believed was excluded.",
  ]);
}

console.log(
  `✅ Coverage integrity: all ${intended.length} configured file(s) are present in the report`
);
