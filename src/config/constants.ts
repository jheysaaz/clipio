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
  MEDIA_STORE_NAME: "media",
  /** v1: snippets store | v2: media store | v3: hash index on media */
  VERSION: 3,
} as const;

export const MEDIA_LIMITS = {
  /** Maximum size per uploaded file (bytes). */
  MAX_FILE_SIZE: 2 * 1024 * 1024, // 2 MB
  /** Maximum total size of all stored media (bytes). */
  MAX_TOTAL_SIZE: 50 * 1024 * 1024, // 50 MB
  /** Allowed MIME types for image upload. */
  SUPPORTED_TYPES: [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ] as const,
} as const;

export const TIMING = {
  /** Milliseconds after typing stops before attempting snippet expansion. */
  TYPING_TIMEOUT: 300,
} as const;

/** Runtime message type for dev-only Sentry test (content script). */
export const SENTRY_TEST_MESSAGE_TYPE = "clipio-test-sentry" as const;

/** Runtime message type for content-script ping/health-check (always-on). */
export const CONTENT_SCRIPT_PING_MESSAGE_TYPE = "clipio-ping" as const;

/** Alarm name for the periodic update check (fires every 6 hours). */
export const UPDATE_CHECK_ALARM_NAME = "clipio-update-check" as const;

/** How often to check for updates (minutes). */
export const UPDATE_CHECK_INTERVAL_MINUTES = 360 as const;

/** Context-menu item IDs. */
export const CONTEXT_MENU = {
  PARENT: "clipio-parent",
  SAVE_SELECTION: "clipio-save-selection",
  CREATE_SNIPPET: "clipio-create-snippet",
  OPEN_DASHBOARD: "clipio-open-dashboard",
  GIVE_FEEDBACK: "clipio-give-feedback",
  SEPARATOR_HIDE: "clipio-separator-hide",
  HIDE_ON_SITE: "clipio-hide-on-site",
} as const;
