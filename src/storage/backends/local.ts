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

const LOCAL_KEY = "snippets";

/** Key used by the content script to read the snippet cache. */
export const CONTENT_SCRIPT_CACHE_KEY = "cachedSnippets";

export class LocalBackend implements StorageBackend {
  async getSnippets(): Promise<Snippet[]> {
    const result = await browser.storage.local.get(LOCAL_KEY);
    const raw = result[LOCAL_KEY];

    if (!raw) return [];

    try {
      return typeof raw === "string" ? JSON.parse(raw) : (raw as Snippet[]);
    } catch {
      console.error("[Clipio] LocalBackend: failed to parse snippets", raw);
      return [];
    }
  }

  async saveSnippets(snippets: Snippet[]): Promise<void> {
    await browser.storage.local.set({ [LOCAL_KEY]: snippets });
  }

  async clear(): Promise<void> {
    await browser.storage.local.remove(LOCAL_KEY);
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
    await browser.storage.local.set({
      [CONTENT_SCRIPT_CACHE_KEY]: JSON.stringify(snippets),
    });
  } catch (error) {
    console.error("[Clipio] Failed to update content script cache:", error);
  }
}
