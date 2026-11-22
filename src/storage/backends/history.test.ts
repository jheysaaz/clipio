import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { HistoryEntry } from "@/lib/history-policy";
import type { Snippet } from "@/types";
import { deleteHistory, listHistory, writeHistory } from "./history";

vi.mock("~/lib/sentry", () => ({
  captureError: vi.fn(),
  captureMessage: vi.fn(),
  initSentry: vi.fn(),
}));

function resetDatabase(): void {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
    new IDBFactory();
}

function snippet(): Snippet {
  return {
    id: "s1",
    label: "S",
    content: "body",
    shortcut: "/s",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    rev: 2,
  };
}

function entry(id: string): HistoryEntry {
  return {
    id,
    snippetId: "s1",
    rev: 2,
    reason: "edit",
    snapshot: snippet(),
    createdAt: "2026-01-01T00:00:00.000Z",
    bytes: 100,
  };
}

describe("history backend", () => {
  beforeEach(() => {
    resetDatabase();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetDatabase();
  });

  it("returns an empty list for a fresh database", async () => {
    expect(await listHistory()).toEqual([]);
  });

  it("round-trips a snapshot", async () => {
    await writeHistory([entry("h1")]);
    expect(await listHistory()).toEqual([entry("h1")]);
  });

  it("deletes only the named snapshots", async () => {
    await writeHistory([entry("h1"), entry("h2")]);
    await deleteHistory(["h1"]);
    expect((await listHistory()).map((e) => e.id)).toEqual(["h2"]);
  });

  it("ignores an empty write", async () => {
    await writeHistory([]);
    await deleteHistory([]);
    expect(await listHistory()).toEqual([]);
  });

  it("returns an empty list when the database cannot be opened", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("unavailable");
      },
    });
    expect(await listHistory()).toEqual([]);
  });
});
