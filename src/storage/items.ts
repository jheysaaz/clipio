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
export const themeModeItem = storage.defineItem<ThemeMode>(
  "local:themeMode",
  { defaultValue: "system" }
);

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
