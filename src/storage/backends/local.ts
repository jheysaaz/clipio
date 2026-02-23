/**
 * LocalBackend — browser.storage.local implementation.
 *
 * Used in two roles:
 *   1. Automatic fallback when SyncBackend quota is exceeded.
 *   2. Content-script cache: a copy of all snippets is always kept here
 *      so the content script can read them without making network calls.
 */

import type { StorageBackend } from "../types";
import type { Snippet } from "~/types";
import { captureError } from "~/lib/sentry";
import { localSnippetsItem, cachedSnippetsItem } from "../items";

export class LocalBackend implements StorageBackend {
  async getSnippets(): Promise<Snippet[]> {
    return localSnippetsItem.getValue();
  }

  async saveSnippets(snippets: Snippet[]): Promise<void> {
    await localSnippetsItem.setValue(snippets);
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
