/**
 * Tests for src/utils/usageTracking.ts
 * spec: specs/usage-tracking.spec.md
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getUsageCounts,
  getSnippetUsageCount,
  incrementSnippetUsage,
  resetSnippetUsage,
  clearAllUsageCounts,
} from "./usageTracking";

// ---------------------------------------------------------------------------
// Mock the storage item and sentry
// ---------------------------------------------------------------------------

const { mockUsageCounts } = vi.hoisted(() => ({
  mockUsageCounts: {
    getValue: vi.fn(),
    setValue: vi.fn(),
    removeValue: vi.fn(),
    watch: vi.fn(),
  },
}));

vi.mock("~/storage/items", () => ({
  usageCountsItem: mockUsageCounts,
}));

vi.mock("~/lib/sentry", () => ({
  captureError: vi.fn(),
  captureMessage: vi.fn(),
  initSentry: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getUsageCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // spec: MUST return the full usage count map
  it("returns the usage count map from storage", async () => {
    mockUsageCounts.getValue.mockResolvedValue({ "snip-1": 3, "snip-2": 7 });
    const result = await getUsageCounts();
    expect(result).toEqual({ "snip-1": 3, "snip-2": 7 });
  });

  // spec: MUST return {} when storage is empty
  it("returns empty object when no usage data", async () => {
    mockUsageCounts.getValue.mockResolvedValue({});
    const result = await getUsageCounts();
    expect(result).toEqual({});
  });

  // spec: MUST return {} when reading from storage throws (graceful degradation)
  it("returns {} when storage throws", async () => {
    mockUsageCounts.getValue.mockRejectedValue(new Error("Storage error"));
    const result = await getUsageCounts();
    expect(result).toEqual({});
  });
});

describe("getSnippetUsageCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // spec: MUST return the count for the given snippetId
  it("returns the count for a specific snippet", async () => {
    mockUsageCounts.getValue.mockResolvedValue({ "snip-1": 5 });
    const result = await getSnippetUsageCount("snip-1");
    expect(result).toBe(5);
  });

  // spec: MUST return 0 when snippet has no recorded usage
  it("returns 0 when snippet has no usage", async () => {
    mockUsageCounts.getValue.mockResolvedValue({});
    const result = await getSnippetUsageCount("unknown-id");
    expect(result).toBe(0);
  });

  // spec: MUST return 0 when storage is unavailable
  it("returns 0 when storage throws", async () => {
    mockUsageCounts.getValue.mockRejectedValue(new Error("Error"));
    const result = await getSnippetUsageCount("snip-1");
    expect(result).toBe(0);
  });
});

describe("incrementSnippetUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // spec: MUST increment the count by 1
  it("increments existing count by 1", async () => {
    mockUsageCounts.getValue.mockResolvedValue({ "snip-1": 4 });
    mockUsageCounts.setValue.mockResolvedValue(undefined);
    const result = await incrementSnippetUsage("snip-1");
    expect(result).toBe(5);
    expect(mockUsageCounts.setValue).toHaveBeenCalledWith({ "snip-1": 5 });
  });

  // spec: MUST start from 0 if not present
  it("starts from 0 for new snippet (returns 1)", async () => {
    mockUsageCounts.getValue.mockResolvedValue({});
    mockUsageCounts.setValue.mockResolvedValue(undefined);
    const result = await incrementSnippetUsage("new-snip");
    expect(result).toBe(1);
  });

  // spec: MUST persist the updated counts
  it("persists updated counts to storage", async () => {
    mockUsageCounts.getValue.mockResolvedValue({ "snip-1": 2 });
    mockUsageCounts.setValue.mockResolvedValue(undefined);
    await incrementSnippetUsage("snip-1");
    expect(mockUsageCounts.setValue).toHaveBeenCalledWith({ "snip-1": 3 });
  });

  // spec: MUST return 0 and log on error (graceful degradation)
  it("returns 0 when both getValue and setValue throw", async () => {
    mockUsageCounts.getValue.mockRejectedValue(new Error("Error"));
    mockUsageCounts.setValue.mockRejectedValue(new Error("Write error"));
    const result = await incrementSnippetUsage("snip-1");
    expect(result).toBe(0);
  });

  // When getValue throws but setValue succeeds, getUsageCounts swallows the
  // error and returns {}. incrementSnippetUsage then starts from 0 and returns 1.
  it("returns 1 when getValue throws but setValue succeeds (starts from 0)", async () => {
    mockUsageCounts.getValue.mockRejectedValue(new Error("Error"));
    mockUsageCounts.setValue.mockResolvedValue(undefined);
    const result = await incrementSnippetUsage("snip-1");
    expect(result).toBe(1);
  });

  // spec: does not affect other snippets
  it("only increments the specified snippet", async () => {
    mockUsageCounts.getValue.mockResolvedValue({ "snip-1": 1, "snip-2": 5 });
    mockUsageCounts.setValue.mockResolvedValue(undefined);
    await incrementSnippetUsage("snip-1");
    const saved = mockUsageCounts.setValue.mock.calls[0][0] as Record<
      string,
      number
    >;
    expect(saved["snip-2"]).toBe(5);
  });
});

describe("resetSnippetUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // spec: MUST delete the entry for snippetId
  it("removes the usage entry for the given snippet", async () => {
    mockUsageCounts.getValue.mockResolvedValue({ "snip-1": 3, "snip-2": 7 });
    mockUsageCounts.setValue.mockResolvedValue(undefined);
    await resetSnippetUsage("snip-1");
    const saved = mockUsageCounts.setValue.mock.calls[0][0] as Record<
      string,
      number
    >;
    expect(saved["snip-1"]).toBeUndefined();
    expect(saved["snip-2"]).toBe(7);
  });

  // spec: MUST handle snippetId not in map (no-op, no error)
  it("is a no-op when snippetId is not in the map", async () => {
    mockUsageCounts.getValue.mockResolvedValue({});
    mockUsageCounts.setValue.mockResolvedValue(undefined);
    await expect(resetSnippetUsage("nonexistent")).resolves.not.toThrow();
  });

  // spec: MUST log errors silently
  it("does not throw when storage throws", async () => {
    mockUsageCounts.getValue.mockRejectedValue(new Error("Error"));
    await expect(resetSnippetUsage("snip-1")).resolves.not.toThrow();
  });
});

describe("clearAllUsageCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // spec: MUST call usageCountsItem.removeValue
  it("calls removeValue on the usage counts item", async () => {
    mockUsageCounts.removeValue.mockResolvedValue(undefined);
    await clearAllUsageCounts();
    expect(mockUsageCounts.removeValue).toHaveBeenCalled();
  });

  // spec: MUST log errors silently
  it("does not throw when storage throws", async () => {
    mockUsageCounts.removeValue.mockRejectedValue(new Error("Error"));
    await expect(clearAllUsageCounts()).resolves.not.toThrow();
  });
});
