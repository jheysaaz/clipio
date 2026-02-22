/**
 * StorageManager — orchestrates backends and owns the fallback logic.
 *
 * Flow:
 *   1. Always try SyncBackend first (browser.storage.sync).
 *   2. If it throws StorageQuotaError → persist the fallback flag,
 *      notify via a status flag, and retry with LocalBackend.
 *   3. Always keep the content-script cache (browser.storage.local) in sync.
 *
 * The manager is a singleton; import the pre-built instance from index.ts.
 */

import { SyncBackend } from "./backends/sync";
import { LocalBackend, updateContentScriptCache } from "./backends/local";
import { StorageQuotaError } from "./types";
import type { StorageMode, StorageStatus } from "./types";
import type { Snippet } from "~/types";

/** Key used to persist the current storage mode across sessions. */
const MODE_KEY = "storageMode";

export class StorageManager {
  private sync = new SyncBackend();
  private local = new LocalBackend();

  // -------------------------------------------------------------------------
  // Mode helpers
  // -------------------------------------------------------------------------

  private async getMode(): Promise<StorageMode> {
    const result = await browser.storage.local.get(MODE_KEY);
    return (result[MODE_KEY] as StorageMode) ?? "sync";
  }

  private async setMode(mode: StorageMode): Promise<void> {
    await browser.storage.local.set({ [MODE_KEY]: mode });
  }

  // -------------------------------------------------------------------------
  // Public status
  // -------------------------------------------------------------------------

  async getStorageStatus(): Promise<StorageStatus> {
    const mode = await this.getMode();
    return { mode, quotaExceeded: mode === "local" };
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
        await this.setMode("local");
        return this.local.getSnippets();
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Write helpers
  // -------------------------------------------------------------------------

  /** Save the full snippets list and always update the content-script cache. */
  private async persistSnippets(snippets: Snippet[]): Promise<void> {
    const mode = await this.getMode();

    if (mode === "local") {
      await this.local.saveSnippets(snippets);
    } else {
      try {
        await this.sync.saveSnippets(snippets);
      } catch (error) {
        if (error instanceof StorageQuotaError) {
          // Switch to local permanently for this session and beyond
          await this.setMode("local");
          await this.local.saveSnippets(snippets);
          // Re-throw so callers can surface the warning to the user once
          throw error;
        }
        throw error;
      }
    }

    // Always keep the content-script cache current
    await updateContentScriptCache(snippets);
  }

  // -------------------------------------------------------------------------
  // CRUD operations
  // -------------------------------------------------------------------------

  async saveSnippet(snippet: Snippet): Promise<void> {
    const snippets = await this.getSnippets();
    await this.persistSnippets([...snippets, snippet]);
  }

  async updateSnippet(updated: Snippet): Promise<void> {
    const snippets = await this.getSnippets();
    const next = snippets.map((s) => (s.id === updated.id ? updated : s));
    await this.persistSnippets(next);
  }

  async deleteSnippet(id: string): Promise<void> {
    const snippets = await this.getSnippets();
    const next = snippets.filter((s) => s.id !== id);
    await this.persistSnippets(next);
  }

  // -------------------------------------------------------------------------
  // Export / Import
  // -------------------------------------------------------------------------

  async exportSnippets(): Promise<void> {
    const snippets = await this.getSnippets();
    const json = JSON.stringify(snippets, null, 2);
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
