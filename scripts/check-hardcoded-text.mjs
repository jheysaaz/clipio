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
 *   - JSX text nodes: the literal characters between `>` and `<`
 *   - accessibility labels:  aria-label="…", title="…", placeholder="…"
 *
 * and reports each one with file:line. Run via `pnpm check:hardcoded-text`, and
 * wired into CI alongside the locale gate.
 *
 * The allowlist below is deliberate and small. It exists for text that must NOT
 * be translated — a brand name, a format token, a unit. Anything added to it
 * should be a string a native speaker would agree must stay as-is.
 *
 * WHAT THIS DOES NOT SEE — read this before trusting a green run:
 *
 *   1. A string produced inside a JSX expression, such as
 *      `{enabled ? "Enabled" : "Disabled"}` or `title={someVar}`. The character
 *      class excludes braces, so those are invisible. Every case of this found
 *      while building the check was fixed by reading, not by running it.
 *   2. String props on components that render them, e.g.
 *      `<EmptyState message="Delete all snippets" />`. Only the three attributes
 *      above are read.
 *   3. Content set through `dangerouslySetInnerHTML` from a string literal.
 *   4. `.ts` files. Only files ending in `.tsx` under `src` are walked. A helper
 *      in `src/lib` that returns a translated-or-not string for a component to
 *      render is not seen.
 *   5. A **single word**: `<h3>Loading</h3>`. Two or more words are required, so
 *      a one-word heading is invisible. Single words are the most ambiguous
 *      shape — "OK", "New", "Save" — and flagging every button label would bury
 *      the real findings.
 *   6. **Lowercase-initial** prose: `<p>this is lowercase prose</p>`. Requires a
 *      capital, because a lowercase run between tags is usually a fragment
 *      beside an interpolation, CSS or an entity. This is a deliberate
 *      false-negative trade, not an oversight.
 *   7. Text that shares a source line with a JSX expression container, e.g.
 *      `<p>{i18n.t("a")} Hardcoded tail</p>`. The braces exclude the whole
 *      expression, so the literal tail inside it is not seen either.
 *
 * The first version of this check was narrower still — it required a capital
 * initial and letters-and-spaces only, so "Top 5 Usage", "No usage data yet."
 * and "Send test exception (options)" all passed a green run. Widening it found
 * 15 more real strings on the first attempt, all now translated. Expect the same
 * to happen again after any change to the patterns below: a green run means "no
 * *known* shape of hardcoded text", not "no hardcoded text".
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

// A JSX text node: the literal characters between `>` and `<`.
//
// The character class excludes `<`, `>` and braces. That matters: it means a
// match is *purely literal* prose, with no interpolation and no element boundary
// inside it. `>of {n} KB<` therefore does not match, which is right — there is
// no untranslated string there, just two words around a variable.
//
// An earlier version required a capital initial and letters-and-spaces only. It
// silently missed "Top 5 Usage", "No usage data yet." and "Send test exception
// (options)" — real untranslated strings, in files this gate was supposed to be
// covering. Because the words are now collected loosely and filtered in JS
// below, digits and punctuation are handled without enumerating them here.
//
// The `s` flag is what lets a text node span newlines, which is how JSX is
// conventionally formatted:
//
//     <h3 className="...">
//       Snippet Preview
//     </h3>
//
// A line-based scan misses every one of those, which is most of them.
const JSX_TEXT = />([^<>{}]{2,})</gs;
// A label that is always read aloud or always shown as a placeholder.
const ATTR = /\b(aria-label|title|placeholder)="([^"]{2,60})"/g;

const findings = [];

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
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
    // At least two words, so a lone identifier or unit does not trip it.
    if (!/[A-Za-z]{2,}/.test(text)) continue;
    if (text.split(/\s+/).length < 2) continue;
    // Prose starts with a capital. A lowercase-initial run between tags is
    // overwhelmingly a fragment sitting next to an interpolation, CSS or an
    // entity, and flagging those produces noise nobody acts on.
    if (!/^[A-Z]/.test(text)) continue;
    if (ALLOWLIST.includes(text)) continue;
    // Punctuation only ever trails real prose; strip it before the allowlist
    // lookup so "KB." matches the allowlisted "KB".
    if (ALLOWLIST.includes(text.replace(/[.,:;!?)]+$/, ""))) continue;
    // Skip a match that is *itself* inside a `//` line comment — a commented-out
    // JSX line is not user-visible.
    //
    // This is position-precise on purpose. The previous two versions used
    // `line.includes("*")` and then `line.includes("//")`, which dropped the
    // whole finding whenever the *source line* happened to contain those
    // characters — so a hardcoded string sharing a line with a URL or an
    // arithmetic operator vanished silently. Position, not co-line presence.
    const lineStart = content.lastIndexOf("\n", m.index) + 1;
    const before = content.slice(lineStart, m.index);
    if (before.lastIndexOf("//") > before.lastIndexOf("*")) continue;

    // No `i18n.t` co-line check here. A JSX text node cannot be an i18n call —
    // the character class excludes braces, so `{i18n.t("…")}` never matches in
    // the first place. Skipping on co-line presence only hid real strings such
    // as `<p onClick={() => t("k")}>Delete all snippets</p>`.
    findings.push({ file: rel, line: lineAt(m.index), text, kind: "text" });
  }

  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(content)) !== null) {
    // m[1] is the attribute name, m[2] its value — the value is the text.
    const text = m[2].trim();
    if (ALLOWLIST.includes(text)) continue;
    // Same position-precise comment rule as the text-node pass. The pattern
    // requires `="…"`, so this cannot match `aria-label={i18n.t("…")}` anyway.
    const lineStart = content.lastIndexOf("\n", m.index) + 1;
    const before = content.slice(lineStart, m.index);
    if (before.lastIndexOf("//") > before.lastIndexOf("*")) continue;
    findings.push({ file: rel, line: lineAt(m.index), text, kind: m[1] });
  }
}

if (findings.length === 0) {
  console.log(
    "✅ No hardcoded text of the shapes this script recognises (JSX text nodes\n" +
      "   and aria-label/title/placeholder) in .tsx files under src/.\n" +
      "   It does NOT see strings inside JSX expressions, string props, or .ts files."
  );
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
