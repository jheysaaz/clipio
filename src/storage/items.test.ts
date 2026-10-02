/**
 * The storage item registry.
 * spec: specs/test-infrastructure.spec.md
 *
 * `items.ts` is the single source of truth for every storage **key** and every
 * **default value** the extension has, and it is mocked or stubbed out by
 * essentially every test that touches it. So the suite is structurally incapable
 * of noticing a bug in it.
 *
 * That matters more than it looks. A key typo silently orphans a user's saved
 * setting — `local:themeMode` → `local:themeMod` loses their theme with no error
 * anywhere. A changed default can flip behaviour for every fresh install at once
 * (`storageModeItem` defaulting to `"local"` would make sync look broken
 * everywhere). Two items sharing a key would make one of them silently dead.
 *
 * None of those are style concerns, and all of them are invisible until these
 * tests exist.
 *
 * `.key` is not exposed on a WXT storage item, so keys are asserted by recording
 * what `defineItem` was called with. The mock is defined locally rather than
 * inherited from `tests/setup.ts` so the test does not depend on that global
 * mock's internals, and so recording is guaranteed rather than incidental.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

/** Every `defineItem(key, options)` call, in the order items.ts makes them. */
const recorded = vi.hoisted(() => ({
  calls: [] as Array<{ key: string; defaultValue: unknown }>,
}));

vi.mock("wxt/utils/storage", () => ({
  storage: {
    defineItem: vi.fn(
      <T>(key: string, options?: { defaultValue?: T }): unknown => {
        const defaultValue = options?.defaultValue as T;
        recorded.calls.push({ key, defaultValue });
        let value = defaultValue;
        return {
          getValue: async (): Promise<T> => value,
          setValue: async (next: T): Promise<void> => {
            value = next;
          },
          removeValue: async (): Promise<void> => {
            value = defaultValue;
          },
          watch: () => () => {},
        };
      }
    ),
  },
}));

import * as items from "./items";

/**
 * The expected contract: key -> default value.
 *
 * Written out in full rather than derived from the module, because a test that
 * reads its expectations out of the code under test asserts only that the code
 * equals itself.
 */
const EXPECTED: Record<string, unknown> = {
  "local:snippets": [],
  "local:cachedSnippets": [],
  "local:storageMode": "sync",
  "local:storageModeReason": "quota",
  "local:syncDataLost": false,
  "local:confettiEnabled": true,
  "local:themeMode": "system",
  "local:theme": null,
  "local:uiFont": "inter",
  "local:snippetUsageCount": {},
  "local:contextMenuDraft": null,
  "local:giphyApiKey": "",
  "local:blockedSites": [],
  "local:typingTimeout": 300,
  "local:debugMode": false,
  "local:debugLog": [],
  "local:latestVersion": null,
  "local:latestVersionCheckedAt": null,
  "local:dismissedUpdateVersion": "",
  "local:onboardingCompleted": false,
  "local:extensionInstalledAt": null,
  "local:totalSnippetInsertions": 0,
  "local:reviewPromptState": "pending",
  "local:reviewPromptSnoozedUntil": null,
  "local:lastSentryErrorAt": null,
  "local:snippetPreviewEnabled": true,
  "local:snippetPreviewPrefix": "/",
  "local:snippetPreviewShortcut": "Ctrl+Shift+Space",
};

describe("storage items — keys", () => {
  it("registers every key the extension relies on", () => {
    // Each expected key must have been handed to defineItem verbatim. A renamed
    // key fails here, which is the point: a rename is silent data loss.
    const actualKeys = recorded.calls.map((c) => c.key);
    for (const key of Object.keys(EXPECTED)) {
      expect(actualKeys, `missing key ${key}`).toContain(key);
    }
  });

  it("registers no key that is not in the contract", () => {
    // Catches a newly added item whose key was never recorded here, which would
    // otherwise sail through unnoticed.
    const unexpected = recorded.calls
      .map((c) => c.key)
      .filter((k) => !(k in EXPECTED));
    expect(unexpected).toEqual([]);
  });

  it("registers one item per exported storage item", () => {
    const exported = Object.keys(items).filter((k) => k.endsWith("Item"));
    expect(recorded.calls).toHaveLength(exported.length);
    expect(exported.length).toBe(Object.keys(EXPECTED).length);
  });

  it("has no two items sharing a key", () => {
    // A duplicate would make one item silently shadow the other, and the loser
    // would keep returning its own default forever.
    const keys = recorded.calls.map((c) => c.key);
    const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(duplicates).toEqual([]);
  });

  it("keeps the snippet store and the content-script cache on separate keys", () => {
    // These two deliberately hold the same type. If they shared a key, the cache
    // would BE the store, and the whole projection the content script reads
    // would collapse. Named explicitly so the distinction is not lost.
    const keys = recorded.calls.map((c) => c.key);
    expect(keys).toContain("local:snippets");
    expect(keys).toContain("local:cachedSnippets");
  });

  it("gives every key an explicit area prefix", () => {
    // An unprefixed key would be ambiguous about which storage area it lands in.
    const unprefixed = recorded.calls
      .map((c) => c.key)
      .filter((k) => !/^(local|sync|session|managed):/.test(k));
    expect(unprefixed).toEqual([]);
  });
});

describe("storage items — default values", () => {
  it("uses the documented default for every key", () => {
    for (const [key, expected] of Object.entries(EXPECTED)) {
      const call = recorded.calls.find((c) => c.key === key);
      expect(call, `no defineItem call for ${key}`).toBeDefined();
      expect(call!.defaultValue, `wrong default for ${key}`).toEqual(expected);
    }
  });

  it("defaults the storage mode to sync, not local", () => {
    // Load-bearing: "local" would make a fresh install appear to have sync
    // broken, for every user at once, with nothing in their own data to explain
    // it. Called out separately so a "simplify the default" change fails loudly.
    const mode = (
      items as unknown as Record<string, { getValue(): Promise<string> }>
    ).storageModeItem!;
    return expect(mode.getValue()).resolves.toBe("sync");
  });

  it("defaults the preview to enabled, and its trigger to a slash", () => {
    const preview = items as unknown as Record<
      string,
      { getValue(): Promise<unknown> }
    >;
    return Promise.all([
      expect(preview.snippetPreviewEnabledItem!.getValue()).resolves.toBe(true),
      expect(preview.snippetPreviewPrefixItem!.getValue()).resolves.toBe("/"),
    ]);
  });

  it("defaults the typing timeout to 300ms", () => {
    const timeout = (
      items as unknown as Record<string, { getValue(): Promise<number> }>
    ).typingTimeoutItem!;
    return expect(timeout.getValue()).resolves.toBe(300);
  });

  it("starts every collection empty rather than undefined", async () => {
    // An undefined default would make `items.blockedSites.map(...)` throw on a
    // fresh profile — a crash on first run, in the user's most-used feature.
    const expected: Record<string, unknown> = {
      localSnippetsItem: [],
      cachedSnippetsItem: [],
      usageCountsItem: {},
      blockedSitesItem: [],
      debugLogItem: [],
    };
    for (const [name, want] of Object.entries(expected)) {
      const value = await (
        items as unknown as Record<string, { getValue(): Promise<unknown> }>
      )[name]!.getValue();
      expect(value, `${name} default`).toEqual(want);
    }
  });
});
