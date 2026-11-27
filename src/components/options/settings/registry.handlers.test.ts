/**
 * The registry's read/write/reset functions are executable code, not just data.
 *
 * These tests call each entry's handlers against the shared in-memory browser
 * storage, so a renamed key or a handler writing the wrong type fails here
 * rather than in a user's profile after a reload.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ forceSetStorageMode: vi.fn() }));

vi.mock("@/storage", () => ({
  forceSetStorageMode: mocks.forceSetStorageMode,
}));

import {
  getSection,
  getSetting,
  rowsForSection,
  SETTINGS,
  type SectionId,
} from "./registry";
import {
  mockStorageLocal,
  resetBrowserMocks,
} from "../../../../tests/mocks/browser";

/** Entry id → [storage key, value used for both read and write tests]. */
const FIELDS: Record<string, [string, unknown]> = {
  "preview-enabled": ["snippetPreviewEnabled", false],
  "preview-prefix": ["snippetPreviewPrefix", "!"],
  "preview-shortcut": ["snippetPreviewShortcut", "Mod+K"],
  "typing-timeout": ["typingTimeout", 500],
  "blocked-sites": ["blockedSites", ["example.com"]],
  theme: ["themeMode", "dark"],
  "light-code-theme": ["lightCodeTheme", "solarized-light"],
  "dark-code-theme": ["darkCodeTheme", "okaidia"],
  "font-family": ["uiFont", "inter"],
  confetti: ["confettiEnabled", false],
  "local-only-indicator": ["localOnlyIndicatorEnabled", false],
  "storage-mode": ["storageMode", "local"],
  "debug-mode": ["debugMode", true],
  "giphy-key": ["giphyApiKey", "abc123"],
};

/** Entries whose reset handler writes a value back to storage. */
const RESET_VALUES: Record<string, unknown> = {
  "preview-prefix": "/",
  "preview-shortcut": "Mod+Shift+Space",
  "typing-timeout": 300,
  theme: "system",
  "light-code-theme": "github-light",
  "dark-code-theme": "one-dark-pro",
  "font-family": "inter",
  confetti: true,
  "local-only-indicator": true,
  "debug-mode": false,
  "giphy-key": "",
};

async function stored(key: string) {
  return (await mockStorageLocal.get(key))[key];
}

beforeEach(async () => {
  resetBrowserMocks();
  mocks.forceSetStorageMode.mockReset().mockResolvedValue(undefined);
  for (const [key, value] of Object.values(FIELDS)) {
    await mockStorageLocal.set({ [key]: value });
  }
});

afterEach(() => {
  resetBrowserMocks();
  mocks.forceSetStorageMode.mockReset();
});

describe("registry handlers", () => {
  it("reads every setting through its declared storage item", async () => {
    for (const entry of SETTINGS) {
      const field = FIELDS[entry.id];
      expect(field, `${entry.id} has no fixture`).toBeDefined();
      await expect(entry.useValue(), `${entry.id}.useValue`).resolves.toEqual(
        field[1]
      );
    }
  });

  it("writes every setting to the key its fixture names", async () => {
    for (const entry of SETTINGS) {
      const [key, value] = FIELDS[entry.id];
      await entry.setValue(value);
      if (entry.id === "storage-mode") {
        // The storage mode cannot be changed by writing its item alone: the
        // manager has to migrate the snippets between backends.
        expect(mocks.forceSetStorageMode).toHaveBeenCalledWith(value);
      } else {
        expect(await stored(key), `${entry.id}.setValue`).toEqual(value);
      }
    }
    expect(mocks.forceSetStorageMode).toHaveBeenCalledTimes(1);
  });

  it("restores the shipped default for every entry that offers a reset", async () => {
    for (const entry of SETTINGS) {
      if (!entry.reset) continue;
      expect(
        RESET_VALUES[entry.id],
        `${entry.id} has no default fixture`
      ).toBeDefined();
      await entry.reset();
      expect(await stored(FIELDS[entry.id][0]), `${entry.id}.reset`).toEqual(
        RESET_VALUES[entry.id]
      );
    }
  });

  it("does not offer a reset for settings that have no declared default", async () => {
    const withoutReset = SETTINGS.filter((s) => !s.reset).map((s) => s.id);
    expect(withoutReset).toEqual([
      "preview-enabled",
      "blocked-sites",
      "storage-mode",
    ]);
  });

  it("passes an unknown stored font through; the registry declares only the default", async () => {
    await mockStorageLocal.set({ uiFont: "not-a-font" });
    const font = getSetting("font-family");

    // Normalisation belongs to the settings store, not this storage adapter.
    // The registry's contract is the declared default and the offered options.
    await expect(font?.useValue()).resolves.toBe("not-a-font");
    expect(font?.defaultValue).toBe("inter");
    expect(font?.options?.map((option) => option.value)).toEqual([
      "inter",
      "system",
      "dyslexic",
    ]);
  });

  it("excludes panel-owned settings from section rows but still finds them", () => {
    const rows = rowsForSection("blocked-sites");
    expect(rows).toEqual([]);
    expect(getSetting("blocked-sites")?.panelOwned).toBe(true);
    expect(getSection("no-such-section" as SectionId)).toBeUndefined();
  });
});
