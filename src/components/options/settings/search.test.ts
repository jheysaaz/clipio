/**
 * The wiring in search.ts has one path the real registry cannot reach: a
 * ranked result that resolves to no registered setting. This module drops it.
 * Stubbing the index here makes that path reachable and proves the cache is
 * really consulted rather than rebuilt on every keystroke.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const known = { id: "known", titleKey: "options.setting.theme.title" };
  const gone = { id: "gone", titleKey: "options.setting.theme.title" };
  return {
    known,
    gone,
    buildSettingIndex: vi.fn(() => []),
    searchSettingIndex: vi.fn(() => [
      { entry: known, hits: [{ start: 0, end: 1 }] },
      { entry: gone, hits: [] },
    ]),
    getSetting: vi.fn((id: string) => (id === "known" ? known : undefined)),
  };
});

vi.mock("@/lib/setting-index", () => ({
  buildSettingIndex: mocks.buildSettingIndex,
  searchSettingIndex: mocks.searchSettingIndex,
}));
vi.mock("./registry", () => ({
  SECTIONS: [{ id: "library", labelKey: "options.nav.library" }],
  SETTINGS: [mocks.known, mocks.gone],
  getSetting: mocks.getSetting,
}));

import {
  _resetSearchIndexCache,
  searchRegistry,
  searchRegistryEntries,
} from "./search";

beforeEach(() => {
  mocks.buildSettingIndex.mockClear();
  mocks.searchSettingIndex.mockClear();
  mocks.getSetting.mockClear();
  _resetSearchIndexCache();
});

describe("search wiring", () => {
  it("builds one index and reuses it across queries", () => {
    searchRegistry("theme");
    searchRegistry("font");

    expect(mocks.buildSettingIndex).toHaveBeenCalledTimes(1);
    expect(mocks.searchSettingIndex).toHaveBeenCalledTimes(2);
  });

  it("rebuilds the index only after the cache is reset", () => {
    searchRegistry("theme");
    _resetSearchIndexCache();
    searchRegistry("theme");

    expect(mocks.buildSettingIndex).toHaveBeenCalledTimes(2);
  });

  it("resolves ranked results and drops one that no longer exists", () => {
    const results = searchRegistryEntries("theme");

    expect(results).toEqual([
      { entry: mocks.known, titleHits: [{ start: 0, end: 1 }] },
    ]);
    expect(mocks.getSetting).toHaveBeenCalledWith("gone");
  });
});
