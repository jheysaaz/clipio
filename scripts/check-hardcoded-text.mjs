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
 *   - JSX accessibility labels: aria-label, title, placeholder and alt, whether
 *     written as `title="…"` or as a direct literal `title={"…"}`, with no
 *     length cap on the attribute value
 *   - DOM-writing sinks in `.ts`: textContent/innerText/innerHTML assignments
 *     (including `value || "Fallback"`), alt/title/placeholder properties,
 *     setAttribute for accessible attributes, and title/message properties on
 *     browser menu and notification options
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
 *   1. Literal text in a JSX expression used as an ordinary *child*, such as
 *      `{enabled ? "Enabled" : "Disabled"}`. Direct literals in accessibility
 *      attributes are covered; this one still is not.
 *   2. String props on components that render them, e.g.
 *      `<EmptyState message="Delete all snippets" />`. The `title`/`message`
 *      object properties covered above are browser API options, not component
 *      props.
 *   3. Content set through `dangerouslySetInnerHTML` from a string literal.
 *   4. `.ts` files *outside* the sinks listed above. Pure helpers, engine
 *      internals and the deliberately locale-neutral diagnostics report are not
 *      scanned; this is a targeted check, not a search for every quoted string.
 *   5. A single word in a JSX text node: `<h3>Loading</h3>`. Two or more words
 *      are still required there, so a one-word heading is invisible. Single
 *      words are the most ambiguous shape — "OK", "New", "Save" — and flagging
 *      every button label would bury the real findings. DOM sinks do flag
 *      single words, because element text is always user-visible.
 *   6. Lowercase-initial prose in a JSX text node: `<p>this is lowercase prose</p>`.
 *      Requires a capital, because a lowercase run between tags is usually a
 *      fragment beside an interpolation, CSS or an entity. Attribute values and
 *      DOM sinks do not require a capital.
 *   7. Text that shares a source line with a JSX expression container, e.g.
 *      `<p>{i18n.t("a")} Hardcoded tail</p>`. The braces exclude the whole
 *      expression, so the literal tail inside it is not seen either.
 *   8. A `//` inside *JSX text* is treated as the start of a comment, so a
 *      visible URL is truncated at `https:`. The finding is still reported —
 *      nothing is missed — but the string shown stops there. Deciding otherwise
 *      needs a real JSX parser, which is the larger piece of work noted above.
 *   9. Template literals with interpolation in a DOM sink are skipped. They are
 *      the shape i18n placeholders use, and guessing which part is prose is a
 *      job for a parser this check deliberately does not carry.
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

/**
 * Replace a range with spaces, preserving every offset and newline.
 *
 * Both comment blanking and call masking use this. Offsets have to stay byte-for
 * byte identical to the original file so reported line numbers remain true.
 */
function blankRange(out, from, to) {
  for (let k = from; k < to && k < out.length; k++) {
    if (out[k] !== "\n") out[k] = " ";
  }
}

/**
 * Replace comment content with spaces, preserving every offset and newline.
 *
 * The scan has to know whether a match sits inside a comment, and three cheaper
 * approaches were tried and rejected, each for the same reason — they suppress
 * or fabricate findings:
 *
 *   - `line.includes("*")` dropped any hardcoded string sharing a line with a
 *     a JSX comment block, but it was also the only thing stopping such a
 *     block from being reported as user-visible text.
 *   - `line.includes("//")` had the same problem in the other direction.
 *   - Testing whether `//` occurs *earlier on the line* than the match looked
 *     position-precise and was not: `https://` contains `//`, so
 *     `<a href="https://x.io">Delete all snippets</a>` lost its finding while
 *     the comment claimed the URL case was the bug being fixed.
 *
 * Blanking is the only version that answers the actual question. String state
 * is tracked so that a `//` or `/*` inside a quoted string or a template literal
 * is left alone.
 */
function blankComments(source) {
  const out = source.split("");
  let i = 0;
  const n = source.length;
  // Stack of string states we are inside, so `"a 'b // c'"` is handled.
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      blankRange(out, i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      blankRange(out, i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join("");
}

/**
 * Calls whose string arguments are deliberately not UI copy.
 *
 * `console.*` and `debugLog` are operator diagnostics. `captureMessage`,
 * `captureError` and `captureException` are Sentry telemetry. `new Error(...)`
 * is a fault message for developers. `i18n.t(...)` arguments are locale keys,
 * not the text a user reads. Test fixtures never reach this function —
 * `shouldScanFile` excludes `*.test.ts(x)` and `__mocks__` — so a fixture's
 * deliberately hardcoded prose cannot make the gate red.
 *
 * These are masked *by call*, not by line: background.ts has multi-line
 * captureMessage calls, and a line-based skip would leave their first argument
 * visible to the scanner.
 */
const NON_UI_CALLS = [
  /\bconsole\s*\.\s*[A-Za-z_$][\w$]*\s*\(/g,
  /\bdebugLog\s*\(/g,
  /\b(?:captureMessage|captureError|captureException)\s*\(/g,
  /\bnew\s+(?:Error|TypeError|RangeError)\s*\(/g,
  /\b(?:i18n|t)\s*\.\s*t\s*\(/g,
];

/** Blank one call expression from `start` through its matching `)`. */
function maskCall(out, source, start) {
  let open = -1;
  for (let i = start; i < source.length && i < start + 200; i++) {
    if (source[i] === "(") {
      open = i;
      break;
    }
  }
  if (open === -1) return start + 1;

  let depth = 1;
  let i = open + 1;
  let quote = null;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (quote !== null) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      i++;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    i++;
  }
  if (depth === 0) blankRange(out, start, i);
  return Math.max(i, start + 1);
}

function maskNonUiCalls(source) {
  const out = source.split("");
  for (const pattern of NON_UI_CALLS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(source)) !== null) {
      const end = maskCall(out, source, m.index);
      pattern.lastIndex = Math.max(end, m.index + 1);
    }
  }
  return out.join("");
}

/**
 * Is this literal prose a user would read?
 *
 * JSX text keeps the old two-word and capital-initial rules: a lone identifier
 * between tags is too ambiguous. Accessibility attributes and DOM sinks are
 * unambiguously user-facing, so they use the looser defaults (one word, any
 * case) and rely on the allowlist for technical tokens.
 */
function isProse(text, { minWords = 1, requireCapital = true } = {}) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!/[A-Za-z]{2,}/.test(clean)) return false;
  if (requireCapital && !/^[A-Z]/.test(clean)) return false;
  if (minWords > 1 && clean.split(/\s+/).length < minWords) return false;
  if (ALLOWLIST.includes(clean)) return false;
  // Punctuation only ever trails real prose; strip it before the allowlist
  // lookup so "KB." matches the allowlisted "KB".
  if (ALLOWLIST.includes(clean.replace(/[.,:;!?)]+$/, ""))) return false;
  return true;
}

/** Only source files that can ship UI copy are scanned. */
function shouldScanFile(name) {
  if (/\.test\.(?:ts|tsx)$/.test(name) || /\.d\.ts$/.test(name)) return false;
  return /\.(?:ts|tsx)$/.test(name);
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
// A label that is always read aloud or always shown. No length cap: a long
// tooltip is still an untranslated tooltip.
const JSX_ATTR = /\b(aria-label|title|placeholder|alt)="([^"]{2,})"/g;
// The same names with a direct string literal in braces. `i18n.t("…")`,
// identifiers and `cn("…")` do not match, so translated and computed labels
// stay quiet.
const JSX_EXPR_ATTR =
  /\b(aria-label|title|placeholder|alt)=\{\s*(?:"([^"]{2,})"|'([^']{2,})')\s*\}/g;
// `.ts` DOM sinks. Template literals are skipped by design (see limitation 9).
const TS_DOM_TEXT =
  /\.(?:textContent|innerText|innerHTML)\s*=\s*(["'])([^"'`\n]{2,})\1/g;
const TS_DOM_FALLBACK =
  /\.(?:textContent|innerText)\s*=\s*[^;\n]*?(?:\|\||\?\?)\s*(["'])([^"'`\n]{2,})\1/g;
const TS_DOM_PROP = /\.(?:alt|title|placeholder)\s*=\s*(["'])([^"'`\n]{2,})\1/g;
const TS_DOM_ATTR =
  /\.setAttribute\(\s*(["'])(aria-label|title|placeholder|alt)\1\s*,\s*(["'])([^"'`\n]{2,})\3/g;
// Browser context-menu and notification options. Restricted to these two keys
// so a `message` field in an unrelated data object is not mistaken for copy.
// The lookbehind excludes `err.message : "…"` — an Error fallback, which is
// developer diagnostics rather than a string a user reads.
const TS_UI_PROP = /(?<!\.)\b(?:title|message)\s*:\s*(["'])([^"'`\n]{2,})\1/g;

/**
 * Find hardcoded text in one source file.
 *
 * Kept independent of the filesystem so the gate's own test can call the real
 * matcher with a fixture instead of asserting on a copy of it.
 */
function scanSource(content, rel) {
  // Comment and telemetry masking keep every offset, so the raw `content` can
  // still supply the reported line number.
  const scannable = maskNonUiCalls(blankComments(content));
  const findings = [];
  const lineAt = (offset) => content.slice(0, offset).split("\n").length;
  const push = (m, text, kind, options) => {
    if (!isProse(text, options)) return;
    findings.push({ file: rel, line: lineAt(m.index), text, kind });
  };

  let m;
  // JSX patterns only run on .tsx: a generic `alt="…"` or `>…<` in a .ts
  // template string is markup generation, not JSX, and would be a false hit.
  if (rel.endsWith(".tsx")) {
    JSX_TEXT.lastIndex = 0;
    while ((m = JSX_TEXT.exec(scannable)) !== null) {
      push(m, m[1].replace(/\s+/g, " ").trim(), "text", { minWords: 2 });
    }

    JSX_ATTR.lastIndex = 0;
    while ((m = JSX_ATTR.exec(scannable)) !== null) {
      // m[1] is the attribute name, m[2] its value — the value is the text.
      push(m, m[2].trim(), m[1], { requireCapital: false });
    }

    JSX_EXPR_ATTR.lastIndex = 0;
    while ((m = JSX_EXPR_ATTR.exec(scannable)) !== null) {
      push(m, (m[2] ?? m[3]).trim(), m[1], { requireCapital: false });
    }
  }

  if (rel.endsWith(".ts")) {
    for (const [pattern, group] of [
      [TS_DOM_TEXT, 2],
      [TS_DOM_FALLBACK, 2],
      [TS_DOM_PROP, 2],
    ]) {
      pattern.lastIndex = 0;
      while ((m = pattern.exec(scannable)) !== null) {
        push(m, m[group].trim(), "dom");
      }
    }

    TS_DOM_ATTR.lastIndex = 0;
    while ((m = TS_DOM_ATTR.exec(scannable)) !== null) {
      push(m, m[4].trim(), m[2]);
    }

    TS_UI_PROP.lastIndex = 0;
    while ((m = TS_UI_PROP.exec(scannable)) !== null) {
      push(m, m[2].trim(), "browser option");
    }
  }

  return findings;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Mock fixtures are test scaffolding, not shipped UI copy.
      if (entry === "__mocks__") continue;
      walk(full, out);
    } else if (shouldScanFile(entry)) {
      out.push(full);
    }
  }
  return out;
}

const findings = [];

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  findings.push(...scanSource(readFileSync(file, "utf8"), rel));
}

if (findings.length === 0) {
  console.log(
    "✅ No hardcoded text of the shapes this script recognises (JSX text nodes,\n" +
      "   accessibility attributes and .ts DOM/browser-option sinks) under src/."
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
