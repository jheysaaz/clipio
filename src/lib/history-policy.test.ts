import { describe, it, expect } from "vitest";
import type { Snippet } from "@/types";
import {
  HISTORY_LIMITS,
  applyHistoryCaps,
  historyBytes,
  shouldCoalesce,
  trimGlobal,
  trimPerSnippet,
  withBytes,
  type HistoryEntry,
} from "./history-policy";

function snippet(id: string, rev: number, label = "S"): Snippet {
  return {
    id,
    label,
    content: "body",
    shortcut: `/${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    rev,
  };
}

function entry(
  id: string,
  snippetId: string,
  time: string,
  overrides: Partial<HistoryEntry> = {}
): HistoryEntry {
  return withBytes({
    id,
    snippetId,
    rev: 1,
    reason: "edit",
    snapshot: snippet(snippetId, 1),
    createdAt: time,
    ...overrides,
  });
}

describe("historyBytes", () => {
  it("estimates a positive size", () => {
    expect(
      historyBytes({
        id: "h1",
        snippetId: "s1",
        rev: 1,
        reason: "edit",
        snapshot: snippet("s1", 1),
        createdAt: "2026-01-01T00:00:00.000Z",
      })
    ).toBeGreaterThan(0);
  });
});

describe("shouldCoalesce", () => {
  it("coalesces another edit in the same thirty-second burst", () => {
    const existing = [entry("h1", "s1", "2026-01-01T00:00:00.000Z")];
    expect(
      shouldCoalesce(existing, {
        snippetId: "s1",
        reason: "edit",
        createdAt: "2026-01-01T00:00:10.000Z",
      })
    ).toBe(true);
  });

  it("does not coalesce a different reason", () => {
    const existing = [entry("h1", "s1", "2026-01-01T00:00:00.000Z")];
    expect(
      shouldCoalesce(existing, {
        snippetId: "s1",
        reason: "restore",
        createdAt: "2026-01-01T00:00:10.000Z",
      })
    ).toBe(false);
  });

  it("does not coalesce after the window or for another snippet", () => {
    const existing = [entry("h1", "s1", "2026-01-01T00:00:00.000Z")];
    expect(
      shouldCoalesce(existing, {
        snippetId: "s1",
        reason: "edit",
        createdAt: "2026-01-01T00:01:00.000Z",
      })
    ).toBe(false);
    expect(
      shouldCoalesce(existing, {
        snippetId: "other",
        reason: "edit",
        createdAt: "2026-01-01T00:00:10.000Z",
      })
    ).toBe(false);
  });
});

describe("trimPerSnippet", () => {
  it("keeps the newest twenty snapshots for each snippet", () => {
    const entries = Array.from({ length: 25 }, (_, i) =>
      entry(
        `h${i}`,
        "s1",
        `2026-01-01T00:${String(i).padStart(2, "0")}:00.000Z`
      )
    );
    const kept = trimPerSnippet(entries);
    expect(kept).toHaveLength(HISTORY_LIMITS.perSnippet);
    expect(kept.map((e) => e.id)).toContain("h24");
    expect(kept.map((e) => e.id)).not.toContain("h0");
  });

  it("keeps every snapshot when a snippet is under the cap", () => {
    const entries = [entry("h1", "s1", "2026-01-01T00:00:00.000Z")];
    expect(trimPerSnippet(entries)).toEqual(entries);
  });
});

describe("trimGlobal", () => {
  it("removes the oldest snapshots first", () => {
    const entries = [
      entry("old", "s1", "2026-01-01T00:00:00.000Z"),
      entry("new", "s1", "2026-01-02T00:00:00.000Z"),
    ];
    const result = trimGlobal(entries, {
      ...HISTORY_LIMITS,
      globalVersions: 1,
    });
    expect(result.kept.map((e) => e.id)).toEqual(["new"]);
    expect(result.removedIds).toEqual(["old"]);
  });

  it("never removes the newest snapshot of a snippet", () => {
    const entries = [
      entry("s1-new", "s1", "2026-01-02T00:00:00.000Z"),
      entry("s2-new", "s2", "2026-01-02T00:00:00.000Z"),
    ];
    const result = trimGlobal(entries, {
      ...HISTORY_LIMITS,
      globalVersions: 1,
    });
    expect(result.kept.map((e) => e.id).sort()).toEqual(["s1-new", "s2-new"]);
    expect(result.removedIds).toEqual([]);
  });

  it("enforces the byte cap as well as the version cap", () => {
    const big = snippet("s1", 1, "x".repeat(1000));
    const entries = [
      entry("older", "s1", "2025-12-31T00:00:00.000Z"),
      withBytes({
        id: "big",
        snippetId: "s1",
        rev: 1,
        reason: "edit",
        snapshot: big,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      entry("small", "s2", "2026-01-02T00:00:00.000Z"),
    ];
    const result = trimGlobal(entries, {
      ...HISTORY_LIMITS,
      globalBytes: 100,
    });
    expect(result.removedIds).toContain("older");
  });

  it("keeps everything when both caps allow it", () => {
    const entries = [entry("h1", "s1", "2026-01-01T00:00:00.000Z")];
    expect(trimGlobal(entries).removedIds).toEqual([]);
  });
});

describe("applyHistoryCaps", () => {
  it("reports removals from both the per-snippet and global caps", () => {
    const entries = Array.from({ length: 22 }, (_, i) =>
      entry(
        `h${i}`,
        "s1",
        `2026-01-01T00:${String(i).padStart(2, "0")}:00.000Z`
      )
    );
    entries.push(entry("other", "s2", "2026-01-02T00:00:00.000Z"));
    const result = applyHistoryCaps(entries, {
      ...HISTORY_LIMITS,
      globalVersions: 5,
    });
    expect(result.kept).toHaveLength(5);
    expect(result.removedIds.length).toBe(18);
  });
});
