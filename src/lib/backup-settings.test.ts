/**
 * Tests for the backup settings allowlist.
 *
 * The important assertions are the negative ones: a secret, a log, and any
 * newly added storage key must not enter a backup just because it happens to
 * be present in storage.local.
 */

import { describe, expect, it } from "vitest";

import {
  BACKUP_EXCLUDED_KEYS,
  BACKUP_SETTING_KEYS,
  isBackupSettingKey,
  isValidBackupSetting,
  selectBackupSettings,
} from "./backup-settings";

describe("BACKUP_SETTING_KEYS", () => {
  it("uses raw storage.local keys, not WXT's local: prefix", () => {
    expect(BACKUP_SETTING_KEYS).toContain("themeMode");
    expect(BACKUP_SETTING_KEYS).not.toContain("local:themeMode");
  });

  it("includes the persisted state the product chose to keep", () => {
    for (const key of [
      "storageMode",
      "storageModeReason",
      "blockedSites",
      "guidedOnboarding",
      "activationDismissed",
      "reviewPromptState",
      "snippetPreviewPrefix",
    ]) {
      expect(BACKUP_SETTING_KEYS, `missing ${key}`).toContain(key);
    }
  });

  it("excludes secrets, logs, and local analytics with a written reason", () => {
    const excluded = new Map(
      BACKUP_EXCLUDED_KEYS.map(({ key, reason }) => [key, reason])
    );
    expect(excluded.get("giphyApiKey")).toBe("secret");
    expect(excluded.get("debugLog")).toBe("logs");
    expect(excluded.get("snippetContextUsage")).toBe("local-context");
    expect(excluded.get("totalSnippetInsertions")).toBe("local-analytics");
    for (const { key } of BACKUP_EXCLUDED_KEYS) {
      expect(isBackupSettingKey(key)).toBe(false);
    }
  });
});

describe("isValidBackupSetting", () => {
  it("accepts values in range", () => {
    expect(isValidBackupSetting("themeMode", "dark")).toBe(true);
    expect(isValidBackupSetting("sidebarWidth", 240)).toBe(true);
    expect(isValidBackupSetting("typingTimeout", 50)).toBe(true);
    expect(isValidBackupSetting("blockedSites", ["github.com"])).toBe(true);
    expect(isValidBackupSetting("uiFont", "dyslexic")).toBe(true);
    expect(isValidBackupSetting("debugMode", false)).toBe(true);
    expect(isValidBackupSetting("reviewPromptState", "dismissed")).toBe(true);
    expect(
      isValidBackupSetting("guidedOnboarding", {
        status: "in_progress",
        surface: "options",
        step: 2,
      })
    ).toBe(true);
    expect(
      isValidBackupSetting("latestVersion", {
        version: "1.7.1",
        htmlUrl: "https://example.test/release",
        publishedAt: "2026-01-01T00:00:00Z",
      })
    ).toBe(true);
    expect(isValidBackupSetting("latestVersionCheckedAt", null)).toBe(true);
    // Blank means "always trigger" to the content script, so it is a setting
    // worth backing up even though the create form cannot prefill from it.
    expect(isValidBackupSetting("snippetPreviewPrefix", "")).toBe(true);
  });

  it("rejects invalid values instead of coercing them", () => {
    expect(isValidBackupSetting("themeMode", "neon")).toBe(false);
    expect(isValidBackupSetting("sidebarWidth", 10_000)).toBe(false);
    expect(isValidBackupSetting("sidebarWidth", 240.5)).toBe(false);
    expect(isValidBackupSetting("typingTimeout", 0)).toBe(false);
    expect(isValidBackupSetting("blockedSites", [42])).toBe(false);
    expect(isValidBackupSetting("uiFont", "comic-sans")).toBe(false);
    expect(isValidBackupSetting("snippetPreviewPrefix", "123456789")).toBe(
      false
    );
    expect(isValidBackupSetting("dismissedUpdateVersion", 1)).toBe(false);
    expect(isValidBackupSetting("latestVersionCheckedAt", "yesterday")).toBe(
      false
    );
  });

  it("rejects malformed compound settings", () => {
    expect(isValidBackupSetting("guidedOnboarding", "done")).toBe(false);
    expect(
      isValidBackupSetting("guidedOnboarding", {
        status: "in_progress",
        surface: "popup",
        step: -1,
      })
    ).toBe(false);
    expect(
      isValidBackupSetting("guidedOnboarding", {
        status: "in_progress",
        surface: "background",
        step: 0,
      })
    ).toBe(false);
    expect(
      isValidBackupSetting("latestVersion", {
        version: "1.7.1",
        htmlUrl: "https://example.test",
        publishedAt: "not-a-date",
      })
    ).toBe(false);
    expect(
      isValidBackupSetting("latestVersion", {
        version: "1.7.1",
      })
    ).toBe(false);
  });

  it("accepts the legacy theme key while it is still read on startup", () => {
    expect(isValidBackupSetting("theme", null)).toBe(true);
    expect(isValidBackupSetting("theme", "light")).toBe(true);
    expect(isValidBackupSetting("theme", "auto")).toBe(false);
  });
});

describe("validators", () => {
  it("accepts a valid value for every allowlisted key", () => {
    const values: Record<(typeof BACKUP_SETTING_KEYS)[number], unknown> = {
      storageMode: "sync",
      storageModeReason: "quota",
      syncDataLost: false,
      confettiEnabled: true,
      themeMode: "system",
      theme: "dark",
      uiFont: "inter",
      sidebarWidth: 240,
      sidebarOpen: true,
      lastViewedSnippetId: "snippet-1",
      contextMenuDraft: "a draft",
      blockedSites: ["example.com"],
      typingTimeout: 200,
      debugMode: false,
      latestVersion: {
        version: "1.7.1",
        htmlUrl: "https://example.test/release",
        publishedAt: "2026-01-01T00:00:00Z",
      },
      latestVersionCheckedAt: "2026-01-01T00:00:00Z",
      dismissedUpdateVersion: "1.7.0",
      guidedOnboarding: { status: "completed" },
      activationDismissed: false,
      extensionInstalledAt: "2026-01-01T00:00:00Z",
      reviewPromptState: "pending",
      reviewPromptSnoozedUntil: "2026-01-01T00:00:00Z",
      snippetPreviewEnabled: true,
      snippetPreviewPrefix: "/",
      snippetPreviewShortcut: "Ctrl+Shift+Space",
    };

    for (const key of BACKUP_SETTING_KEYS) {
      expect(isValidBackupSetting(key, values[key]), `invalid ${key}`).toBe(
        true
      );
    }
  });
});

describe("selectBackupSettings", () => {
  it("keeps valid allowlisted values", () => {
    const result = selectBackupSettings({
      themeMode: "dark",
      sidebarOpen: false,
    });

    expect(result.values).toEqual({ themeMode: "dark", sidebarOpen: false });
    expect(result.skipped).toEqual([]);
    expect(result.ignored).toEqual([]);
  });

  it("skips invalid values but keeps the rest", () => {
    const result = selectBackupSettings({
      themeMode: "dark",
      sidebarWidth: -1,
      typingTimeout: 300,
    });

    expect(result.values).toEqual({ themeMode: "dark", typingTimeout: 300 });
    expect(result.skipped).toEqual([
      { key: "sidebarWidth", reason: "invalid-value" },
    ]);
  });

  it("reports secrets and unknown keys as ignored without copying them", () => {
    const result = selectBackupSettings({
      giphyApiKey: "super-secret",
      debugLog: [{ detail: "private" }],
      snippetContextUsage: { abc: { hostnames: ["secret.example"] } },
      futureSetting: true,
    });

    expect(result.values).toEqual({});
    expect(result.ignored).toEqual([
      "giphyApiKey",
      "debugLog",
      "snippetContextUsage",
      "futureSetting",
    ]);
    expect(JSON.stringify(result.values)).not.toContain("super-secret");
  });

  it("reports a non-object settings section instead of silently dropping it", () => {
    expect(selectBackupSettings(null)).toEqual({
      values: {},
      skipped: [{ key: "settings", reason: "invalid-section" }],
      ignored: [],
    });
  });

  it("never lets a prototype key become an own setting", () => {
    const raw = JSON.parse(
      '{"__proto__":{"polluted":true},"themeMode":"dark"}'
    );
    const result = selectBackupSettings(raw);

    expect(result.values).toEqual({ themeMode: "dark" });
    expect(result.ignored).toContain("__proto__");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});
