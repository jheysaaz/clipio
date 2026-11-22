/**
 * The settings a versioned backup owns.
 *
 * This is an allowlist, not a filter over "everything in storage.local".
 * browser.storage.local is writable from developer tools, and a hand-edited
 * backup is untrusted input. Naming each key here means a new storage item
 * cannot silently become part of a backup — someone has to add it, choose a
 * validator, and say why in the ADR.
 *
 * Keys are the RAW browser.storage.local keys, not WXT's `local:` form. WXT
 * strips that prefix before writing; using the prefixed string here would read
 * nothing and produce backups with no settings in them.
 */

import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "@/config/constants";
import { isUiFont } from "@/lib/ui-font";

/** Every persisted setting that is safe to put in a backup. */
export const BACKUP_SETTING_KEYS = [
  "storageMode",
  "storageModeReason",
  "syncDataLost",
  "confettiEnabled",
  "themeMode",
  "theme",
  "uiFont",
  "sidebarWidth",
  "sidebarOpen",
  "lastViewedSnippetId",
  "contextMenuDraft",
  "blockedSites",
  "typingTimeout",
  "debugMode",
  "latestVersion",
  "latestVersionCheckedAt",
  "dismissedUpdateVersion",
  "guidedOnboarding",
  "activationDismissed",
  "extensionInstalledAt",
  "reviewPromptState",
  "reviewPromptSnoozedUntil",
  "snippetPreviewEnabled",
  "snippetPreviewPrefix",
  "snippetPreviewShortcut",
] as const;

export type BackupSettingKey = (typeof BACKUP_SETTING_KEYS)[number];

const BACKUP_SETTING_KEY_SET: ReadonlySet<string> = new Set(
  BACKUP_SETTING_KEYS
);

/**
 * Keys deliberately absent from the allowlist, with the reason kept next to
 * the key so a future reader does not have to infer it from an omission.
 */
export const BACKUP_EXCLUDED_KEYS = [
  { key: "snippets", reason: "captured-as-snippets" },
  { key: "cachedSnippets", reason: "derived-cache" },
  { key: "snippetUsageCount", reason: "local-analytics" },
  { key: "snippetContextUsage", reason: "local-context" },
  { key: "totalSnippetInsertions", reason: "local-analytics" },
  { key: "lastSentryErrorAt", reason: "local-diagnostics" },
  { key: "giphyApiKey", reason: "secret" },
  { key: "debugLog", reason: "logs" },
] as const;

export type SettingsSkipReason =
  "invalid-section" | "invalid-value" | "write-failed";

export interface SettingsSkip {
  key: string;
  reason: SettingsSkipReason;
}

export interface SettingsSelection {
  /** Valid, allowlisted values, ready to write. */
  values: Partial<Record<BackupSettingKey, unknown>>;
  /** Allowlisted keys whose value failed validation. */
  skipped: SettingsSkip[];
  /** Keys present in the file that this version of Clipio does not back up. */
  ignored: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

function isOptionalString(value: unknown, max: number): boolean {
  return value === null || isString(value, max);
}

function isIsoTimestamp(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isOptionalIsoTimestamp(value: unknown): boolean {
  return value === null || isIsoTimestamp(value);
}

function isOneOf(value: unknown, options: readonly string[]): value is string {
  return typeof value === "string" && options.includes(value);
}

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function isStringArray(
  value: unknown,
  maxItems: number,
  maxLength: number
): boolean {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => isString(item, maxLength))
  );
}

/** Accept both the current object shape and the pre-three-mode legacy string. */
function isLegacyTheme(value: unknown): boolean {
  return value === null || isOneOf(value, ["light", "dark", "system"]);
}

function isOnboardingProgress(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const status = value["status"];
  if (
    status === "not_started" ||
    status === "completed" ||
    status === "skipped"
  ) {
    return true;
  }
  return (
    status === "in_progress" &&
    (value["surface"] === "popup" || value["surface"] === "options") &&
    typeof value["step"] === "number" &&
    Number.isInteger(value["step"]) &&
    value["step"] >= 0
  );
}

function isLatestVersion(value: unknown): boolean {
  if (value === null) return true;
  if (!isPlainObject(value)) return false;
  return (
    isString(value["version"], 64) &&
    isString(value["htmlUrl"], 2048) &&
    isIsoTimestamp(value["publishedAt"])
  );
}

type Validator = (value: unknown) => boolean;

const VALIDATORS: Record<BackupSettingKey, Validator> = {
  storageMode: (value) => isOneOf(value, ["sync", "local"]),
  storageModeReason: (value) => isOneOf(value, ["quota", "manual"]),
  syncDataLost: isBoolean,
  confettiEnabled: isBoolean,
  themeMode: (value) => isOneOf(value, ["light", "dark", "system"]),
  theme: isLegacyTheme,
  uiFont: isUiFont,
  sidebarWidth: (value) =>
    isIntegerInRange(value, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH),
  sidebarOpen: isBoolean,
  lastViewedSnippetId: (value) => isOptionalString(value, 200),
  contextMenuDraft: (value) => isOptionalString(value, 32_000),
  blockedSites: (value) => isStringArray(value, 500, 253),
  typingTimeout: (value) => isIntegerInRange(value, 50, 2000),
  debugMode: isBoolean,
  latestVersion: isLatestVersion,
  latestVersionCheckedAt: isOptionalIsoTimestamp,
  dismissedUpdateVersion: (value) => isString(value, 64),
  guidedOnboarding: isOnboardingProgress,
  activationDismissed: isBoolean,
  extensionInstalledAt: isOptionalIsoTimestamp,
  reviewPromptState: (value) =>
    isOneOf(value, ["pending", "shown", "dismissed", "rated"]),
  reviewPromptSnoozedUntil: isOptionalIsoTimestamp,
  snippetPreviewEnabled: isBoolean,
  // An empty prefix is a valid configuration: the content script reads it as
  // "always show the preview". Do not reject it just because a create-form draft
  // needs a non-empty prefix to prefill.
  snippetPreviewPrefix: (value) => isString(value, 8),
  snippetPreviewShortcut: (value) => isString(value, 64),
};

export function isBackupSettingKey(key: string): key is BackupSettingKey {
  return BACKUP_SETTING_KEY_SET.has(key);
}

/** Validate one allowlisted setting. Used on restore as well as on preview. */
export function isValidBackupSetting(
  key: BackupSettingKey,
  value: unknown
): boolean {
  return VALIDATORS[key](value);
}

/**
 * Split a backup's `settings` section into values to write, values to skip,
 * and keys this version does not recognise.
 *
 * An invalid value is reported rather than rejected wholesale: AGENTS.md's
 * "per-key non-fatal" decision exists so one hand-edited key cannot cost the
 * user the other 24 settings in their backup.
 */
export function selectBackupSettings(raw: unknown): SettingsSelection {
  if (!isPlainObject(raw)) {
    return {
      values: {},
      skipped: [{ key: "settings", reason: "invalid-section" }],
      ignored: [],
    };
  }

  const values: Partial<Record<BackupSettingKey, unknown>> = {};
  const skipped: SettingsSkip[] = [];
  const ignored: string[] = [];

  for (const key of Object.keys(raw)) {
    if (!isBackupSettingKey(key)) {
      ignored.push(key);
      continue;
    }
    const value = raw[key];
    if (!isValidBackupSetting(key, value)) {
      skipped.push({ key, reason: "invalid-value" });
      continue;
    }
    values[key] = value;
  }

  return { values, skipped, ignored };
}
