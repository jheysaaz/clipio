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

function loadYaml(file) {
  return load(readFileSync(resolve(LOCALES_DIR, file), "utf8"));
}

const en = loadYaml("en.yml");
const enKeys = new Set(flattenKeys(en));

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
}

if (passed) {
  console.log(
    `✅ All ${enKeys.size} keys from en.yml are present in ${TRANSLATIONS.join(", ")}`
  );
} else {
  process.exit(1);
}
