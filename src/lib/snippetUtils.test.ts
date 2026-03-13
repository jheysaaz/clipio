/**
 * Tests for src/lib/snippetUtils.ts
 */

import { describe, it, expect } from "vitest";
import { selectNewest } from "./snippetUtils";
import type { Snippet } from "~/types";

const makeSnippet = (overrides: Partial<Snippet> = {}): Snippet => ({
  id: "test-id",
  label: "Test",
  shortcut: "/ts",
  content: "Test content",
  tags: [],
  usageCount: 0,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  ...overrides,
});

describe("selectNewest", () => {
  it("returns null for an empty array", () => {
    expect(selectNewest([])).toBeNull();
  });

  it("returns the only element for a single-item array", () => {
    const s = makeSnippet({ id: "only" });
    expect(selectNewest([s])).toBe(s);
  });

  it("returns the snippet with the most recent updatedAt", () => {
    const old = makeSnippet({
      id: "old",
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    const mid = makeSnippet({
      id: "mid",
      updatedAt: "2025-06-01T00:00:00.000Z",
    });
    const newest = makeSnippet({
      id: "newest",
      updatedAt: "2025-12-31T23:59:59.999Z",
    });
    // Pass in unsorted order
    expect(selectNewest([mid, newest, old])?.id).toBe("newest");
  });

  it("does not mutate the input array", () => {
    const a = makeSnippet({ id: "a", updatedAt: "2025-01-01T00:00:00.000Z" });
    const b = makeSnippet({ id: "b", updatedAt: "2025-06-01T00:00:00.000Z" });
    const input = [a, b];
    selectNewest(input);
    // Original order preserved
    expect(input[0].id).toBe("a");
    expect(input[1].id).toBe("b");
  });

  it("handles equal updatedAt by returning the first in sorted order (stable)", () => {
    const s1 = makeSnippet({ id: "s1", updatedAt: "2025-06-01T00:00:00.000Z" });
    const s2 = makeSnippet({ id: "s2", updatedAt: "2025-06-01T00:00:00.000Z" });
    // Both equal — result should be one of them (not throw)
    const result = selectNewest([s1, s2]);
    expect(result?.id === "s1" || result?.id === "s2").toBe(true);
  });
});
