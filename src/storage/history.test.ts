import { describe, it, expect } from "vitest";
import type { Snippet } from "@/types";
import type { HistoryEntry } from "@/lib/history-policy";
import {
  getHistory,
  recordHistory,
  restoreVersion,
  type HistoryDeps,
} from "./history";

function snippet(overrides: Partial<Snippet> = {}): Snippet {
  return {
    id: "s1",
    label: "S",
    content: "body",
    shortcut: "/s",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    rev: 3,
    ...overrides,
  };
}

function deps(entries: HistoryEntry[] = [], now = "2026-02-01T00:00:00.000Z") {
  const state = {
    entries: [...entries],
    removed: [] as string[],
    written: [] as HistoryEntry[],
  };
  const d: HistoryDeps = {
    list: async () => state.entries,
    write: async (next) => {
      state.written.push(...next);
      state.entries.push(...next);
    },
    remove: async (ids) => {
      state.removed.push(...ids);
      state.entries = state.entries.filter((e) => !ids.includes(e.id));
    },
    now: () => now,
    id: () => `new-${state.written.length + 1}`,
  };
  return { d, state };
}

function existing(id: string, time = "2026-01-01T00:00:00.000Z"): HistoryEntry {
  return {
    id,
    snippetId: "s1",
    rev: 2,
    reason: "edit",
    snapshot: snippet({ rev: 2 }),
    createdAt: time,
    bytes: 100,
  };
}

describe("recordHistory", () => {
  it("writes a snapshot of the state being replaced", async () => {
    const { d, state } = deps();
    await recordHistory(snippet(), "edit", d);
    expect(state.written).toHaveLength(1);
    expect(state.written[0]).toMatchObject({
      snippetId: "s1",
      rev: 3,
      reason: "edit",
      createdAt: "2026-02-01T00:00:00.000Z",
    });
    expect(state.written[0]?.snapshot.label).toBe("S");
  });

  it("does not write a second snapshot inside the coalescing window", async () => {
    const { d, state } = deps(
      [existing("h1", "2026-02-01T00:00:10.000Z")],
      "2026-02-01T00:00:20.000Z"
    );
    await recordHistory(snippet(), "edit", d);
    expect(state.written).toEqual([]);
  });

  it("records a different reason even inside the window", async () => {
    const { d, state } = deps(
      [existing("h1", "2026-02-01T00:00:10.000Z")],
      "2026-02-01T00:00:20.000Z"
    );
    await recordHistory(snippet(), "delete", d);
    expect(state.written).toHaveLength(1);
  });

  it("removes snapshots rejected by the caps", async () => {
    const { d, state } = deps([
      existing("h1", "2026-01-01T00:00:00.000Z"),
      existing("h2", "2026-01-02T00:00:00.000Z"),
    ]);
    await recordHistory(snippet(), "import", d);
    expect(state.written).toHaveLength(1);
    expect(state.removed.length).toBeGreaterThanOrEqual(0);
  });

  it("snapshots legacy records with revision zero", async () => {
    const { d, state } = deps();
    await recordHistory(snippet({ rev: undefined }), "conflict", d);
    expect(state.written[0]?.rev).toBe(0);
  });
});

describe("getHistory", () => {
  it("returns only the requested snippet, newest first", async () => {
    const { d } = deps([
      { ...existing("old"), snippetId: "s1" },
      { ...existing("other", "2026-03-01T00:00:00.000Z"), snippetId: "s2" },
      { ...existing("new", "2026-04-01T00:00:00.000Z"), snippetId: "s1" },
    ]);
    expect((await getHistory("s1", d)).map((e) => e.id)).toEqual([
      "new",
      "old",
    ]);
  });

  it("returns an empty list for an unknown snippet", async () => {
    const { d } = deps([existing("h1")]);
    expect(await getHistory("missing", d)).toEqual([]);
  });
});

describe("restoreVersion", () => {
  it("finds a snapshot by revision", async () => {
    const { d } = deps([existing("h1")]);
    expect((await restoreVersion("s1", 2, d))?.id).toBe("s1");
  });

  it("returns null for a revision that was never recorded", async () => {
    const { d } = deps([existing("h1")]);
    expect(await restoreVersion("s1", 99, d)).toBeNull();
  });
});
