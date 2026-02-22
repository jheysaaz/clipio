/**
 * SyncBackend — browser.storage.sync implementation.
 *
 * Primary storage backend. Snippets stored here are automatically synced
 * by the browser across all devices where the user is signed in.
 *
 * Quota limits (Chrome / Firefox / Edge):
 *   Total:          102,400 bytes (100 KB)
 *   Per item:         8,192 bytes  ← binding constraint when using a single key
 *   Max items:          512 keys
 *   Write ops:      1,800 / hour SUSTAINED, 120 / minute BURST
 *
 * Storage layout:
 *   Each snippet is stored under its own key: "snip:<id>"
 *   This lets the total storage grow up to the 100 KB quota instead of
 *   being capped at the 8 KB per-item limit that a single "snippets" key
 *   would impose.
 *
 * Migration:
 *   If the legacy single "snippets" key is detected on first read it is
 *   automatically migrated to the per-key layout and the old key removed.
 */

import type { StorageBackend } from "../types";
import { StorageQuotaError } from "../types";
import type { Snippet } from "~/types";
import { captureError } from "~/lib/sentry";

const SNIPPET_PREFIX = "snip:";
/** Legacy key used before the per-item layout — kept for migration only. */
const LEGACY_KEY = "snippets";

function snippetKey(id: string): string {
  return `${SNIPPET_PREFIX}${id}`;
}

export class SyncBackend implements StorageBackend {
  async getSnippets(): Promise<Snippet[]> {
    const all = await browser.storage.sync.get(null);

    // -----------------------------------------------------------------------
    // Migration: old single-key format → per-key format
    // -----------------------------------------------------------------------
    if (all[LEGACY_KEY] !== undefined) {
      try {
        const raw = all[LEGACY_KEY];
        const snippets: Snippet[] =
          typeof raw === "string" ? JSON.parse(raw) : (raw as Snippet[]);
        // Write to per-key layout then remove the legacy key
        await this.saveSnippets(snippets);
        await browser.storage.sync.remove(LEGACY_KEY);
        return snippets;
      } catch {
        console.error("[Clipio] SyncBackend: migration from legacy key failed");
        captureError(new Error("SyncBackend: migration from legacy key failed"), { action: "sync.migration" });
      }
    }

    // -----------------------------------------------------------------------
    // Normal read: collect all snip: keys
    // -----------------------------------------------------------------------
    const snippets: Snippet[] = [];
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(SNIPPET_PREFIX)) continue;
      try {
        const snippet =
          typeof value === "string"
            ? (JSON.parse(value) as Snippet)
            : (value as Snippet);
        snippets.push(snippet);
      } catch {
        console.error(
          "[Clipio] SyncBackend: failed to parse snippet at key",
          key
        );
        captureError(new Error(`SyncBackend: failed to parse snippet at key ${key}`), { action: "sync.parseSnippet" });
      }
    }
    return snippets;
  }

  async saveSnippets(snippets: Snippet[]): Promise<void> {
    try {
      // Derive removals from the incoming set without an extra get(null):
      // any snip: key not present in the new list must be deleted.
      const all = await browser.storage.sync.get(null);
      const existingSnipKeys = Object.keys(all).filter((k) =>
        k.startsWith(SNIPPET_PREFIX)
      );
      const incomingKeys = new Set(snippets.map((s) => snippetKey(s.id)));
      const toRemove = existingSnipKeys.filter((k) => !incomingKeys.has(k));
      if (toRemove.length > 0) {
        await browser.storage.sync.remove(toRemove);
      }

      // Upsert only snippets whose serialised value has changed
      if (snippets.length > 0) {
        const toSet: Record<string, Snippet> = {};
        for (const snippet of snippets) {
          const key = snippetKey(snippet.id);
          const existing = all[key];
          // Skip write if the stored value is already identical
          if (
            existing !== undefined &&
            JSON.stringify(existing) === JSON.stringify(snippet)
          ) {
            continue;
          }
          toSet[key] = snippet;
        }
        if (Object.keys(toSet).length > 0) {
          await browser.storage.sync.set(toSet);
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("QUOTA_BYTES") ||
          error.message.includes("MAX_ITEMS") ||
          error.message.includes("quota"))
      ) {
        throw new StorageQuotaError();
      }
      throw error;
    }
  }

  async clear(): Promise<void> {
    const all = await browser.storage.sync.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(SNIPPET_PREFIX));
    if (keys.length > 0) {
      await browser.storage.sync.remove(keys);
    }
  }
}
