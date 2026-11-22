import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureError } from "@/lib/sentry";
import { resetBrowserMocks } from "../../tests/mocks/browser";
import { snippetContextUsageItem } from "@/storage/items";
import {
  loadRankingContext,
  rankingContextStore,
  resetRankingContextForTests,
  useRankingContext,
} from "./ranking-context";

const { mockGetCurrentSiteHostname } = vi.hoisted(() => ({
  mockGetCurrentSiteHostname: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock("@/lib/current-site", () => ({
  getCurrentSiteHostname: mockGetCurrentSiteHostname,
}));

describe("ranking context store", () => {
  beforeEach(() => {
    resetBrowserMocks();
    resetRankingContextForTests();
    vi.clearAllMocks();
    mockGetCurrentSiteHostname.mockResolvedValue(null);
  });

  afterEach(() => {
    resetRankingContextForTests();
    vi.restoreAllMocks();
  });

  it("loads local usage data and the bare hostname", async () => {
    await browser.storage.local.set({
      snippetContextUsage: {
        s1: { lastUsedAt: 100, uses: 2, sites: [] },
      },
    });
    mockGetCurrentSiteHostname.mockResolvedValueOnce("example.com");

    await loadRankingContext();

    expect(rankingContextStore.state).toEqual({
      usage: { s1: { lastUsedAt: 100, uses: 2, sites: [] } },
      hostname: "example.com",
      isLoaded: true,
    });
    // The store asks for a hostname, never for a URL it could accidentally keep.
    expect(mockGetCurrentSiteHostname).toHaveBeenCalled();
  });

  it("normalises a persisted usage map on load", async () => {
    await browser.storage.local.set({
      snippetContextUsage: {
        s1: {
          lastUsedAt: "bad",
          uses: 1,
          sites: [
            { hostname: "https://example.com/path", lastUsedAt: 9, uses: 1 },
          ],
        },
      },
    });

    await loadRankingContext();

    expect(rankingContextStore.state.usage.s1?.sites).toEqual([
      { hostname: "example.com", lastUsedAt: 9, uses: 1 },
    ]);
  });

  it("follows usage changes made in another context", async () => {
    await loadRankingContext();

    await snippetContextUsageItem.setValue({
      s1: { lastUsedAt: 42, uses: 1, sites: [] },
    });

    expect(rankingContextStore.state.usage.s1?.lastUsedAt).toBe(42);
  });

  it("marks itself loaded with neutral context when a read fails", async () => {
    mockGetCurrentSiteHostname.mockRejectedValueOnce(new Error("tabs failed"));

    await loadRankingContext();

    expect(rankingContextStore.state).toEqual({
      usage: {},
      hostname: null,
      isLoaded: true,
    });
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      action: "rankingContext.load",
    });
  });

  it("exposes a reactive selector for the popup", () => {
    const { result } = renderHook(() =>
      useRankingContext((state) => state.hostname)
    );
    expect(result.current).toBeNull();

    act(() => {
      rankingContextStore.setState((prev) => ({
        ...prev,
        hostname: "github.com",
      }));
    });

    expect(result.current).toBe("github.com");
  });
});
