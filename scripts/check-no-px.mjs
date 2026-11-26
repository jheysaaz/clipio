/**
 * Relative-units gate.
 *
 * Clipio's chrome is rendered at whatever root font size the user has chosen,
 * so a hard-coded px in a font, gap, radius or hit target silently stops
 * scaling with it. This gate finds every remaining px literal in shipped UI
 * source and fails unless it is in the explicit allowlist below.
 *
 * Allowed px are only the cases where a CSS px is the correct unit:
 *
 *   - 1px hairline borders and outline offsets
 *   - 2px focus rings and outlines
 *   - 0.5px subpixel hairline shadow
 *   - 800px / 600px Chrome's popup cap, paired with a rem value in min()
 *   - 9999px the offscreen textarea the content script uses to read the clipboard
 *
 * Shadow offsets and blur are allowed in `shadow-*` / `box-shadow` contexts;
 * they are optical constants, not layout or type sizes.
 *
 * Excluded, with reasons, from the default repo scan:
 *
 *   - `*.test.*` files: px literals there are fixtures, not shipped styles.
 *   - `src/lib/snippet-preview-ui.ts`: CSS injected into arbitrary host pages.
 *     Its px values intentionally follow the host page's CSS pixel, not Clipio's
 *     root font size; converting them would change what users see on those pages.
 *   - `e2e/helpers/*.html`: static QA fixtures, not part of the extension UI.
 *
 * Usage:
 *   pnpm check:no-px             scan shipped src files
 *   node scripts/check-no-px.mjs path/to/file.tsx   scan explicit files (tests)
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SCAN_ROOT = join(ROOT, "src");
const EXTENSIONS = /\.(css|ts|tsx|html)$/;

const FILE_EXCLUSIONS = [
  [
    "*.test.* files are fixtures, not shipped UI",
    (p) => /\.test\.[^/]+$/.test(p),
  ],
  [
    "host-page preview CSS intentionally uses host CSS pixels",
    (p) => p === "src/lib/snippet-preview-ui.ts",
  ],
];

const ALLOWED = [
  {
    value: "1px",
    reason: "1px hairline border / outline offset",
    context: /border|outline|ring|shadow|hairline/i,
  },
  {
    value: "2px",
    reason: "2px focus ring / outline",
    context: /outline|ring|shadow|offset/i,
  },
  {
    value: "0.5px",
    reason: "subpixel hairline shadow",
    // The value appears on a continuation line of a multi-line box-shadow,
    // where the property name is not on the same line. There is no other
    // legitimate 0.5px in the chrome.
    context: /./,
  },
  {
    value: "800px",
    reason: "Chrome popup maximum width",
    context: /--popup-max-width/i,
  },
  {
    value: "600px",
    reason: "Chrome popup maximum height",
    context: /--popup-max-height/i,
  },
  {
    value: "9999px",
    reason: "offscreen content-script clipboard textarea",
    context: /position:\s*fixed.*left:\s*-9999px/i,
  },
];

/**
 * Blank comments instead of deleting them: line numbers in the report must
 * still match the file a human opens. `https://` is guarded so a URL in a
 * string is not mistaken for a line comment.
 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(
      /(^|[^:])\/\/[^\n]*/g,
      (match, prefix) =>
        prefix + match.slice(prefix.length).replace(/[^\n]/g, " ")
    );
}

/** A shadow's offsets and blur are optical constants, not layout sizes. */
function inShadowContext(line) {
  // `transition-[color,box-shadow]` on a focus-ring line must not smuggle a
  // `ring-[3px]` past the gate: the px belongs to the ring, not the shadow.
  if (
    /ring-\[/.test(line) &&
    !/shadow-\[|box-shadow:|drop-shadow\(/.test(line)
  ) {
    return false;
  }
  return /box-shadow|shadow-\[|drop-shadow/i.test(line);
}

/** Return the allowlist reason when `value` is permitted on `line`. */
export function allowedReason(value, line) {
  if (inShadowContext(line)) {
    return "shadow offset / blur";
  }
  for (const entry of ALLOWED) {
    if (entry.value === value && entry.context.test(line)) return entry.reason;
  }
  return null;
}

/** Every bare px literal in the code, with the source line for context. */
export function findPxLiterals(code) {
  const findings = [];
  const lines = stripComments(code).split("\n");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)px\b/g)) {
      findings.push({
        line: index + 1,
        value: `${match[1]}px`,
        lineText: line,
      });
    }
  });
  return findings;
}

/** Violations for one file. Each carries the reason it was not allowed. */
export function checkFile(filePath, code) {
  const findings = findPxLiterals(code);
  return findings
    .filter((finding) => !allowedReason(finding.value, finding.lineText))
    .map((finding) => ({
      file: filePath,
      line: finding.line,
      value: finding.value,
      text: finding.lineText.trim(),
    }));
}

/** Repo-relative paths shipped to the browser, excluding fixtures. */
export function collectFiles() {
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (EXTENSIONS.test(entry.name)) {
        const repoPath = relative(ROOT, full).split("\\").join("/");
        const excluded = FILE_EXCLUSIONS.find(([, matches]) =>
          matches(repoPath)
        );
        if (!excluded) files.push(repoPath);
      }
    }
  }
  walk(SCAN_ROOT);
  return files.sort();
}

/** Scan explicit paths, or the whole shipped src tree when none are given. */
export function check(paths = []) {
  const files = paths.length
    ? paths.map((p) => relative(ROOT, resolve(p)).split("\\").join("/"))
    : collectFiles();
  const violations = [];
  for (const file of files) {
    violations.push(
      ...checkFile(file, readFileSync(resolve(ROOT, file), "utf8"))
    );
  }
  return { files, violations };
}

export function main(paths = []) {
  const { files, violations } = check(paths);
  if (violations.length === 0) {
    console.log(`  ✓ no px literals in ${files.length} shipped files`);
    return;
  }

  console.error(`\n❌ Relative-units check failed\n`);
  for (const { file, line, value, text } of violations) {
    console.error(`   ${file}:${line}  ${value}`);
    console.error(`      ${text}`);
  }
  console.error(
    `\n   Use rem/em/%/unitless/flex/grid for type, spacing, sizing and radii.\n` +
      `   The only allowed px are in scripts/check-no-px.mjs's explicit allowlist.\n`
  );
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
