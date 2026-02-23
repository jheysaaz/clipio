/**
 * Application-wide constants.
 */

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

export const TIMING = {
  /** Milliseconds after typing stops before attempting snippet expansion. */
  TYPING_TIMEOUT: 300,
} as const;

/** Context-menu item IDs. */
export const CONTEXT_MENU = {
  PARENT: "clipio-parent",
  SAVE_SELECTION: "clipio-save-selection",
  CREATE_SNIPPET: "clipio-create-snippet",
  OPEN_DASHBOARD: "clipio-open-dashboard",
  GIVE_FEEDBACK: "clipio-give-feedback",
} as const;
