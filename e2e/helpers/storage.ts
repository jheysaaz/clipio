/**
 * Storage helper functions for E2E tests.
 *
 * These functions are called from the Node.js test process via Playwright's
 * page.evaluate() to interact with the extension's browser storage APIs.
 *
 * NOTE: The actual storage operations happen inside page.evaluate() in the
 * browser context. These helpers handle the Node.js wrapper logic.
 */

import type { Page } from "@playwright/test";
import type { Snippet } from "../../src/types/index.js";

// ---------------------------------------------------------------------------
// Low-level storage primitives
// ---------------------------------------------------------------------------

/**
 * Execute a storage operation on an extension page.
 * The callback runs inside the browser (page.evaluate).
 */
export async function withExtPage<T>(
  page: Page,
  fn: () => Promise<T>
): Promise<T> {
  return page.evaluate(fn);
}

/**
 * Seed snippets into both sync storage (per snip: key) and local cache.
 * Call this from a page that has extension APIs (popup or options page).
 */
export async function seedSnippets(
  page: Page,
  snippets: Snippet[]
): Promise<void> {
  await page.evaluate(async (snips: Snippet[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
    const syncEntries: Record<string, Snippet> = {};
    for (const s of snips) {
      syncEntries[`snip:${s.id}`] = s;
    }
    await ext.storage.sync.set(syncEntries);
    await ext.storage.local.set({ cachedSnippets: snips });
  }, snippets);
}

/**
 * Read all snippets from sync storage (snip:* keys).
 */
export async function readSyncSnippets(page: Page): Promise<Snippet[]> {
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
    const all = await ext.storage.sync.get(null);
    return Object.entries(all as Record<string, unknown>)
      .filter(([key]) => key.startsWith("snip:"))
      .map(([, value]) => value as Snippet);
  });
}

/**
 * Read the cached snippets from local storage.
 */
export async function readCachedSnippets(page: Page): Promise<Snippet[]> {
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
    const result = await ext.storage.local.get("cachedSnippets");
    return (result.cachedSnippets as Snippet[]) ?? [];
  });
}

/**
 * Clear all extension storage (sync + local).
 */
export async function clearAllStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
    await ext.storage.sync.clear();
    await ext.storage.local.clear();
  });
}

/**
 * Set a local storage item by key.
 */
export async function setLocalItem(
  page: Page,
  key: string,
  value: unknown
): Promise<void> {
  await page.evaluate(
    async ([k, v]: [string, unknown]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({ [k]: v });
    },
    [key, value] as [string, unknown]
  );
}

/**
 * Get a local storage item by key.
 */
export async function getLocalItem(page: Page, key: string): Promise<unknown> {
  return page.evaluate(async (k: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
    const result = await ext.storage.local.get(k);
    return result[k];
  }, key);
}

/**
 * Fill sync storage to near quota to trigger fallback behavior.
 * Creates large snippets that consume most of the 100KB sync quota.
 */
export async function fillSyncStorageNearQuota(
  page: Page,
  targetBytes = 95_000
): Promise<void> {
  await page.evaluate(async (bytes: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
    // Each sync item has an 8KB limit; create multiple items to fill quota
    const itemSize = 7_000; // stay just under the 8192 per-item limit
    const count = Math.ceil(bytes / itemSize);
    const padding = "x".repeat(itemSize);
    const entries: Record<string, { content: string }> = {};
    for (let i = 0; i < count; i++) {
      entries[`snip:fill-${i}`] = { content: padding };
    }
    await ext.storage.sync.set(entries);
  }, targetBytes);
}

/**
 * Open IndexedDB directly and read all stored snippets from the backup store.
 */
export async function readIndexedDbSnippets(page: Page): Promise<Snippet[]> {
  return page.evaluate(async (): Promise<Snippet[]> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("clipio-backup", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("snippets")) {
          db.close();
          resolve([]);
          return;
        }
        const tx = db.transaction("snippets", "readonly");
        const store = tx.objectStore("snippets");
        const getAllRequest = store.getAll();
        getAllRequest.onsuccess = () => {
          db.close();
          resolve(getAllRequest.result as Snippet[]);
        };
        getAllRequest.onerror = () => {
          db.close();
          reject(getAllRequest.error);
        };
      };
    });
  });
}
