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
import { DEFAULT_SIDEBAR_WIDTH } from "@/config/constants";
import {
  DEFAULT_DARK_CODE_THEME,
  DEFAULT_LIGHT_CODE_THEME,
  type DarkCodeTheme,
  type LightCodeTheme,
} from "@/lib/code-theme";
import type { ContextUsage } from "@/lib/context-usage";
import type { DraftMap } from "@/lib/snippet-draft";
import type { UndoStacks } from "@/lib/undo-stack";
import type { QueueState } from "@/lib/write-queue";
import {
  NOT_STARTED_ONBOARDING,
  type OnboardingProgress,
} from "@/lib/onboarding-progress";
import type { Snippet } from "@/types";

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

/**
 * In-progress editor drafts, keyed by snippet id (including provisional ids).
 * Local-only: never synced, exported, imported, indexed or cached.
 */
export const editorDraftsItem = storage.defineItem<DraftMap>(
  "local:editorDrafts",
  { defaultValue: {} }
);

/**
 * Pending writes owned by the background worker. Local-only and deliberately
 * excluded from the backup settings allowlist and the content-script cache.
 */
export const writeQueueItem = storage.defineItem<QueueState>(
  "local:writeQueue",
  { defaultValue: { operations: [], sentAt: [] } }
);

/**
 * Local-only undo/redo cursors. The long-term record is version history; these
 * stacks only remember step direction across popup closes.
 */
export const undoStacksItem = storage.defineItem<UndoStacks>(
  "local:undoStacks",
  { defaultValue: {} }
);

/**
 * Stable id used as the final `updatedBy` tie-break in LWW resolution.
 * Created on first use and never backed up: it identifies this install, not
 * the user's snippets.
 */
export const writerIdItem = storage.defineItem<string>("local:writerId", {
  defaultValue: "unknown",
});

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

/**
 * Whether storage needs attention while the popup is closed.
 *
 * Set by a quota refusal, which can happen while the active mode is still
 * `sync`, and cleared by the next successful write or status read. The
 * background watches this to own the toolbar badge: a popup that dies on blur
 * cannot be trusted to keep an indicator up to date.
 */
export const storageAttentionItem = storage.defineItem<boolean>(
  "local:storageAttention",
  { defaultValue: false }
);

// ---------------------------------------------------------------------------
// UI flags
// ---------------------------------------------------------------------------

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

/**
 * Whether the popup's floating "Local only" island is shown when sync is off.
 *
 * Persisted because the popup closes on every blur: as component state a user
 * who hid the island would see it again the next time they opened the popup.
 */
export const localOnlyIndicatorEnabledItem = storage.defineItem<boolean>(
  "local:localOnlyIndicatorEnabled",
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

/**
 * Prism palette used by fenced code blocks in light mode.
 *
 * Normalised on read by the settings store: storage can be restored from a
 * backup containing a preset this build no longer ships.
 */
export const lightCodeThemeItem = storage.defineItem<LightCodeTheme>(
  "local:lightCodeTheme",
  { defaultValue: DEFAULT_LIGHT_CODE_THEME }
);

/** Prism palette used by fenced code blocks in dark mode. */
export const darkCodeThemeItem = storage.defineItem<DarkCodeTheme>(
  "local:darkCodeTheme",
  { defaultValue: DEFAULT_DARK_CODE_THEME }
);

/** Legacy theme key — read-only, used for one-time migration. */
export const legacyThemeItem = storage.defineItem<string | null>(
  "local:theme",
  { defaultValue: null }
);

// ---------------------------------------------------------------------------
// Interface font
// ---------------------------------------------------------------------------

export type { UiFont };
import type { UiFont } from "@/lib/ui-font";
import { DEFAULT_UI_FONT } from "@/lib/ui-font";

/**
 * User-selected interface font, applied to every Clipio surface (options page,
 * popup and the in-page preview palette). Monospace surfaces — the debug log,
 * `code`/`pre` — stay on JetBrains Mono and are deliberately not affected.
 *
 * The stored value is normalised on read by `normalizeUiFont`, because storage
 * can be restored from a backup or written by another extension context and is
 * not guaranteed to hold one of our options.
 *
 */
export const uiFontItem = storage.defineItem<UiFont>("local:uiFont", {
  defaultValue: DEFAULT_UI_FONT,
});

// ---------------------------------------------------------------------------
// Popup layout
// ---------------------------------------------------------------------------

/**
 * The popup sidebar's width, in pixels.
 *
 * Persisted so the resize survives a popup closing — which it does on every blur,
 * so "without this it resets constantly" is not a hypothetical. Clamped on read as
 * well as on write, because the popup and the options page are different documents
 * and a stale value from an older build could exceed the bounds the resizer
 * enforces.
 */
export const sidebarWidthItem = storage.defineItem<number>(
  "local:sidebarWidth",
  {
    defaultValue: DEFAULT_SIDEBAR_WIDTH,
  }
);

/**
 * Whether the popup sidebar is expanded.
 *
 * Persisted, which it was not before: the collapsed state was component state, so
 * it reset to expanded on every popup open and a user who had deliberately made
 * room by collapsing the sidebar had to do it again every single time.
 *
 * Separate from the width rather than encoded in it, because "collapsed" and
 * "narrow" are different intentions — someone who collapsed it wants the detail
 * pane, not a sliver of list.
 */
export const sidebarOpenItem = storage.defineItem<boolean>(
  "local:sidebarOpen",
  {
    defaultValue: true,
  }
);

/**
 * The snippet the user last had open in the popup.
 *
 * Not derivable from `usageCountsItem`, which counts *insertions* rather than
 * views: someone reading a snippet they have never inserted is the common case, and
 * the one where a usage-derived "recent" is wrong.
 *
 * `null` means "nothing remembered yet", which is also what a cleared library and a
 * never-opened popup both look like — so the reader treats a missing or stale id as
 * "fall back", not as an error.
 */
export const lastViewedSnippetIdItem = storage.defineItem<string | null>(
  "local:lastViewedSnippetId",
  {
    defaultValue: null,
  }
);

// ---------------------------------------------------------------------------
// Usage tracking
// ---------------------------------------------------------------------------

/** Per-snippet usage counts: { [snippetId]: count }. */
export const usageCountsItem = storage.defineItem<Record<string, number>>(
  "local:snippetUsageCount",
  { defaultValue: {} }
);

/**
 * Local-only recency and site-relevance signals for popup ranking.
 *
 * Site values here are bare hostnames, never full URLs. This item is
 * deliberately separate from `usageCountsItem` (which is a plain count) and
 * from synced data: it describes where the user worked, not what they wrote.
 */
export const snippetContextUsageItem = storage.defineItem<ContextUsage>(
  "local:snippetContextUsage",
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
 * Persisted progress for the in-extension guided tour. The popup hands off to
 * the options page through this item, because opening Options closes the popup
 * and no overlay can survive the jump.
 */
export const guidedOnboardingStateItem = storage.defineItem<OnboardingProgress>(
  "local:guidedOnboarding",
  {
    defaultValue: NOT_STARTED_ONBOARDING,
  }
);

/**
 * Whether the user closed the first-success checklist.
 *
 * The checklist itself is derived from the library and insertion counters, so
 * this is the only flag it owns. One-way on purpose: once dismissed it stays
 * dismissed for this install, rather than reappearing on the next popup open.
 */
export const activationDismissedItem = storage.defineItem<boolean>(
  "local:activationDismissed",
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

// ---------------------------------------------------------------------------
// Snippet preview
// ---------------------------------------------------------------------------

/** Whether the snippet preview/filter UI is enabled in content script. */
export const snippetPreviewEnabledItem = storage.defineItem<boolean>(
  "local:snippetPreviewEnabled",
  { defaultValue: true }
);

/**
 * Global prefix character that triggers the snippet preview UI.
 * When typed after a word boundary, shows the preview menu.
 * Default: "/" (forward slash).
 */
export const snippetPreviewPrefixItem = storage.defineItem<string>(
  "local:snippetPreviewPrefix",
  { defaultValue: "/" }
);

/**
 * Keyboard shortcut to manually open the snippet preview UI.
 *
 * Stored as the platform-neutral `Mod` spelling, matching the registry default
 * and its reset action. A `Ctrl` default here made a clean install look dirty:
 * the settings row compared the two strings literally and offered a reset.
 */
export const snippetPreviewShortcutItem = storage.defineItem<string>(
  "local:snippetPreviewShortcut",
  { defaultValue: "Mod+Shift+Space" }
);
