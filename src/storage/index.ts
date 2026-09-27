/**
 * Public API for Clipio's storage layer.
 *
 * All snippet reads and writes go through this module.
 * Internals (backends, manager, fallback logic) are intentionally
 * not re-exported — callers only see the functions below.
 */

import { StorageManager } from "./manager";
export type { StorageStatus, StorageMode } from "./types";
export { StorageQuotaError } from "./types";

// Singleton instance shared across the popup.
//
// Note: this is a per-JS-context singleton, not a process-wide one. The popup,
// the options page and the background worker each get their own instance,
// because they are separate JavaScript contexts. The content script cannot use
// it at all — `storage.sync` is unreachable from a content script's isolated
// world — which is why a mirrored cache exists at all.
const manager = new StorageManager();

/**
 * The manager instance itself.
 *
 * Exported for the background worker, which needs to read through the manager
 * (so it respects the sync/local mode and the quota fallback) when refreshing
 * the content-script cache. Prefer the named functions above everywhere else.
 */
export { manager as storageManager };

export const getSnippets = () => manager.getSnippets();
export const saveSnippet = (snippet: import("~/types").Snippet) =>
  manager.saveSnippet(snippet);
export const updateSnippet = (snippet: import("~/types").Snippet) =>
  manager.updateSnippet(snippet);
export const deleteSnippet = (id: string) => manager.deleteSnippet(id);
export const getStorageStatus = () => manager.getStorageStatus();
export const exportSnippets = () => manager.exportSnippets();
export const importSnippets = (file: File) => manager.importSnippets(file);
export const bulkSaveSnippets = (snippets: import("~/types").Snippet[]) =>
  manager.bulkSaveSnippets(snippets);
export const getBackupInfo = () => manager.getBackupInfo();
export const tryRecoverFromBackup = () => manager.tryRecoverFromBackup();
export const clearSyncDataLostFlag = () => manager.clearSyncDataLostFlag();
export const clearIDBBackup = () => manager.clearIDBBackup();
export const forceSetStorageMode = (mode: import("./types").StorageMode) =>
  manager.forceSetMode(mode);
