/**
 * Wiring between the settings registry and the search index.
 *
 * The index itself (`src/lib/setting-index.ts`) is pure: it takes settings, a
 * section-label map and a translator, and knows nothing about this codebase's
 * registries or its locale files. This module is the only place that knows how
 * to feed it.
 *
 * Keeping the seam here rather than in `registry.ts` means the ranking and the
 * text folding are unit-tested without touching storage items or a renderer,
 * which is what `setting-index.test.ts` and `text-fold.test.ts` do.
 */

import {
  buildSettingIndex,
  searchSettingIndex,
  type SettingIndexEntry,
  type SettingHit,
  type SettingMatch,
} from "@/lib/setting-index";
import { i18n } from "#i18n";

import { SECTIONS, SETTINGS, getSetting, type SettingEntry } from "./registry";

/** Section id → its resolved nav label. */
function sectionLabels(): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const section of SECTIONS) {
    labels[section.id] = i18n.t(section.labelKey);
  }
  return labels;
}

/**
 * Resolve an i18n key for the index.
 *
 * The key arrives as a plain `string` because `buildSettingIndex` is generic
 * over its inputs, while `i18n.t` is typed against the literal keys WXT
 * generates from `en.yml` and rejects a bare `string`. Casting at this single
 * boundary keeps that strictness everywhere it is useful — the registry's
 * `titleKey` and `descKey` are literal unions, so a renamed key is still a
 * compile error there — instead of loosening `i18n.t` itself.
 */
const translate = (key: string): string =>
  i18n.t(key as Parameters<typeof i18n.t>[0]);

/**
 * The index, built once per module load.
 *
 * Memoised because it is otherwise rebuilt on every keystroke, and it cannot
 * change without a reload: `SETTINGS` and `SECTIONS` are module-level constants
 * and the resolved copy only changes with the UI locale, which does not change
 * without a reload either.
 */
let cached: SettingIndexEntry[] | null = null;

function index(): SettingIndexEntry[] {
  cached ??= buildSettingIndex(SETTINGS, sectionLabels(), translate);
  return cached;
}

/** Drops the memoised index. Test-only. */
export function _resetSearchIndexCache(): void {
  cached = null;
}

/**
 * Rank every setting against a query.
 *
 * Returns `[]` for an empty query and for one that is only punctuation. Callers
 * show every setting on an empty query and a "no results" message otherwise, so
 * the two cases must not be conflated — see `searchSettingIndex`.
 */
export function searchRegistry(query: string): SettingMatch[] {
  return searchSettingIndex(index(), query);
}

/** A ranked result, resolved back to the setting it names. */
export type SettingResult = {
  entry: SettingEntry;
  /**
   * Ranges to highlight in the entry's title. Empty when the match landed
   * somewhere the row does not render — an option label, say — which is the
   * common case and not an error.
   */
  titleHits: SettingHit[];
};

/**
 * Ranked results with each setting resolved.
 *
 * This is what the UI consumes. A result index can in principle name a setting
 * that is no longer registered, so resolution happens here and such a result is
 * dropped rather than handed on: rendering a row for a missing setting would
 * crash on `entry.control`.
 */
export function searchRegistryEntries(query: string): SettingResult[] {
  const results: SettingResult[] = [];
  for (const match of searchRegistry(query)) {
    const entry = getSetting(match.entry.id);
    if (!entry) continue;
    results.push({ entry, titleHits: match.hits });
  }
  return results;
}
