/**
 * Tests for src/lib/snippetUtils.ts
 */

import { describe, it, expect } from "vitest";
import { selectNewest, detectShortcutConflict } from "./snippetUtils";
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

// ---------------------------------------------------------------------------
// detectShortcutConflict
// ---------------------------------------------------------------------------

describe("detectShortcutConflict", () => {
  const snippetA = makeSnippet({
    id: "a",
    shortcut: "/comp",
    label: "Company",
  });
  const snippetB = makeSnippet({
    id: "b",
    shortcut: "/compatible",
    label: "Compatible",
  });
  const snippetC = makeSnippet({
    id: "c",
    shortcut: "/sig",
    label: "Signature",
  });

  // ── null / no-conflict cases ───────────────────────────────────────────

  it("returns null for an empty candidate", () => {
    expect(detectShortcutConflict("", [snippetA])).toBeNull();
  });

  it("returns null for an empty snippets list", () => {
    expect(detectShortcutConflict("/comp", [])).toBeNull();
  });

  it("returns null when no shortcut conflicts", () => {
    expect(detectShortcutConflict("/email", [snippetA, snippetC])).toBeNull();
  });

  // ── exact conflicts ────────────────────────────────────────────────────

  it("detects an exact duplicate shortcut", () => {
    const result = detectShortcutConflict("/comp", [snippetA]);
    expect(result).toEqual({ type: "exact", conflictingSnippet: snippetA });
  });

  it("exact match takes priority over prefix match", () => {
    // snippetA is "/comp" (exact), snippetB is "/compatible" (prefix)
    // snippetA comes first in the array — exact match returned
    const result = detectShortcutConflict("/comp", [snippetA, snippetB]);
    expect(result?.type).toBe("exact");
    expect(result?.conflictingSnippet.id).toBe("a");
  });

  // ── prefix conflicts ──────────────────────────────────────────────────

  it("detects when candidate is a prefix of an existing shortcut", () => {
    // "/comp" is a prefix of "/compatible"
    const result = detectShortcutConflict("/comp", [snippetB]);
    expect(result).toEqual({ type: "prefix", conflictingSnippet: snippetB });
  });

  it("detects when existing shortcut is a prefix of candidate", () => {
    // "/comp" (existing) is a prefix of "/compatible" (candidate)
    const result = detectShortcutConflict("/compatible", [snippetA]);
    expect(result).toEqual({ type: "prefix", conflictingSnippet: snippetA });
  });

  it("does not flag unrelated shortcuts sharing a common prefix letter", () => {
    // "/s" vs "/sig" would conflict, but "/sig" vs "/sum" should not
    const snippetSum = makeSnippet({ id: "sum", shortcut: "/sum" });
    expect(detectShortcutConflict("/sig", [snippetSum])).toBeNull();
  });

  // ── excludeId ──────────────────────────────────────────────────────────

  it("skips the snippet matching excludeId", () => {
    // Without excludeId, "/comp" conflicts with snippetA
    expect(detectShortcutConflict("/comp", [snippetA])).not.toBeNull();
    // With excludeId = "a", snippetA is skipped → no conflict
    expect(detectShortcutConflict("/comp", [snippetA], "a")).toBeNull();
  });

  it("skips excluded snippet but still finds conflicts with others", () => {
    // Exclude snippetA ("a"), but snippetB "/compatible" still prefix-conflicts with "/comp"
    const result = detectShortcutConflict("/comp", [snippetA, snippetB], "a");
    expect(result).toEqual({ type: "prefix", conflictingSnippet: snippetB });
  });

  // ── first conflict wins ────────────────────────────────────────────────

  it("returns the first conflict found in iteration order", () => {
    const s1 = makeSnippet({ id: "s1", shortcut: "/ab" });
    const s2 = makeSnippet({ id: "s2", shortcut: "/abc" });
    // "/abc" candidate: s1 "/ab" is a prefix (conflict), s2 "/abc" is exact
    // s1 comes first → prefix conflict returned
    const result = detectShortcutConflict("/abc", [s1, s2]);
    expect(result?.type).toBe("prefix");
    expect(result?.conflictingSnippet.id).toBe("s1");
  });

  // ── edge cases ─────────────────────────────────────────────────────────

  it("treats single-character shortcuts correctly", () => {
    const slash = makeSnippet({ id: "slash", shortcut: "/" });
    // Any shortcut starting with "/" conflicts with a bare "/" shortcut
    expect(detectShortcutConflict("/anything", [slash])?.type).toBe("prefix");
    // And vice versa
    expect(detectShortcutConflict("/", [snippetA])?.type).toBe("prefix");
  });

  it("is case-sensitive", () => {
    const upper = makeSnippet({ id: "up", shortcut: "/Comp" });
    // "/comp" is not the same as "/Comp"
    expect(detectShortcutConflict("/comp", [upper])).toBeNull();
  });
});
