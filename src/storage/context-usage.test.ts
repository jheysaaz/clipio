import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureError } from "@/lib/sentry";
import { resetBrowserMocks } from "../../tests/mocks/browser";
import { getContextUsage, recordContextUse } from "./context-usage";
import { snippetContextUsageItem } from "./items";

const STORAGE_KEY = "snippetContextUsage";

describe("context usage storage", () => {
  beforeEach(() => {
    resetBrowserMocks();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts empty and reads local data through the typed item", async () => {
    expect(await getContextUsage()).toEqual({});

    await browser.storage.local.set({
      [STORAGE_KEY]: {
        s1: { lastUsedAt: 5, uses: 1, sites: [] },
      },
    });

    expect(await getContextUsage()).toEqual({
      s1: { lastUsedAt: 5, uses: 1, sites: [] },
    });
  });

  it("repairs corrupt stored data on read", async () => {
    await browser.storage.local.set({
      [STORAGE_KEY]: {
        s1: {
          lastUsedAt: "yesterday",
          uses: 2,
          sites: [
            { hostname: "https://evil.example/path", lastUsedAt: 1, uses: 1 },
          ],
        },
        s2: "not an entry",
      },
    });

    expect(await getContextUsage()).toEqual({
      s1: {
        lastUsedAt: 0,
        uses: 2,
        sites: [{ hostname: "evil.example", lastUsedAt: 1, uses: 1 }],
      },
    });
  });

  it("persists only a bare hostname, never a URL, path, query or fragment", async () => {
    await recordContextUse("s1", "https://Example.com/owner/repo?tab=1#readme");

    const stored = await browser.storage.local.get(STORAGE_KEY);
    expect(stored[STORAGE_KEY]).toEqual({
      s1: {
        lastUsedAt: expect.any(Number),
        uses: 1,
        sites: [
          { hostname: "example.com", lastUsedAt: expect.any(Number), uses: 1 },
        ],
      },
    });
    const serialised = JSON.stringify(stored);
    expect(serialised).not.toContain("/owner/repo");
    expect(serialised).not.toContain("tab=1");
    expect(serialised).not.toContain("readme");
  });

  it("increments an existing site instead of adding another hostname entry", async () => {
    await recordContextUse("s1", "example.com");
    await recordContextUse("s1", "example.com");

    const usage = await getContextUsage();
    expect(usage.s1?.uses).toBe(2);
    expect(usage.s1?.sites).toEqual([
      {
        hostname: "example.com",
        lastUsedAt: expect.any(Number),
        uses: 2,
      },
    ]);
  });

  it("does not write at all for an unusable hostname", async () => {
    const setValue = vi.spyOn(snippetContextUsageItem, "setValue");

    await recordContextUse("s1", "not a hostname");

    expect(setValue).not.toHaveBeenCalled();
    expect(await getContextUsage()).toEqual({});
  });

  it("degrades to an empty map when the read fails, without recording a hostname", async () => {
    vi.spyOn(snippetContextUsageItem, "getValue").mockRejectedValueOnce(
      new Error("read failed")
    );

    expect(await getContextUsage()).toEqual({});

    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      action: "getContextUsage",
    });
    const extras = vi.mocked(captureError).mock.calls[0]?.[1];
    expect(JSON.stringify(extras)).not.toContain("hostname");
    expect(JSON.stringify(extras)).not.toContain("example.com");
  });

  it("swallows a write failure without recording a hostname", async () => {
    vi.spyOn(snippetContextUsageItem, "setValue").mockRejectedValueOnce(
      new Error("write failed")
    );

    await expect(
      recordContextUse("s1", "example.com")
    ).resolves.toBeUndefined();

    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      action: "recordContextUse",
    });
    const extras = vi.mocked(captureError).mock.calls[0]?.[1];
    expect(JSON.stringify(extras)).not.toContain("hostname");
    expect(JSON.stringify(extras)).not.toContain("example.com");
  });
});
