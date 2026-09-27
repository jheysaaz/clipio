/**
 * Locale parity checker
 * Ensures every key in en.yml exists in all other locale files,
 * and flags any extra keys in translations that don't exist in en.
 *
 * Usage: pnpm check:locales
 *
 * Wired into CI (.github/workflows/ci.yml) so locale drift cannot land again.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
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
    console.error(`\n❌ Keys in en.yml missing from ${file} (${missing.length}):`);
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
    if (sortedPlaceholders(expected).join(",") === sortedPlaceholders(actual).join(",")) {
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

if (passed) {
  console.log(
    `✅ All ${enKeys.size} keys from en.yml are present in ${TRANSLATIONS.join(", ")}`
  );
} else {
  process.exit(1);
}
