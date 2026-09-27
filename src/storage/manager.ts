/**
 * StorageManager — orchestrates backends and owns the fallback logic.
 *
 * Flow:
 *   1. Always try SyncBackend first (browser.storage.sync).
 *   2. If it throws StorageQuotaError → persist the fallback flag,
 *      notify via a status flag, and retry with LocalBackend.
 *   3. Always keep the content-script cache (browser.storage.local) in sync.
 *   4. Shadow-write every mutation to IndexedDB as a non-critical backup.
 *
 * The manager is a singleton; import the pre-built instance from index.ts.
 */

import { SyncBackend } from "./backends/sync";
import { LocalBackend, updateContentScriptCache } from "./backends/local";
import { IndexedDBBackend } from "./backends/indexeddb";
import { StorageQuotaError } from "./types";
import type { StorageMode, StorageStatus } from "./types";
import type { Snippet } from "@/types";
import {
  buildClipioExport,
  buildClipioExportV2,
  buildClipioZip,
  snippetsContainMedia,
  extractMediaIds,
} from "@/lib/exporters/clipio";
import { getMedia, listMedia } from "@/storage/backends/media";
import { captureError } from "@/lib/sentry";
import { debugLog } from "@/lib/debug";
import {
  storageModeItem,
  storageModeReasonItem,
  syncDataLostItem,
} from "./items";

export class StorageManager {
  private sync = new SyncBackend();
  private local = new LocalBackend();
  private idb = new IndexedDBBackend();

  // -------------------------------------------------------------------------
  // Mode helpers
  // -------------------------------------------------------------------------

  private async getMode(): Promise<StorageMode> {
    return storageModeItem.getValue();
  }

  private async setMode(mode: StorageMode): Promise<void> {
    await storageModeItem.setValue(mode);
  }

  // -------------------------------------------------------------------------
  // Public status
  // -------------------------------------------------------------------------

  async getStorageStatus(): Promise<StorageStatus> {
    const mode = await this.getMode();
    const localReason = await storageModeReasonItem.getValue();
    return {
      mode,
      quotaExceeded: mode === "local" && localReason === "quota",
      localReason,
    };
  }

  /**
   * Force a switch to the given storage backend, migrating all snippets
   * from the current backend to the target backend first so no data is lost.
   *
   * Steps:
   *   1. If already on the requested mode, no-op.
   *   2. Read snippets from the current backend.
   *   3. Write them to the target backend.
   *   4. Update the mode flag.
   *   5. Refresh the content-script cache.
   */
  async forceSetMode(mode: StorageMode): Promise<void> {
    const current = await this.getMode();
    if (current === mode) return;

    // Read from whichever backend is currently active
    const snippets =
      current === "local"
        ? await this.local.getSnippets()
        : await this.sync.getSnippets();

    // Write to the target backend
    if (mode === "local") {
      await this.local.saveSnippets(snippets);
    } else {
      await this.sync.saveSnippets(snippets);
    }

    await this.setMode(mode);
    // Record reason so the UI can distinguish a manual switch from a quota overflow
    await storageModeReasonItem.setValue("manual");
    await updateContentScriptCache(snippets);

    // Shadow-write the migrated data to IDB backup
    this.idb.saveSnippets(snippets).catch((err) => {
      console.warn("[Clipio] IDB backup write failed after mode switch:", err);
      captureError(err, { action: "forceSetMode.idbBackup" });
    });
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async getSnippets(): Promise<Snippet[]> {
    const mode = await this.getMode();
    if (mode === "local") {
      return this.local.getSnippets();
    }

    try {
      return await this.sync.getSnippets();
    } catch (error) {
      if (error instanceof StorageQuotaError) {
        // Sync is unreadable — fall back silently
        captureError(error, { action: "getSnippets", fallback: "local" });
        await this.setMode("local");
        await storageModeReasonItem.setValue("quota");
        return this.local.getSnippets();
      }
      throw error;
    }
  }

  /**
   * Attempt to recover snippets from the IndexedDB backup.
   * Returns the recovered snippets (empty array if none found).
   * Does NOT automatically persist them — the UI prompts the user
   * first, then calls bulkSaveSnippets() if they confirm.
   */
  async tryRecoverFromBackup(): Promise<Snippet[]> {
    return this.idb.getSnippets();
  }

  /**
   * Returns the number of snippets stored in the IndexedDB backup.
   * 0 means either no backup exists or the backup is empty.
   */
  async getBackupInfo(): Promise<{ snippetCount: number }> {
    const count = await this.idb.getSnippetCount();
    return { snippetCount: count };
  }

  /**
   * Clear the sync-data-lost flag once the user has been notified.
   */
  async clearSyncDataLostFlag(): Promise<void> {
    await syncDataLostItem.removeValue();
  }

  // -------------------------------------------------------------------------
  // Write helpers
  // -------------------------------------------------------------------------

  /** Save the full snippets list and always update the content-script cache. */
  private async persistSnippets(snippets: Snippet[]): Promise<void> {
    const mode = await this.getMode();

    debugLog("storage", "persist:write", {
      backend: mode,
      count: snippets.length,
    }).catch(() => {});

    if (mode === "local") {
      await this.local.saveSnippets(snippets);
    } else {
      try {
        await this.sync.saveSnippets(snippets);
      } catch (error) {
        if (error instanceof StorageQuotaError) {
          // Switch to local permanently for this session and beyond
          await this.setMode("local");
          await storageModeReasonItem.setValue("quota");
          await this.local.saveSnippets(snippets);
          // Re-throw so callers can surface the warning to the user once
          throw error;
        }
        throw error;
      }
    }

    // Always keep the content-script cache current
    await updateContentScriptCache(snippets);

    // Shadow-write to IndexedDB backup (fire-and-forget — never blocks saves)
    this.idb.saveSnippets(snippets).catch((err) => {
      console.warn("[Clipio] IndexedDB backup write failed:", err);
      captureError(err, { action: "idbBackupWrite" });
    });
  }

  /**
   * The backend for the current mode.
   *
   * Note the content script cannot use the manager at all — `storage.sync` is
   * unreachable from a content script's isolated world — so the manager is a
   * per-JS-context singleton rather than a true process-wide one. The popup and
   * the options page are separate contexts with separate instances, which is
   * exactly why mutations below are intent-based rather than read-modify-write.
   */
  private async activeBackend() {
    const mode = await this.getMode();
    return mode === "local" ? this.local : this.sync;
  }

  /**
   * Apply an upsert to the active backend, then refresh derived stores.
   *
   * With the quota fallback the data has already been written to local, so
   * there is nothing more to do for the primary.
   */
  private async applyUpsert(snippets: Snippet[]): Promise<void> {
    debugLog("storage", "snippet:upsert", {
      count: snippets.length,
    }).catch(() => {});

    const mode = await this.getMode();
    if (mode === "local") {
      await this.local.upsertSnippets(snippets);
    } else {
      try {
        await this.sync.upsertSnippets(snippets);
      } catch (error) {
        if (error instanceof StorageQuotaError) {
          // Fall back for this write. The previous list was read by the caller
          // in most paths; for a single-snippet upsert there is nothing to
          // re-read, so merge onto whatever local already holds.
          await this.setMode("local");
          await storageModeReasonItem.setValue("quota");
          await this.local.upsertSnippets(snippets);
          throw error;
        }
        throw error;
      }
    }

    await this.refreshDerivedStores(mode);
  }

  /** Apply a by-id removal to the active backend, then refresh derived stores. */
  private async applyRemoval(ids: string[]): Promise<void> {
    debugLog("storage", "snippet:remove", { count: ids.length }).catch(
      () => {}
    );

    const mode = await this.getMode();
    if (mode === "local") {
      await this.local.removeSnippetsById(ids);
    } else {
      try {
        await this.sync.removeSnippetsById(ids);
      } catch (error) {
        if (error instanceof StorageQuotaError) {
          await this.setMode("local");
          await storageModeReasonItem.setValue("quota");
          await this.local.removeSnippetsById(ids);
          throw error;
        }
        throw error;
      }
    }

    await this.refreshDerivedStores(mode);
  }

  /**
   * Refresh the content-script cache and the IndexedDB shadow backup.
   *
   * Both are derived from the authoritative store, so they re-read rather than
   * trusting the caller's list. A stale derived store is how a user ends up
   * typing a shortcut and getting yesterday's snippet.
   */
  private async refreshDerivedStores(mode: StorageMode): Promise<void> {
    const fresh = await this.getSnippets();

    await updateContentScriptCache(fresh);

    // Fire-and-forget: the backup must never block or fail a save.
    this.idb.saveSnippets(fresh).catch((err) => {
      console.warn("[Clipio] IndexedDB backup write failed:", err);
      captureError(err, { action: "idbBackupWrite" });
    });
    void mode;
  }

  // -------------------------------------------------------------------------
  // CRUD operations
  // -------------------------------------------------------------------------

  /**
   * Create a snippet.
   *
   * Writes only this snippet rather than read-all-then-write-all, so a snippet
   * another extension context created in the meantime is not clobbered.
   */
  async saveSnippet(snippet: Snippet): Promise<void> {
    debugLog("storage", "snippet:save", {
      id: snippet.id,
      shortcut: snippet.shortcut,
    }).catch(() => {});
    await this.applyUpsert([snippet]);
  }

  async updateSnippet(updated: Snippet): Promise<void> {
    debugLog("storage", "snippet:update", {
      id: updated.id,
      shortcut: updated.shortcut,
    }).catch(() => {});
    await this.applyUpsert([updated]);
  }

  /**
   * Delete a snippet by id.
   *
   * Previously this read the whole store, filtered it, and wrote the list back.
   * A snippet created in another context between that read and the write was
   * absent from the stale list, so the write deleted it — a silent cross-context
   * data loss that `manager.test.ts` could not see because it only ever tested
   * one context at a time.
   */
  async deleteSnippet(id: string): Promise<void> {
    debugLog("storage", "snippet:delete", { id }).catch(() => {});
    await this.applyRemoval([id]);
  }

  /**
   * Replace the whole set. Used by import, which genuinely means "these are all
   * my snippets" — the ImportWizard has already resolved conflicts and
   * duplicates with the user.
   */
  async bulkSaveSnippets(snippets: Snippet[]): Promise<void> {
    debugLog("storage", "snippet:bulkSave", { count: snippets.length }).catch(
      () => {}
    );
    await this.persistSnippets(snippets);
  }

  /**
   * Clear all snippets from the IndexedDB backup store.
   * Used by the Developers section to let power users wipe the IDB backup
   * without affecting the primary sync/local storage.
   */
  async clearIDBBackup(): Promise<void> {
    debugLog("storage", "idb:clear", {}).catch(() => {});
    await this.idb.clear();
  }

  // -------------------------------------------------------------------------
  // Export / Import
  // -------------------------------------------------------------------------

  async exportSnippets(): Promise<void> {
    const snippets = await this.getSnippets();

    if (snippetsContainMedia(snippets)) {
      // v2: ZIP export with embedded images
      try {
        const mediaIds = extractMediaIds(snippets);
        const allMeta = await listMedia();
        const referencedMeta = allMeta.filter((m) => mediaIds.includes(m.id));

        const blobs = new Map<string, Blob>();
        for (const meta of referencedMeta) {
          const entry = await getMedia(meta.id);
          if (entry?.blob) {
            blobs.set(meta.id, entry.blob);
          }
        }

        const payload = buildClipioExportV2(snippets, referencedMeta);
        const zipBlob = await buildClipioZip(payload, blobs);
        const url = URL.createObjectURL(zipBlob);

        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `clipio-snippets-${new Date().toISOString().slice(0, 10)}.clipio.zip`;
        anchor.click();
        URL.revokeObjectURL(url);
        return;
      } catch (err) {
        captureError(err, { action: "export.zip" });
        // Fall through to JSON export as a fallback
      }
    }

    // v1: plain JSON export (no images, or ZIP failed)
    const payload = buildClipioExport(snippets);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `clipio-snippets-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();

    URL.revokeObjectURL(url);
  }

  async importSnippets(file: File): Promise<{ imported: number }> {
    const text = await file.text();
    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON file.");
    }

    if (!Array.isArray(parsed)) {
      throw new Error("File must contain a JSON array of snippets.");
    }

    // Basic shape validation
    const valid = parsed.filter(
      (item): item is Snippet =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Snippet).id === "string" &&
        typeof (item as Snippet).label === "string" &&
        typeof (item as Snippet).shortcut === "string" &&
        typeof (item as Snippet).content === "string"
    );

    if (valid.length === 0) {
      throw new Error("No valid snippets found in the file.");
    }

    // Merge: existing snippets not in the import keep their data
    const existing = await this.getSnippets();
    const existingIds = new Set(existing.map((s) => s.id));
    const toAdd = valid.filter((s) => !existingIds.has(s.id));

    await this.persistSnippets([...existing, ...toAdd]);
    return { imported: toAdd.length };
  }
}
