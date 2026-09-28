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
// Real config, so a helper cannot drift from the schema version it opens.
import { IDB_CONFIG } from "../../src/config/constants.js";

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
 * Read all snippets from the IndexedDB backup store.
 *
 * The database name and version come from `IDB_CONFIG` rather than a literal.
 * Hardcoding them means a test opens the database at v1 against a production
 * database that has since migrated to v4, which throws `VersionError` — and a
 * helper that throws reads as a product bug.
 */
export async function readIndexedDbSnippets(page: Page): Promise<Snippet[]> {
  return page.evaluate(
    async ({ dbName, version, storeName }) =>
      new Promise<Snippet[]>((resolve, reject) => {
        const request = indexedDB.open(dbName, version);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            resolve([]);
            return;
          }
          const tx = db.transaction(storeName, "readonly");
          const getAllRequest = tx.objectStore(storeName).getAll();
          getAllRequest.onsuccess = () => {
            db.close();
            resolve(getAllRequest.result as Snippet[]);
          };
          getAllRequest.onerror = () => {
            db.close();
            reject(getAllRequest.error);
          };
        };
      }),
    {
      dbName: IDB_CONFIG.DB_NAME,
      version: IDB_CONFIG.VERSION,
      storeName: IDB_CONFIG.STORE_NAME,
    }
  );
}

/**
 * Write snippets straight into the IndexedDB backup store.
 *
 * The recovery banner is driven by `tryRecoverFromBackup()`, which reads this
 * store and shows nothing when it is empty — so seeding `storage.sync` alone is
 * not enough to exercise it.
 */
export async function writeBackupSnippets(
  page: Page,
  snippets: Snippet[]
): Promise<void> {
  await page.evaluate(
    async ({ dbName, version, storeName, snips }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, version);
        // Create the store if the database is being opened for the first time.
        // Without this the transaction below throws inside `onsuccess`, the
        // promise never settles, and the test times out with "Target page,
        // context or browser has been closed" — which reads like a crash rather
        // than a missing handler.
        request.onupgradeneeded = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: "id" });
          }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            reject(new Error(`object store ${storeName} is missing`));
            return;
          }
          const tx = db.transaction(storeName, "readwrite");
          const store = tx.objectStore(storeName);
          for (const s of snips) store.put(s);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      });
    },
    {
      dbName: IDB_CONFIG.DB_NAME,
      version: IDB_CONFIG.VERSION,
      storeName: IDB_CONFIG.STORE_NAME,
      snips: snippets,
    }
  );
}

/**
 * Write a media record into the backup store's media object store.
 *
 * The `Blob` is constructed inside the page from the raw bytes rather than
 * passed across `page.evaluate`, because Playwright's argument serialisation does
 * not carry a `Blob`. The record shape matches what `backends/media.ts` writes.
 *
 * `image-gif.spec.ts` had its own `indexedDB.open("clipio-backup", 2)` block; a
 * hardcoded version there throws `VersionError` once the schema moves past it,
 * which reads as a product failure.
 */
export async function writeBackupMedia(
  page: Page,
  record: {
    id: string;
    bytes: number[];
    mimeType: string;
    width: number;
    height: number;
    alt?: string;
  }
): Promise<void> {
  await page.evaluate(
    async ({ dbName, version, storeName, rec }) => {
      const png = new Uint8Array(rec.bytes);
      const blob = new Blob([png], { type: rec.mimeType });
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, version);
        request.onupgradeneeded = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: "id" });
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(storeName, "readwrite");
          tx.objectStore(storeName).put({
            id: rec.id,
            blob,
            mimeType: rec.mimeType,
            width: rec.width,
            height: rec.height,
            size: png.length,
            originalSize: png.length,
            createdAt: new Date().toISOString(),
            ...(rec.alt !== undefined ? { alt: rec.alt } : {}),
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        request.onerror = () => reject(request.error);
      });
    },
    {
      dbName: IDB_CONFIG.DB_NAME,
      version: IDB_CONFIG.VERSION,
      storeName: IDB_CONFIG.MEDIA_STORE_NAME,
      rec: {
        id: record.id,
        bytes: record.bytes,
        mimeType: record.mimeType,
        width: record.width,
        height: record.height,
        alt: record.alt,
      },
    }
  );
}
