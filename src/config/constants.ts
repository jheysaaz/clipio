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
  /** Local-only version history. Never syncs, exports or feeds the cache. */
  HISTORY_STORE_NAME: "history",
  /**
   * IndexedDB schema version — an internal DB revision, NOT an extension
   * release version. Migration history with the extension release that
   * shipped each feature:
   *   1 — snippets store             (shipped in 1.2.0)
   *   2 — media store                (shipped in 1.4.0)
   *   3 — hash index on media store  (shipped in 1.4.1)
   *   4 — local history store        (autosave)
   */
  VERSION: 4,
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

  /**
   * Coalescing window (ms) for refreshing the content-script cache after a
   * change in `storage.sync`.
   *
   * `storage.sync` fires once per key, so a bulk import would otherwise
   * trigger one full store read per snippet.
   */
  CACHE_REFRESH_DEBOUNCE_MS: 250,

  /**
   * How long a list row waits before treating a click as a plain selection.
   *
   * A double-click emits click, click, dblclick, so the row has already handled
   * two clicks by the time the editor opens. Deferring the click by this long
   * and cancelling it if a dblclick arrives is the only way to stop
   * "double-click to rename" from also selecting the snippet.
   */
  DOUBLE_CLICK_MS: 250,
} as const;

// Runtime message types used to live here as bare string constants. They are now
// in src/lib/protocol/index.ts, declared in one typed map with their payloads and
// responses, so a mismatched message is a compile error rather than an undefined
// arriving at runtime.

/** Alarm name for the periodic update check (fires every 6 hours). */
export const UPDATE_CHECK_ALARM_NAME = "clipio-update-check" as const;

/** How often to check for updates (minutes). */
export const UPDATE_CHECK_INTERVAL_MINUTES = 360 as const;

/**
 * Minimum gap between two update checks (hours).
 *
 * The alarm alone is not a throttle. `background.ts` also calls checkForUpdate()
 * at the top level of the service worker, so it runs on every wake-up, and an
 * MV3 worker is evicted after ~30s idle — many times a day. Unauthenticated
 * GitHub API calls are rate limited per IP, so without this the extension can
 * spend a large share of its quota on checks that mostly find nothing.
 *
 * Deliberately longer than UPDATE_CHECK_INTERVAL_MINUTES: the alarm is the
 * floor for *when a check may happen*, this is the floor for *how often one
 * actually does*.
 */
export const UPDATE_CHECK_MIN_INTERVAL_HOURS = 24 as const;

// ---------------------------------------------------------------------------
// Review prompt
// ---------------------------------------------------------------------------

/** Alarm name for the review-prompt eligibility check. */
export const REVIEW_CHECK_ALARM_NAME = "clipio-review-check" as const;

/**
 * How long after install the first review-prompt check runs (hours).
 *
 * ONE-SHOT, NOT PERIODIC. The review prompt is shown at most once per install,
 * so a repeating alarm would wake the service worker indefinitely to re-evaluate
 * a condition that can only ever fail.
 *
 * Why one-shot is deliberate: `shouldShowReviewPrompt()` requires state
 * `"pending"`, and on success writes `"shown"`. Nothing returns the state to
 * `"pending"` - the lifecycle is one-way (pending -> shown -> dismissed | rated).
 * A periodic alarm therefore qualified exactly once and was a no-op after that,
 * while still costing a service-worker wakeup every 6 hours indefinitely. Chrome
 * penalises MV3 service-worker abuse, so that is a real cost for no behaviour.
 *
 * If re-prompting is ever wanted it needs a cooldown AND a reset of the state
 * machine, not just a period. That is a product decision, not a config change.
 */
export const REVIEW_CHECK_DELAY_HOURS = 6 as const;

/** Minimum days since install before the review prompt can be shown. */
export const REVIEW_MIN_DAYS = 7 as const;

/** Minimum total snippet expansions before the review prompt can be shown. */
export const REVIEW_MIN_INSERTIONS = 20 as const;

/**
 * Hours to snooze the review prompt when a recent Sentry error is detected.
 * The prompt is rescheduled this many hours into the future.
 */
export const REVIEW_ERROR_SNOOZE_HOURS = 24 as const;

// ---------------------------------------------------------------------------
// Website locales
// ---------------------------------------------------------------------------

/**
 * Locale codes supported by the clipio.xyz website.
 * Used to select the correct /{locale}/uninstall path. The name is historical:
 * this list originally served the external onboarding page that no longer
 * exists. Any browser locale not in this list falls back to "en".
 */
export const ONBOARDING_SUPPORTED_LOCALES = ["en", "es"] as const;

/** Context-menu item IDs. */
/**
 * Popup sidebar geometry.
 *
 * In `constants.ts` rather than in the component so the clamp that enforces them
 * lives next to them — see `src/store/sidebar.ts`.
 */
export const SIDEBAR_MIN_WIDTH = 120;
/**
 * The popup's sidebar can grow well past its default.
 *
 * It could not before: `SIDEBAR_MAX_WIDTH` was 240, which is also
 * `DEFAULT_SIDEBAR_WIDTH`, so the clamp left no headroom in either direction and
 * dragging right did nothing at all. The user could only ever make the sidebar
 * smaller. The popup sizes itself to its content, so the ceiling here is about
 * leaving the detail pane usable rather than about the window.
 */
export const SIDEBAR_MAX_WIDTH = 380;
export const DEFAULT_SIDEBAR_WIDTH = 240;

export const CONTEXT_MENU = {
  PARENT: "clipio-parent",
  SAVE_SELECTION: "clipio-save-selection",
  CREATE_SNIPPET: "clipio-create-snippet",
  /**
   * Opens the **options page** — the key says so, the id string does not.
   *
   * The key was `OPEN_DASHBOARD` because there was no popup routing when it was
   * written, so "the Clipio page" could only mean the options page; the menu label
   * is now "Open options", which is what the item does. The id string stays: it is
   * a stored identifier in the user's own context-menu registry, and renaming it
   * would orphan every existing item for no gain — `registerContextMenus` calls
   * `removeAll()` before re-creating them anyway.
   */
  OPEN_OPTIONS: "clipio-open-dashboard",
  GIVE_FEEDBACK: "clipio-give-feedback",
  SEPARATOR_HIDE: "clipio-separator-hide",
  HIDE_ON_SITE: "clipio-hide-on-site",
} as const;

/**
 * The popup route the background asks a popup to boot into.
 *
 * ── Why a key at all ──────────────────────────────────────────────────────────
 *
 * `browser.action.openPopup()` takes no URL, and the popup reopens at whatever
 * route it was last showing. There is no API for the service worker to address an
 * extension popup, so the only way for a menu item to name the page it wants is
 * to leave the name somewhere the popup will read — and `storage.session` is
 * already the channel the context-menu draft uses, for the same reason.
 *
 * `session`, not `local`: a stale request must not survive the browser closing. A
 * pending "open the create form" from yesterday evening is not something the user
 * asked for today.
 *
 * The value is a popup route (`#/…`), and the popup navigates to it with
 * `replace` — see docs/decisions/0011: the popup is addressed but keeps no
 * history, so `history.length` never grows while it is open.
 */
export const POPUP_VIEW_SESSION_KEY = "__clipioPopupView__";
