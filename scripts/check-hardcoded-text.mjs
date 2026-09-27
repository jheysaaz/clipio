/**
 * Hardcoded-text checker.
 *
 * The locale gate proves every translated key is *read*. It says nothing about
 * user-visible text that was never translated in the first place — which is how
 * the options sidebar ended up shipping hardcoded English next to a fully
 * translated `options.nav.*` that nothing read.
 *
 * So this does the other half: find literal text in the UI. It covers
 *
 *   - JSX text nodes:        >Save<
 *   - accessibility labels:  aria-label="…", title="…", placeholder="…"
 *
 * and reports each one with file:line. Run via `pnpm check:hardcoded-text`, and
 * wired into CI alongside the locale gate.
 *
 * The allowlist below is deliberate and small. It exists for text that must NOT
 * be translated — a brand name, a format token, a unit. Anything added to it
 * should be a string a native speaker would agree must stay as-is.
 *
 * KNOWN LIMITATION: this only sees text that reaches the DOM as a JSX text node
 * or as one of the three attributes above. It cannot see a string produced
 * inside a JSX expression — `{enabled ? "Enabled" : "Disabled"}` was found by
 * reading, not by this script, and had to be fixed by hand. Closing that would
 * mean parsing JSX, which is a much larger piece of work than the problem
 * justifies. The check is a cheap net for the common case, not a proof.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "src");

/**
 * Text that is intentionally not translated.
 *
 * `brand` is a proper noun. `format` is a literal the user types or a token the
 * product defines. `unit` is a measurement.
 */
const ALLOWLIST = [
  // Brand and product names.
  "Clipio",
  // Keyboard modifier and key names, conventionally untranslated in app chrome.
  // "Ctrl+Shift+Space" is the *default value* of the manual-trigger shortcut
  // setting, shown as the input's placeholder — it names keys, not prose, and
  // reads identically in every locale.
  "Shift",
  "Ctrl",
  "Alt",
  "Ctrl+Shift+Space",
  "Enter",
  "Esc",
  "Tab",
  // Technical tokens shown to the user as-is.
  "JSON",
  "HTML",
  "ID",
  "URL",
  "HTTP",
  "GIF",
  "API",
  "IndexedDB",
  "Markdown",
  "Chrome",
  "Firefox",
  // Units.
  "ms",
  "KB",
  "MB",
];

/** Files whose literal text is structural rather than user-facing. */
const SKIP_FILES = new Set([
  // Test fixtures and stories.
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// >Some Words< — a JSX text node. Requires a capital and at least one space, so
// it does not fire on `{'x'}` or on a lone word inside an expression.
//
// Matched across newlines (`\s` with the `s` flag) because JSX text is very
// often formatted on its own line:
//
//     <h3 className="...">
//       Snippet Preview
//     </h3>
//
// A line-based scan misses every one of those, which is most of them. The
// leading \s* matters just as much: JSX conventionally puts the text on its own
// line, so `>Enable Preview<` and `>\n  Snippet Preview\n<` are the same case.
const JSX_TEXT = />\s*([A-Z][a-z]+(?:[ \t\r\n]+[a-zA-Z]+)+)\s*</gs;
// A label that is always read aloud or always shown as a placeholder.
const ATTR = /\b(aria-label|title|placeholder)="([^"]{2,60})"/g;

const findings = [];

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (SKIP_FILES.has(rel)) continue;
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");

  /** 1-indexed line number for a character offset. */
  const lineAt = (offset) => content.slice(0, offset).split("\n").length;

  /** The source line an offset falls on, for the "already localised?" test. */
  const lineFor = (offset) => lines[lineAt(offset) - 1] ?? "";

  JSX_TEXT.lastIndex = 0;
  let m;
  while ((m = JSX_TEXT.exec(content)) !== null) {
    const text = m[1].replace(/\s+/g, " ").trim();
    if (ALLOWLIST.includes(text)) continue;
    const line = lineFor(m.index);
    if (line.includes("//") || line.includes("*")) continue;
    // Already localised on this very line.
    if (/i18n\.t\(|\bt\(|getMessage\(/.test(line)) continue;
    findings.push({ file: rel, line: lineAt(m.index), text, kind: "text" });
  }

  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(content)) !== null) {
    // m[1] is the attribute name, m[2] its value — the value is the text.
    const text = m[2].trim();
    if (ALLOWLIST.includes(text)) continue;
    const line = lineFor(m.index);
    if (/i18n\.t\(|\bt\(|getMessage\(/.test(line)) continue;
    findings.push({ file: rel, line: lineAt(m.index), text, kind: m[1] });
  }
}

if (findings.length === 0) {
  console.log("✅ No hardcoded user-visible text found in src/**/*.tsx");
} else {
  console.error(
    `\n❌ ${findings.length} piece(s) of user-visible text are hardcoded rather than\n` +
      "   passed through i18n. A Spanish user sees these in English:\n"
  );
  for (const f of findings) {
    console.error(
      `   ${f.file}:${f.line}  [${f.kind}]  ${JSON.stringify(f.text)}`
    );
  }
  process.exit(1);
}
