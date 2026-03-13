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
 *
 * Schema history:
 *   v1 → creates "snippets" object store
 *   v2 → adds "media" object store
 *   v3 → adds non-unique "hash" index on "media" store (content-hash dedup)
 */

import { IDB_CONFIG } from "~/config/constants";
import type { StorageBackend } from "../types";
import type { Snippet } from "~/types";
import { captureError } from "~/lib/sentry";

/**
 * Shared IndexedDB opener. Handles all version migrations.
 * Exported so MediaStore can reuse the same DB connection logic.
 *
 * After the DB is opened at v3, an async backfill assigns SHA-256 hashes to
 * any existing media entries that were stored before v3.
 */
export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_CONFIG.DB_NAME, IDB_CONFIG.VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      // v1: create snippets store (first install or upgrade from nothing)
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains(IDB_CONFIG.STORE_NAME)) {
          db.createObjectStore(IDB_CONFIG.STORE_NAME, { keyPath: "id" });
        }
      }

      // v2: add media store
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(IDB_CONFIG.MEDIA_STORE_NAME)) {
          db.createObjectStore(IDB_CONFIG.MEDIA_STORE_NAME, { keyPath: "id" });
        }
      }

      // v3: add "hash" index to media store for content-based deduplication.
      // The index is non-unique because two entries may share a hash only
      // transiently (e.g. during a backfill race). multiEntry: false.
      if (oldVersion < 3) {
        // The media store is guaranteed to exist by this point (created in v2
        // or above, or just created in this same transaction for v0→v3).
        const mediaStore = event.currentTarget
          ? (event.target as IDBOpenDBRequest).transaction!.objectStore(
              IDB_CONFIG.MEDIA_STORE_NAME
            )
          : null;
        if (mediaStore && !mediaStore.indexNames.contains("hash")) {
          mediaStore.createIndex("hash", "hash", { unique: false });
        }
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // Kick off async backfill for entries that pre-date v3 (no hash field).
      // We do NOT await this — it runs in the background and never blocks callers.
      backfillMediaHashes(db).catch((err) =>
        captureError(err, { action: "idb.backfillMediaHashes" })
      );
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Assign SHA-256 hashes to media entries that are missing the `hash` field.
 * Called once per DB open after a v3 upgrade (or on any open if there are
 * un-hashed entries from a failed previous backfill run).
 *
 * This is fire-and-forget: errors are captured to Sentry but never thrown.
 */
async function backfillMediaHashes(db: IDBDatabase): Promise<void> {
  // Read all media entries
  const entries: Array<{ id: string; blob: Blob; hash?: string }> =
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_CONFIG.MEDIA_STORE_NAME, "readonly");
      const req = tx.objectStore(IDB_CONFIG.MEDIA_STORE_NAME).getAll();
      req.onsuccess = () =>
        resolve(req.result as Array<{ id: string; blob: Blob; hash?: string }>);
      req.onerror = () => reject(req.error);
    });

  // Filter to only those lacking a hash
  const needsHash = entries.filter((e) => !e.hash && e.blob instanceof Blob);
  if (needsHash.length === 0) return;

  for (const entry of needsHash) {
    try {
      const arrayBuffer = await entry.blob.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
      const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_CONFIG.MEDIA_STORE_NAME, "readwrite");
        tx.objectStore(IDB_CONFIG.MEDIA_STORE_NAME).put({
          ...entry,
          hash: hashHex,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      captureError(err, {
        action: "idb.backfillMediaHashes.entry",
        id: entry.id,
      });
    }
  }
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
