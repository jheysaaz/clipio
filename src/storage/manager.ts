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
import { checkQuota } from "./quota-preflight";
import type { StorageMode, StorageStatus } from "./types";
import type { Snippet } from "@/types";
import {
  buildClipioExport,
  buildClipioExportV2,
  buildClipioZip,
  snippetsContainMedia,
  collectReferencedMediaIds,
} from "@/lib/exporters/clipio";
import { getMedia, listMedia } from "@/storage/backends/media";
import { captureError, captureMessage } from "@/lib/sentry";
import { validateImportPayload } from "@/lib/snippet-schema";
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

  /**
   * Read all snippets from the active backend.
   *
   * Deliberately does NOT write the content-script cache. A read cannot know
   * whether the cache is newer than the list it just read: if another context
   * saved or deleted snippets in between, a repair would overwrite that newer
   * state with this older list, and the content script would then expand a
   * snippet the user had just deleted. The empty case is not safe either — `[]`
   * is the *correct* cache immediately after the last snippet is deleted, so
   * "the cache is empty, therefore it is stale" is simply false.
   *
   * The cache therefore has a single writer, the background worker, which
   * observes the very storage change that made the cache stale. The legacy
   * contentFormat migration needs no second writer, which is why its converter
   * is DOM-free: the background converts a body exactly as a page would, so
   * the migration cannot depend on a page happening to read first.
   *
   * @see specs/cache-coherence.spec.md
   */
  async getSnippets(): Promise<Snippet[]> {
    return this.readActive();
  }

  /** Read from the active backend, applying the quota fallback. */
  private async readActive(): Promise<Snippet[]> {
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

    void debugLog("storage", "persist:write", {
      backend: mode,
      count: snippets.length,
    });

    // One quota rule for every sync write — see `withQuotaPreflight`.
    await this.withQuotaPreflight(
      mode,
      async () => ({
        existing: await this.sync.getSnippets(),
        incoming: snippets,
      }),
      () =>
        mode === "local"
          ? this.local.saveSnippets(snippets)
          : this.sync.saveSnippets(snippets)
    );

    // Always keep the content-script cache current
    await updateContentScriptCache(snippets);

    // Shadow-write to IndexedDB backup (fire-and-forget — never blocks saves)
    this.idb.saveSnippets(snippets).catch((err) => {
      console.warn("[Clipio] IndexedDB backup write failed:", err);
      captureError(err, { action: "idbBackupWrite" });
    });
  }

  // Note the content script cannot use the manager at all — `storage.sync` is
  // unreachable from a content script's isolated world — so the manager is a
  // per-JS-context singleton rather than a true process-wide one. The popup and
  // the options page are separate contexts with separate instances, which is
  // exactly why the mutations below are intent-based rather than
  // read-modify-write.

  /**
   * Run a mutation against the active backend with a quota preflight.
   *
   * Every sync write goes through here, so the quota rule lives in exactly one
   * place. Before the write, the projected post-write state is checked against
   * all three sync limits; if it would not fit, nothing is written, no mode is
   * changed, and a `StorageQuotaError` carrying the reasons is thrown for the
   * caller to explain.
   *
   * spec: specs/storage-quota-preflight.spec.md
   *
   * @param project what the store will look like after `mutate` succeeds.
   * @param mutate performs the write against whichever backend is active.
   */
  private async withQuotaPreflight<T>(
    mode: StorageMode,
    project: () => Promise<{ existing: Snippet[]; incoming: Snippet[] }>,
    mutate: () => Promise<T>
  ): Promise<T> {
    if (mode === "local") return mutate();

    const projected = await project();
    const check = checkQuota(projected.existing, projected.incoming);
    if (!check.ok) {
      void debugLog("storage", "quota:preflightRejected", {
        reasons: check.reasons.length,
      });
      throw new StorageQuotaError(undefined, check.reasons);
    }

    try {
      return await mutate();
    } catch (error) {
      if (error instanceof StorageQuotaError) {
        // The browser disagreed with the preflight, so `checkQuota`'s
        // projection is inaccurate. Report it — that is a bug in the preflight
        // and saying so is the only way to find it. We deliberately do NOT
        // switch to local: doing so silently and permanently is exactly the
        // behaviour this change exists to remove, and no data is at risk either
        // way because sync writes are journalled and rolled back.
        captureError(error, { action: "storage.quotaPreflightMiss" });
      }
      throw error;
    }
  }

  /**
   * Apply an upsert to the active backend, then refresh derived stores.
   */
  private async applyUpsert(snippets: Snippet[]): Promise<void> {
    void debugLog("storage", "snippet:upsert", {
      count: snippets.length,
    });

    const mode = await this.getMode();
    await this.withQuotaPreflight(
      mode,
      async () => {
        const existing = await this.sync.getSnippets();
        const byId = new Map(existing.map((s) => [s.id, s]));
        for (const s of snippets) byId.set(s.id, s);
        return { existing, incoming: [...byId.values()] };
      },
      () =>
        mode === "local"
          ? this.local.upsertSnippets(snippets)
          : this.sync.upsertSnippets(snippets)
    );

    await this.refreshDerivedStores(mode);
  }

  /** Apply a by-id removal to the active backend, then refresh derived stores. */
  private async applyRemoval(ids: string[]): Promise<void> {
    void debugLog("storage", "snippet:remove", { count: ids.length });

    const mode = await this.getMode();
    await this.withQuotaPreflight(
      mode,
      async () => {
        const existing = await this.sync.getSnippets();
        const drop = new Set(ids);
        return {
          existing,
          incoming: existing.filter((s) => !drop.has(s.id)),
        };
      },
      () =>
        mode === "local"
          ? this.local.removeSnippetsById(ids)
          : this.sync.removeSnippetsById(ids)
    );

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
    void debugLog("storage", "snippet:save", {
      id: snippet.id,
      shortcut: snippet.shortcut,
    });
    await this.applyUpsert([snippet]);
  }

  async updateSnippet(updated: Snippet): Promise<void> {
    void debugLog("storage", "snippet:update", {
      id: updated.id,
      shortcut: updated.shortcut,
    });
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
    void debugLog("storage", "snippet:delete", { id });
    await this.applyRemoval([id]);
  }

  /**
   * Replace the whole set. Used by import, which genuinely means "these are all
   * my snippets" — the ImportWizard has already resolved conflicts and
   * duplicates with the user.
   */
  async bulkSaveSnippets(snippets: Snippet[]): Promise<void> {
    void debugLog("storage", "snippet:bulkSave", { count: snippets.length });
    await this.persistSnippets(snippets);
  }

  /**
   * Clear all snippets from the IndexedDB backup store.
   * Used by the Developers section to let power users wipe the IDB backup
   * without affecting the primary sync/local storage.
   */
  async clearIDBBackup(): Promise<void> {
    void debugLog("storage", "idb:clear", {});
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
        const mediaIds = collectReferencedMediaIds(snippets);
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

    // Full validation, shared with the format importers. The previous inline
    // filter only checked that four fields were strings — no bounds, no
    // timestamps, no tags, no prototype keys — so a single 10 KB `content`
    // string in a hostile file could permanently exhaust the sync quota.
    // spec: specs/import-validation.spec.md
    const { accepted, rejected, tooManySnippets } =
      validateImportPayload(parsed);

    if (accepted.length === 0) {
      throw new Error("No valid snippets found in the file.");
    }

    if (tooManySnippets || rejected.length > 0) {
      captureMessage("Some imported records were rejected", "warning", {
        action: "importSnippets",
        accepted: accepted.length,
        rejected: rejected.length,
        tooManySnippets,
      });
    }

    // Merge: existing snippets not in the import keep their data
    const existing = await this.getSnippets();
    const existingIds = new Set(existing.map((s) => s.id));
    const toAdd = accepted.filter((s) => !existingIds.has(s.id));

    await this.persistSnippets([...existing, ...toAdd]);
    return { imported: toAdd.length };
  }
}
