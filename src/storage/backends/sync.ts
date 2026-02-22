/**
 * SyncBackend — browser.storage.sync implementation.
 *
 * Primary storage backend. Snippets stored here are automatically synced
 * by the browser across all devices where the user is signed in.
 *
 * Quota limits (Chrome / Firefox / Edge):
 *   Total:        102,400 bytes (100 KB)
 *   Per item:     8,192 bytes
 *   Write ops:    1,800 / hour SUSTAINED, 120 / minute BURST
 *
 * When quota is exceeded this backend throws StorageQuotaError so the
 * manager can switch to LocalBackend transparently.
 */

import type { StorageBackend } from "../types";
import { StorageQuotaError } from "../types";
import type { Snippet } from "~/types";

const SYNC_KEY = "snippets";

export class SyncBackend implements StorageBackend {
  async getSnippets(): Promise<Snippet[]> {
    const result = await browser.storage.sync.get(SYNC_KEY);
    const raw = result[SYNC_KEY];

    if (!raw) return [];

    try {
      return typeof raw === "string" ? JSON.parse(raw) : (raw as Snippet[]);
    } catch {
      console.error("[Clipio] SyncBackend: failed to parse snippets", raw);
      return [];
    }
  }

  async saveSnippets(snippets: Snippet[]): Promise<void> {
    try {
      await browser.storage.sync.set({ [SYNC_KEY]: snippets });
    } catch (error) {
      // browser.storage.sync throws a generic Error whose message contains
      // "QUOTA_BYTES" or "MAX_ITEMS" when limits are hit.
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
    await browser.storage.sync.remove(SYNC_KEY);
  }
}
