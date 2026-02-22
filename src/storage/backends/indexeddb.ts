/**
 * IndexedDBBackend — persistent backup layer using the browser's IndexedDB.
 *
 * This is a **non-critical shadow backup**. It mirrors every write from the
 * StorageManager so that snippets can be recovered if:
 *   - The user signs out of their browser account (wipes storage.sync)
 *   - storage.sync or storage.local are corrupted
 *
 * ⚠️  IndexedDB is still scoped to the extension's origin, so it IS
 *     deleted when the extension is uninstalled — same as storage.sync/local.
 *
 * All public methods are wrapped in try/catch and will **never throw**.
 * Failures are silently logged so the backup layer can never block or
 * break the primary storage flow.
 */

import { IDB_CONFIG } from "~/config/constants";
import type { StorageBackend } from "../types";
import type { Snippet } from "~/types";
import { captureError } from "~/lib/sentry";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_CONFIG.DB_NAME, IDB_CONFIG.VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_CONFIG.STORE_NAME)) {
        db.createObjectStore(IDB_CONFIG.STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class IndexedDBBackend implements StorageBackend {
  async getSnippets(): Promise<Snippet[]> {
    try {
      const db = await openDB();
      return await new Promise<Snippet[]>((resolve, reject) => {
        const tx = db.transaction(IDB_CONFIG.STORE_NAME, "readonly");
        const store = tx.objectStore(IDB_CONFIG.STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result as Snippet[]);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn("[Clipio] IndexedDBBackend.getSnippets failed:", error);
      captureError(error, { action: "idb.getSnippets" });
      return [];
    }
  }

  async saveSnippets(snippets: Snippet[]): Promise<void> {
    try {
      const db = await openDB();
      const tx = db.transaction(IDB_CONFIG.STORE_NAME, "readwrite");
      const store = tx.objectStore(IDB_CONFIG.STORE_NAME);

      // Clear and re-write — IndexedDB writes are local-disk, so this is fast
      store.clear();
      for (const snippet of snippets) {
        store.put(snippet);
      }

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (error) {
      console.warn("[Clipio] IndexedDBBackend.saveSnippets failed:", error);
      captureError(error, { action: "idb.saveSnippets" });
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await openDB();
      const tx = db.transaction(IDB_CONFIG.STORE_NAME, "readwrite");
      tx.objectStore(IDB_CONFIG.STORE_NAME).clear();
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (error) {
      console.warn("[Clipio] IndexedDBBackend.clear failed:", error);
      captureError(error, { action: "idb.clear" });
    }
  }
}
