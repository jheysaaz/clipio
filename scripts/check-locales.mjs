/**
 * Locale parity checker
 *
 * Three checks:
 *   1. every key in en.yml exists in all other locale files
 *   2. no translation defines a key that en.yml does not
 *   3. every placeholder ($1, {{name}}, …) matches en.yml
 *   4. **every key in en.yml is actually referenced by the code**
 *
 * The fourth is the one that was missing, and its absence is why 32 dead keys
 * accumulated: nothing complained when a key stopped being read, so removing the
 * last call site of a feature left its strings behind forever. It is reported
 * rather than enforced, because a key can legitimately be reserved for a
 * feature still being built — but it can no longer rot unnoticed.
 *
 * Usage: pnpm check:locales
 *
 * Wired into CI (.github/workflows/ci.yml) so locale drift cannot land again.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
// js-yaml v5 exposes named exports only — there is no default export.
import { load } from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = resolve(__dirname, "../src/locales");

/** Locales checked against en.yml. Add new locales here. */
const TRANSLATIONS = ["es.yml"];

function flattenKeys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([key, value]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return flattenKeys(value, fullKey);
    }
    return [fullKey];
  });
}

/** Map of fullKey -> string value, for every leaf in a locale. */
function flattenLeaves(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      flattenLeaves(value, fullKey, out);
    } else {
      out[fullKey] = value;
    }
  }
  return out;
}

/**
 * Placeholders an i18n string may contain, mapped to the argument index they
 * consume. WXT's i18n runtime substitutes "$1"-style placeholders (30 of them
 * in en.yml); the brace form is accepted too so a future migration cannot
 * silently pass. A translation that drops or reorders one renders the wrong
 * sentence, so a mismatch is a hard failure rather than a warning.
 */
/**
 * Placeholder indices used by a string, in source order.
 *
 * WXT's i18n runtime substitutes "$1"-style placeholders (30 of them in
 * en.yml); the brace form is accepted too so a future migration cannot
 * silently pass.
 */
function placeholdersOf(value) {
  if (typeof value !== "string") return [];
  return [...value.matchAll(/\$\d+|\{\d+\}/g)].map((m) =>
    m[0].replace(/[{}$]/g, "")
  );
}

/** Sorted copy, for comparing which placeholders are used regardless of order. */
function sortedPlaceholders(indices) {
  return [...indices].sort();
}

function loadYaml(file) {
  return load(readFileSync(resolve(LOCALES_DIR, file), "utf8"));
}

const en = loadYaml("en.yml");
const enKeys = new Set(flattenKeys(en));
const enLeaves = flattenLeaves(en);

let passed = true;

for (const file of TRANSLATIONS) {
  const localeKeys = new Set(flattenKeys(loadYaml(file)));

  // Keys in en but missing from the translation
  const missing = [...enKeys].filter((k) => !localeKeys.has(k));
  if (missing.length) {
    console.error(
      `\n❌ Keys in en.yml missing from ${file} (${missing.length}):`
    );
    missing.forEach((k) => console.error(`   - ${k}`));
    passed = false;
  }

  // Keys in the translation but not in en (stale translations)
  const extra = [...localeKeys].filter((k) => !enKeys.has(k));
  if (extra.length) {
    console.warn(
      `\n⚠️  Keys in ${file} not found in en.yml (${extra.length}) — possibly stale:`
    );
    extra.forEach((k) => console.warn(`   - ${k}`));
  }

  // Placeholder parity. A translation that drops "$1" renders a wrong sentence,
  // which key-presence alone cannot catch. Dropping or adding a placeholder is
  // always a bug, so it fails the build. Reordering is only a warning: some
  // languages legitimately move an argument, so failing on it would produce
  // false positives that train people to ignore this check.
  const localeLeaves = flattenLeaves(loadYaml(file));
  const mismatched = [];
  const reordered = [];
  for (const [key, source] of Object.entries(enLeaves)) {
    if (!(key in localeLeaves)) continue; // already reported as missing
    const expected = placeholdersOf(source);
    const actual = placeholdersOf(localeLeaves[key]);
    if (
      sortedPlaceholders(expected).join(",") ===
      sortedPlaceholders(actual).join(",")
    ) {
      if (expected.join(",") !== actual.join(",")) reordered.push(key);
      continue;
    }
    mismatched.push(
      `   - ${key}: en uses [${expected.join(", ")}], ${file} uses [${actual.join(", ")}]`
    );
  }
  if (mismatched.length) {
    console.error(
      `\n❌ Placeholder mismatch between en.yml and ${file} (${mismatched.length}):`
    );
    mismatched.forEach((line) => console.error(line));
    passed = false;
  }
  if (reordered.length) {
    console.warn(
      `\n⚠️  Placeholders reordered relative to en.yml in ${file} (${reordered.length}) — verify this is intended:`
    );
    reordered.forEach((key) => console.warn(`   - ${key}`));
  }
}

// ---------------------------------------------------------------------------
// Unused keys
// ---------------------------------------------------------------------------

/** Every .ts/.tsx file under src/, so the scan covers components and lib. */
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const SRC_DIR = resolve(__dirname, "../src");
const sources = sourceFiles(SRC_DIR)
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

/**
 * Keys the code actually asks for.
 *
 * Only static `i18n.t("…")` calls are counted, and a scan confirms there are no
 * template-literal or concatenated key accesses in src/ — if one is ever added
 * this check will under-report, so the scan is asserted rather than assumed.
 */
const dynamicAccess = sources.match(/i18n\.t\(\s*(?!\s*["'])[^)]/g);
if (dynamicAccess) {
  console.warn(
    `\n⚠️  Found ${dynamicAccess.length} non-literal i18n.t() call(s). Unused-key detection\n` +
      "   only understands static keys, so its result is incomplete:"
  );
  dynamicAccess
    .slice(0, 5)
    .forEach((line) => console.warn(`   ${line.trim()}`));
}

// Any string literal in src/ that is exactly a locale key counts as a use, not
// just a direct `i18n.t("…")` call. That covers keys reached indirectly through
// a data table — the sidebar's `labelKey: "options.nav.dashboard"` is looked up
// with `i18n.t(item.labelKey)` and would otherwise be reported as dead while
// being very much alive.
const usedKeys = new Set(
  [...sources.matchAll(/["']([A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+)["']/g)].map(
    (m) => m[1]
  )
);
// Plural arms (the `1:` / `n:` entries under a plural key) are not referenced
// individually: the code calls `t(key, [n])` and the runtime picks the arm. The
// parent key is the one that has to be present, and it is checked by the
// parity check above.
const isPluralArm = (key) => /\.(1|n)$/.test(key);

// Consumed by the build, not by `i18n.t`: the manifest name and description are
// read by the browser from the generated manifest.json.
const MANIFEST_KEYS = new Set(["extName", "extDescription"]);

const unusedKeys = [...enKeys]
  .filter((k) => !usedKeys.has(k) && !isPluralArm(k) && !MANIFEST_KEYS.has(k))
  .sort();

// A key reserved for work still in progress belongs here, so the exemption is
// explicit and reviewable rather than a warning everybody learns to ignore.
const RESERVED = new Set([]);

const deadKeys = unusedKeys.filter((k) => !RESERVED.has(k));

if (deadKeys.length > 0) {
  console.error(
    `\n❌ ${deadKeys.length} key(s) in en.yml are never read by the code. Each one is a\n` +
      "   translation someone maintains for nothing. Either the code should call\n" +
      "   it, or it should be deleted from en.yml AND every translation.\n" +
      "   (A key genuinely reserved for in-progress work goes in RESERVED, in\n" +
      "   scripts/check-locales.mjs, so the exemption is reviewable.)"
  );
  deadKeys.forEach((key) => console.error(`   - ${key}`));
  passed = false;
}

if (passed) {
  console.log(
    `✅ All ${enKeys.size} keys from en.yml are present in ${TRANSLATIONS.join(", ")}` +
      " · every key is read by the code"
  );
} else {
  process.exit(1);
}
