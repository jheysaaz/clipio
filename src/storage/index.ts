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

// Singleton instance shared across the popup
const manager = new StorageManager();

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
export const tryRecoverFromBackup = () => manager.tryRecoverFromBackup();
export const clearSyncDataLostFlag = () => manager.clearSyncDataLostFlag();
