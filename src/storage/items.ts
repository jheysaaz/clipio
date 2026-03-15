/**
 * Typed storage items using WXT's storage API.
 *
 * All browser.storage.local items are defined here as typed, reactive
 * storage items with sensible defaults. Import and use these instead of
 * raw browser.storage.local.get/set calls.
 *
 * NOTE: browser.storage.sync keys (snip:*) are dynamic per-snippet and
 * remain handled by SyncBackend via raw browser.storage.sync calls.
 */

import { storage } from "wxt/utils/storage";
import type { Snippet } from "~/types";

// ---------------------------------------------------------------------------
// Snippet data
// ---------------------------------------------------------------------------

/** Local-backend snippet storage (fallback when sync quota is exceeded). */
export const localSnippetsItem = storage.defineItem<Snippet[]>(
  "local:snippets",
  { defaultValue: [] }
);

/** Content-script cache — always kept in sync after every write. */
export const cachedSnippetsItem = storage.defineItem<Snippet[]>(
  "local:cachedSnippets",
  { defaultValue: [] }
);

/** Which storage backend is currently active. */
export const storageModeItem = storage.defineItem<"sync" | "local">(
  "local:storageMode",
  { defaultValue: "sync" }
);

/**
 * Why the extension is currently in local mode.
 *   "quota"  — auto-switched because browser.storage.sync quota was exceeded
 *   "manual" — the user explicitly switched via the Developers section
 * Only meaningful when storageModeItem === "local".
 */
export const storageModeReasonItem = storage.defineItem<"quota" | "manual">(
  "local:storageModeReason",
  { defaultValue: "quota" }
);

// ---------------------------------------------------------------------------
// UI flags
// ---------------------------------------------------------------------------

/** True once the user has seen (or dismissed) the uninstall data-loss warning. */
export const dismissedUninstallWarningItem = storage.defineItem<boolean>(
  "local:dismissedUninstallWarning",
  { defaultValue: false }
);

/** Set to true by the background when a sync sign-out wipe is detected. */
export const syncDataLostItem = storage.defineItem<boolean>(
  "local:syncDataLost",
  { defaultValue: false }
);

/** When false, confetti is suppressed on snippet insertion. */
export const confettiEnabledItem = storage.defineItem<boolean>(
  "local:confettiEnabled",
  { defaultValue: true }
);

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export type ThemeMode = "light" | "dark" | "system";

/** User-selected theme mode. */
export const themeModeItem = storage.defineItem<ThemeMode>("local:themeMode", {
  defaultValue: "system",
});

/** Legacy theme key — read-only, used for one-time migration. */
export const legacyThemeItem = storage.defineItem<string | null>(
  "local:theme",
  { defaultValue: null }
);

// ---------------------------------------------------------------------------
// Usage tracking
// ---------------------------------------------------------------------------

/** Per-snippet usage counts: { [snippetId]: count }. */
export const usageCountsItem = storage.defineItem<Record<string, number>>(
  "local:snippetUsageCount",
  { defaultValue: {} }
);

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

/** Temporary stash for selected text passed from context menu → popup. */
export const contextMenuDraftItem = storage.defineItem<string | null>(
  "local:contextMenuDraft",
  { defaultValue: null }
);

// ---------------------------------------------------------------------------
// Developers / advanced settings
// ---------------------------------------------------------------------------

/**
 * User-supplied Giphy API key override.
 * Empty string means "use the bundled default key".
 */
export const giphyApiKeyItem = storage.defineItem<string>("local:giphyApiKey", {
  defaultValue: "",
});

/**
 * List of hostnames where Clipio snippet expansion is disabled.
 * Populated via the "Hide on this site" context menu item.
 * Example: ["github.com", "twitter.com"]
 */
export const blockedSitesItem = storage.defineItem<string[]>(
  "local:blockedSites",
  { defaultValue: [] }
);

/**
 * User-configurable debounce delay (ms) for snippet expansion after typing stops.
 * Range: 50–2000ms. Default: 300ms (matches TIMING.TYPING_TIMEOUT).
 */
export const typingTimeoutItem = storage.defineItem<number>(
  "local:typingTimeout",
  { defaultValue: 300 }
);

/**
 * Whether verbose debug logging is enabled.
 * When true, extension activity is logged to the console and the in-page panel.
 */
export const debugModeItem = storage.defineItem<boolean>("local:debugMode", {
  defaultValue: false,
});

/** A single entry in the debug log circular buffer. */
export interface DebugLogEntry {
  /** Unix timestamp (Date.now()). */
  ts: number;
  /** Which part of the extension produced this entry. */
  context: "content" | "background" | "storage";
  /** Short event name, e.g. "expand:match". */
  event: string;
  /** Human-readable detail string (JSON-serialised where appropriate). */
  detail: string;
}

/**
 * Circular buffer of recent debug log entries (capped at 100).
 * Written by content script and background worker; read by the Options page.
 */
export const debugLogItem = storage.defineItem<DebugLogEntry[]>(
  "local:debugLog",
  { defaultValue: [] }
);

// ---------------------------------------------------------------------------
// Update notifications
// ---------------------------------------------------------------------------

/** Latest available release info fetched from GitHub API. Null if never checked or up-to-date. */
export const latestVersionItem = storage.defineItem<{
  version: string;
  htmlUrl: string;
  publishedAt: string;
} | null>("local:latestVersion", { defaultValue: null });

/** ISO timestamp of the last successful update check. */
export const latestVersionCheckedAtItem = storage.defineItem<string | null>(
  "local:latestVersionCheckedAt",
  { defaultValue: null }
);

/**
 * The latest version the user has explicitly dismissed.
 * When this equals latestVersion.version, the banner is suppressed.
 */
export const dismissedUpdateVersionItem = storage.defineItem<string>(
  "local:dismissedUpdateVersion",
  { defaultValue: "" }
);

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

/**
 * Set to true once the onboarding redirect has been triggered on first install.
 * Prevents re-opening the onboarding page on subsequent installs in development.
 */
export const onboardingCompletedItem = storage.defineItem<boolean>(
  "local:onboardingCompleted",
  { defaultValue: false }
);

// ---------------------------------------------------------------------------
// Review prompt
// ---------------------------------------------------------------------------

/**
 * ISO timestamp recorded once when the extension is first installed.
 * Used by the review-prompt eligibility check to ensure the user has had
 * enough time with the extension before being asked for a review.
 */
export const extensionInstalledAtItem = storage.defineItem<string | null>(
  "local:extensionInstalledAt",
  { defaultValue: null }
);

/**
 * Running counter of total snippet expansions across all snippets.
 * Incremented by the content script each time any snippet is expanded.
 * Used by the review-prompt eligibility check.
 */
export const totalSnippetInsertionsItem = storage.defineItem<number>(
  "local:totalSnippetInsertions",
  { defaultValue: 0 }
);

/**
 * Lifecycle state of the review prompt.
 *   "pending"   — prompt has not been shown yet (initial state)
 *   "shown"     — prompt was shown (background alarm fired, conditions met)
 *   "dismissed" — user explicitly closed the prompt without rating
 *   "rated"     — user clicked the rating link; prompt is permanently suppressed
 */
export type ReviewPromptState = "pending" | "shown" | "dismissed" | "rated";

export const reviewPromptStateItem = storage.defineItem<ReviewPromptState>(
  "local:reviewPromptState",
  { defaultValue: "pending" }
);

/**
 * ISO timestamp until which the review prompt is snoozed.
 * Set when recent Sentry errors are detected to avoid asking for a review
 * while the extension is misbehaving.
 */
export const reviewPromptSnoozedUntilItem = storage.defineItem<string | null>(
  "local:reviewPromptSnoozedUntil",
  { defaultValue: null }
);

/**
 * ISO timestamp of the most recent captureError() call.
 * Written by src/lib/sentry.ts as a fire-and-forget side-effect.
 * Read by the review-prompt eligibility check to suppress the prompt
 * when the extension has recently encountered errors.
 * Works unconditionally, even when Sentry DSN is absent.
 */
export const lastSentryErrorAtItem = storage.defineItem<string | null>(
  "local:lastSentryErrorAt",
  { defaultValue: null }
);
