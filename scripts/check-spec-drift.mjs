/**
 * Spec drift gate.
 *
 * WHY THIS EXISTS
 *
 * `specs/` is treated as the behavioural reference, and AGENTS.md rule 10 says
 * to derive tests from it. But nothing checked whether a spec still described
 * the code. The repo's history shows what that costs — two commits exist purely
 * to repair drift after the fact:
 *
 *     docs: correct six specs that had drifted from the implementation
 *     docs: add the i18n spec referenced by the previous commit
 *
 * A spec that describes deleted behaviour is worse than no spec: a test derived
 * from it either fails for the wrong reason or, worse, passes against code it no
 * longer describes.
 *
 * WHAT THIS CHECKS
 *
 * For every spec that declares its source with a `> Source: \`path\`` header:
 *
 *   1. the source file still exists
 *   2. every symbol the spec documents as a public API is still exported
 *
 * The second check is the one that catches real drift: renaming or deleting an
 * exported function leaves the spec describing a function that is gone.
 *
 * WHAT THIS DOES NOT CHECK
 *
 * It cannot verify that described *behaviour* is still correct — that is what
 * tests and review are for. This catches structural rot only: missing files and
 * vanished exports, which are unambiguous and therefore safe to fail a build on.
 *
 * Specs without a `> Source:` header (the cross-cutting ones such as
 * `test-honesty`, `i18n`, `e2e-suite`) are skipped: they describe a concern
 * rather than a module.
 *
 * Exit codes: 0 clean, 1 drift, 2 bad usage.
 *
 * Usage: pnpm check:spec-drift   (run automatically by `pnpm verify`)
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { dirname, join, relative, resolve, sep } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SPECS_DIR = join(ROOT, "specs");

const posix = (p) => p.split(sep).join("/");

/**
 * Extract the source paths a spec declares.
 *
 * `> Source:` is not a single path in this repo — it appears as:
 *
 *     > Source: `src/lib/giphy.ts`
 *     > Source: `src/lib/giphy.ts` (new), `src/hooks/FontContext.tsx` (new),
 *     > Source: `src/storage/`                       (a directory)
 *     > Source: `src/types/index.ts`, `src/storage/backends/*.ts`   (a glob)
 *     > Source: `e2e/*.spec.ts`, `e2e/fixtures.ts`
 *
 * so every backticked token on the line is collected. Directories and globs are
 * flagged, since they cannot be symbol-checked as written.
 *
 * It is also NOT always in the header. `snippet-model.spec.md` opens with
 * `> Source: src/types/index.ts` and then declares a *second* subject midway:
 *
 *     ### `detectShortcutConflict(…)`      ← documented against snippetUtils
 *
 * Reading only the first header line reported `detectShortcutConflict` and
 * `selectNewest` as missing exports when both exist and are exported by
 * `src/lib/snippetUtils.ts`. So every `> Source:` line in the file is collected,
 * and a documented symbol counts as present if ANY declared source exports it.
 */
function sourcesOf(specText) {
  const entries = [];
  const lines = specText.split("\n");

  // A `> Source:` declaration can wrap onto following `>` lines:
  //
  //     > Source: `src/lib/preview-helpers.ts` (`calculatePreviewPosition`),
  //     > `src/entrypoints/content.ts` (`showPreview`), `snippet-preview-ui.ts` (`show`).
  //
  // so each `> Source:` line is joined with the blockquote lines that follow it.
  // Reading one line at a time missed `showPreview`'s file and reported it as a
  // vanished export.
  //
  // A continuation is a `>` line that is NOT a new `Key: value` header — those
  // (`> Coverage target: 90%`) end the declaration.
  const isContinuation = (line) =>
    /^>\s/.test(line) && !/^>\s*[A-Z][\w ]*:\s/.test(line);

  for (let i = 0; i < lines.length; i++) {
    if (!/^>\s*Source:/.test(lines[i])) continue;

    const block = [lines[i]];
    while (i + 1 < lines.length && isContinuation(lines[i + 1])) {
      block.push(lines[++i]);
    }

    for (const t of block.join("\n").matchAll(/`([^`]+)`/g)) {
      const raw = t[1].trim();
      entries.push({
        path: raw,
        concrete: !raw.includes("*") && !raw.endsWith("/"),
      });
    }
  }

  return entries.filter(
    (e) => e.path.startsWith("src/") || e.path.startsWith("e2e/")
  );
}

/**
 * Symbols the spec presents as this module's public API.
 *
 * Two declaration styles are recognised, and BOTH must be backticked or be a
 * full call signature:
 *
 *   ## `fnName(…)`      a function — name followed by `(`
 *   ## `TypeName`       a type/const — the whole heading is just the name
 *
 * Requiring the backticks or the parens is deliberate. A looser pattern
 * ("word followed by a bracket") also matched prose headings such as
 * `## Accessibility (per https://lucide.dev/…)` and reported `Accessibility`
 * as a missing export — a false positive in a gate whose entire value is that
 * its failures are real. When a section is prose rather than an API reference,
 * it should be titled like prose, not be rescued by the checker.
 */
function documentedSymbols(specText) {
  const out = new Set();

  // Function form: backticked name + call parens.
  for (const m of specText.matchAll(/^#{2,3}\s+`([A-Za-z_$][\w$]*)\s*\(/gm)) {
    out.add(m[1]);
  }
  // Bare type/const form: the heading is exactly one backticked identifier.
  for (const m of specText.matchAll(/^#{2,3}\s+`([A-Za-z_$][\w$]*)`\s*$/gm)) {
    out.add(m[1]);
  }
  return [...out];
}

/** Does the source file still export this symbol in any form? */
function isExported(source, symbol) {
  const patterns = [
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${symbol}\\b`),
    new RegExp(`export\\s+(?:const|let|var)\\s+${symbol}\\b`),
    new RegExp(`export\\s+(?:abstract\\s+)?class\\s+${symbol}\\b`),
    new RegExp(`export\\s+type\\s+${symbol}\\b`),
    new RegExp(`export\\s+interface\\s+${symbol}\\b`),
    new RegExp(`export\\s+enum\\s+${symbol}\\b`),
    // `export { a, b as symbol }` and `export { symbol }`
    new RegExp(`export\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}`, "s"),
  ];
  return patterns.some((re) => re.test(source));
}

/**
 * Is this symbol declared anywhere in the file, exported or not?
 *
 * Needed because a documented symbol is often NOT an export, and that is
 * legitimate rather than drift:
 *
 *   - a class method — `SnippetPreviewUI.show` / `.hide` in
 *     `src/lib/snippet-preview-ui.ts`
 *   - a module-private function — `getCursorCoordsInInput` in
 *     `src/lib/preview-helpers.ts`, exercised through
 *     `calculatePreviewPosition` rather than directly
 *   - a function nested in an IIFE — `showPreview` inside the content script
 *
 * The gate's purpose is to catch specs describing code that is GONE. A symbol
 * that is still declared in the source has not gone anywhere, so flagging it
 * would be a false positive — and a gate whose failures are not all real stops
 * being worth running. Those specs carry a note saying where the symbol lives.
 */
function isDeclared(source, symbol) {
  const patterns = [
    new RegExp(`(?:async\\s+)?function\\s+${symbol}\\b`),
    // class / object method: `  show(…)` or `  show = (…) =>`
    new RegExp(`^\\s+(?:async\\s+)?${symbol}\\s*(?:\\(|=)`, "m"),
    // class method with modifiers
    new RegExp(
      `^\\s+(?:public|private|protected|static|readonly|get|set|async|\\s)*${symbol}\\s*\\(?`,
      "m"
    ),
    new RegExp(`(?:const|let|var)\\s+${symbol}\\b`),
    new RegExp(`(?:class|interface|type|enum)\\s+${symbol}\\b`),
  ];
  return patterns.some((re) => re.test(source));
}

const specs = readdirSync(SPECS_DIR).filter((f) => f.endsWith(".md"));

const missingFiles = [];
const missingSymbols = [];
const notExported = [];
let checkedSpecs = 0;
let checkedSymbols = 0;

for (const specName of specs) {
  const specText = readFileSync(join(SPECS_DIR, specName), "utf-8");

  const sources = sourcesOf(specText);
  if (sources.length === 0) continue; // cross-cutting spec, not tied to one module

  checkedSpecs++;

  // Existence pass — applies to directories and globs too.
  for (const { path } of sources) {
    // A glob or directory is checked by its static prefix, since the path as
    // written is not a file on disk.
    if (path.includes("*")) {
      const prefix = path.slice(0, path.indexOf("*")).replace(/\/$/, "");
      if (!existsSync(join(ROOT, prefix))) {
        missingFiles.push({ spec: specName, sourceRel: path, glob: true });
      }
    } else if (!existsSync(join(ROOT, path))) {
      missingFiles.push({ spec: specName, sourceRel: path });
    }
  }

  // Symbol pass — a symbol is present if ANY declared concrete source exports
  // it. A spec may legitimately document symbols spread across several files.
  const concreteSources = sources
    .filter((s) => s.concrete && existsSync(join(ROOT, s.path)))
    .map((s) => ({
      path: s.path,
      text: readFileSync(join(ROOT, s.path), "utf-8"),
    }));

  for (const symbol of documentedSymbols(specText)) {
    checkedSymbols++;
    if (concreteSources.some((s) => isExported(s.text, symbol))) continue;

    // Not an export. Is it at least still declared? A class method, a private
    // helper, or a function nested in an IIFE is a legitimate home for a
    // documented symbol, so this is recorded but not failed.
    if (concreteSources.some((s) => isDeclared(s.text, symbol))) {
      notExported.push({ spec: specName, symbol });
      continue;
    }

    missingSymbols.push({
      spec: specName,
      sourceRel:
        concreteSources.map((s) => s.path).join(", ") ||
        sources.map((s) => s.path).join(", "),
      symbol,
    });
  }
}

if (missingFiles.length === 0 && missingSymbols.length === 0) {
  console.log(
    `✅ Spec drift: ${checkedSpecs} spec(s) declare a source, all present; ` +
      `${checkedSymbols} documented symbol(s) resolve`
  );
  if (notExported.length > 0) {
    // Surfaced, never fatal. These are documented symbols that are class
    // methods, module-private, or nested in an IIFE — legitimate, but worth
    // knowing when you go looking for them in an import statement.
    console.log(
      `   ℹ️  ${notExported.length} documented symbol(s) exist but are not exports:` +
        ` ${notExported.map((n) => n.symbol).join(", ")}`
    );
  }
  process.exit(0);
}

console.error(`\n❌ Spec drift: specs describe code that has changed\n`);

if (missingFiles.length > 0) {
  console.error(`   Source file no longer exists (${missingFiles.length}):\n`);
  for (const m of missingFiles) {
    console.error(`     specs/${m.spec}`);
    console.error(
      `       declares \`> Source: ${posix(m.sourceRel)}\` — file not found`
    );
  }
  console.error("");
}

if (missingSymbols.length > 0) {
  console.error(
    `   Documented symbol no longer exported (${missingSymbols.length}):\n`
  );
  for (const m of missingSymbols) {
    console.error(`     specs/${m.spec}`);
    console.error(
      `       documents \`${m.symbol}\` — not exported by ${posix(m.sourceRel)}`
    );
  }
  console.error("");
}

console.error(
  `   A spec describing renamed or deleted behaviour misleads the next reader and\n` +
    `   the next test. Either update the spec, or record the change in its\n` +
    `   Change History table so the divergence is intentional.\n`
);
process.exit(1);
