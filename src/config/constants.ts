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
  /** Hard limit enforced by the browser (bytes). */
  TOTAL_BYTES: 102_400,
  /** Warn the user before hitting the hard limit (bytes). */
  WARN_AT: 90_000,
} as const;

export const TIMING = {
  /** Milliseconds after typing stops before attempting snippet expansion. */
  TYPING_TIMEOUT: 750,
  /** Duration a toast notification is shown (ms). */
  TOAST_DURATION: 3_000,
} as const;
