/**
 * Application-wide constants.
 */

export const STORAGE_KEYS = {
  /** Primary snippets store (sync or local depending on mode). */
  SNIPPETS: "snippets",
  /** Content-script cache — always in browser.storage.local. */
  CACHED_SNIPPETS: "cachedSnippets",
  /** Persisted storage mode: "sync" | "local". */
  STORAGE_MODE: "storageMode",
} as const;

export const SYNC_QUOTA = {
  /** Hard total-bytes limit enforced by the browser. */
  TOTAL_BYTES: 102_400,
  /** Per-item limit — each individual storage key cannot exceed this. */
  BYTES_PER_ITEM: 8_192,
  /** Maximum number of keys allowed in storage.sync. */
  MAX_ITEMS: 512,
  /** Warn the user before hitting the hard total limit (bytes). */
  WARN_AT: 90_000,
} as const;

export const IDB_CONFIG = {
  DB_NAME: "clipio-backup",
  STORE_NAME: "snippets",
  VERSION: 1,
} as const;

/** Keys stored in browser.storage.local for UI state flags. */
export const FLAGS = {
  /** False on fresh install; true once the user dismisses the warning. */
  DISMISSED_UNINSTALL_WARNING: "dismissedUninstallWarning",
  /** Set to true by the background script when a sync sign-out is detected. */
  SYNC_DATA_LOST: "syncDataLost",
} as const;

export const TIMING = {
  /** Milliseconds after typing stops before attempting snippet expansion. */
  TYPING_TIMEOUT: 750,
  /** Duration a toast notification is shown (ms). */
  TOAST_DURATION: 3_000,
} as const;
