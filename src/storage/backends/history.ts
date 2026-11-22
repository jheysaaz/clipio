/**
 * IndexedDB rows for local snippet version history.
 *
 * This is a separate object store in the shadow-backup database, but it is not
 * part of the backup: `IndexedDBBackend` still reads and writes only the
 * `snippets` store. History is local, disposable and never crosses a sync,
 * export, import or cache boundary.
 */

import { IDB_CONFIG } from "@/config/constants";
import type { HistoryEntry } from "@/lib/history-policy";
import { captureError } from "@/lib/sentry";
import { openDB } from "./indexeddb";

/** Every stored snapshot, newest last in IndexedDB; callers sort as needed. */
export async function listHistory(): Promise<HistoryEntry[]> {
  try {
    const db = await openDB();
    return await new Promise<HistoryEntry[]>((resolve, reject) => {
      const tx = db.transaction(IDB_CONFIG.HISTORY_STORE_NAME, "readonly");
      const request = tx.objectStore(IDB_CONFIG.HISTORY_STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as HistoryEntry[]);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    captureError(error, { action: "history.list" });
    return [];
  }
}

/** Put these snapshots, or none of them, inside one transaction. */
export async function writeHistory(entries: HistoryEntry[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    const db = await openDB();
    const tx = db.transaction(IDB_CONFIG.HISTORY_STORE_NAME, "readwrite");
    const store = tx.objectStore(IDB_CONFIG.HISTORY_STORE_NAME);
    for (const entry of entries) store.put(entry);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    captureError(error, { action: "history.write" });
  }
}

export async function deleteHistory(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const db = await openDB();
    const tx = db.transaction(IDB_CONFIG.HISTORY_STORE_NAME, "readwrite");
    const store = tx.objectStore(IDB_CONFIG.HISTORY_STORE_NAME);
    for (const id of ids) store.delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    captureError(error, { action: "history.delete" });
  }
}
