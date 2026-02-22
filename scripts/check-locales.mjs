/**
 * Locale parity checker
 * Ensures every key in en.yml exists in all other locale files,
 * and flags any extra keys in translations that don't exist in en.
 *
 * Usage: node scripts/check-locales.mjs
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = resolve(__dirname, "../src/locales");

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
  return yaml.load(readFileSync(resolve(LOCALES_DIR, file), "utf8"));
}

const en = loadYaml("en.yml");
const es = loadYaml("es.yml");

const enKeys = new Set(flattenKeys(en));
const esKeys = new Set(flattenKeys(es));

let passed = true;

// Keys in en but missing in es
const missing = [...enKeys].filter((k) => !esKeys.has(k));
if (missing.length) {
  console.error(`\n❌ Keys in en.yml missing from es.yml (${missing.length}):`);
  missing.forEach((k) => console.error(`   - ${k}`));
  passed = false;
}

// Keys in es but not in en (stale translations)
const extra = [...esKeys].filter((k) => !enKeys.has(k));
if (extra.length) {
  console.warn(`\n⚠️  Keys in es.yml not found in en.yml (${extra.length}) — possibly stale:`);
  extra.forEach((k) => console.warn(`   - ${k}`));
}

if (passed) {
  console.log(`✅ All ${enKeys.size} keys from en.yml are present in es.yml`);
} else {
  process.exit(1);
}
