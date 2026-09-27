/**
 * LocalBackend — browser.storage.local implementation.
 *
 * Used in two roles:
 *   1. Automatic fallback when SyncBackend quota is exceeded.
 *   2. Content-script cache: a copy of all snippets is always kept here
 *      so the content script can read them without making network calls.
 */

import type { StorageBackend } from "../types";
import type { Snippet } from "@/types";
import { captureError } from "@/lib/sentry";
import { migrateContentFormat } from "@/lib/content-format-migration";
import { localSnippetsItem, cachedSnippetsItem } from "../items";

function normalizeSnippet(snippet: Snippet): Snippet {
  // Converts a legacy HTML body to markdown and strips the retired
  // contentFormat key. A no-op for every snippet written since.
  // spec: specs/content-format-migration.spec.md
  return migrateContentFormat(snippet) as Snippet;
}

export class LocalBackend implements StorageBackend {
  async getSnippets(): Promise<Snippet[]> {
    const snippets = await localSnippetsItem.getValue();
    return snippets.map(normalizeSnippet);
  }

  async saveSnippets(snippets: Snippet[]): Promise<void> {
    await localSnippetsItem.setValue(snippets);
  }

  /**
   * Write exactly these snippets, deleting nothing.
   *
   * Read-modify-write against a fresh read, so a snippet another context wrote
   * between our read and this write survives. Local storage has no
   * per-key-addressed API, so unlike the sync backend this cannot be a single
   * key write — the fresh read narrows the window rather than closing it.
   */
  async upsertSnippets(snippets: Snippet[]): Promise<void> {
    if (snippets.length === 0) return;
    const existing = await localSnippetsItem.getValue();
    const byId = new Map(existing.map((s) => [s.id, s]));
    for (const snippet of snippets) {
      byId.set(snippet.id, snippet);
    }
    await localSnippetsItem.setValue([...byId.values()]);
  }

  /** Remove exactly these snippets by id, writing nothing else. */
  async removeSnippetsById(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const drop = new Set(ids);
    const existing = await localSnippetsItem.getValue();
    await localSnippetsItem.setValue(existing.filter((s) => !drop.has(s.id)));
  }

  async clear(): Promise<void> {
    await localSnippetsItem.removeValue();
  }
}

/**
 * Write to the content-script cache.
 * Always called after every snippet write so the content script always has
 * an up-to-date list without needing to communicate with the popup.
 */
export async function updateContentScriptCache(
  snippets: Snippet[]
): Promise<void> {
  try {
    await cachedSnippetsItem.setValue(snippets);
  } catch (error) {
    console.error("[Clipio] Failed to update content script cache:", error);
    captureError(error, { action: "local.updateCache" });
  }
}
