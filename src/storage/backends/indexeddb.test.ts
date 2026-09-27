/**
 * IndexedDBBackend — the disaster-recovery path.
 * spec: specs/test-infrastructure.spec.md (Wave 4.3)
 *
 * This is the layer that stands between a user who signed out of their browser
 * account and losing every snippet they ever wrote. It was excluded from
 * coverage with the note "unit tests not yet written", which is at least an
 * honest exclusion — but it meant the recovery path had no tests at all.
 *
 * Tested against a real IndexedDB implementation (`fake-indexeddb`, already a
 * devDependency) rather than a hand-rolled mock, because the properties that
 * matter here — transactional clear-then-write, and what survives a partial
 * operation — are properties of IndexedDB, not of a mock's author.
 */

import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/sentry", () => ({
  captureError: vi.fn(),
  captureMessage: vi.fn(),
  initSentry: vi.fn(),
}));

import { IDB_CONFIG } from "@/config/constants";
import { captureError } from "@/lib/sentry";
import { IndexedDBBackend, openDB } from "./indexeddb";
import type { Snippet } from "@/types";

const makeSnippet = (overrides: Partial<Snippet> = {}): Snippet => ({
  id: "s1",
  label: "One",
  shortcut: "/one",
  content: "one",
  tags: [],
  usageCount: 0,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  ...overrides,
});

/**
 * Give each test a brand-new, empty IndexedDB.
 *
 * A fresh `IDBFactory` rather than `deleteDatabase`, because the backend opens
 * a connection per call and never closes it. Those leaked connections make
 * `deleteDatabase` block forever — and since IndexedDB serialises opens behind
 * a pending delete, every subsequent test then hangs in its beforeEach. Swapping
 * the whole factory sidesteps that entirely and is genuinely a fresh v0.
 */
function resetDatabase(): void {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
    new IDBFactory();
}

let backend: IndexedDBBackend;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  resetDatabase();
  backend = new IndexedDBBackend();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetDatabase();
});

describe("IndexedDBBackend — round trip", () => {
  it("returns an empty list when nothing has been written", async () => {
    await expect(backend.getSnippets()).resolves.toEqual([]);
  });

  it("stores and returns a snippet", async () => {
    await backend.saveSnippets([makeSnippet()]);

    await expect(backend.getSnippets()).resolves.toEqual([makeSnippet()]);
  });

  it("counts what it stored", async () => {
    await backend.saveSnippets([
      makeSnippet({ id: "a" }),
      makeSnippet({ id: "b" }),
    ]);

    await expect(backend.getSnippetCount()).resolves.toBe(2);
  });

  it("clears everything on clear()", async () => {
    await backend.saveSnippets([makeSnippet()]);
    await backend.clear();

    await expect(backend.getSnippets()).resolves.toEqual([]);
    await expect(backend.getSnippetCount()).resolves.toBe(0);
  });

  it("survives a new instance reading what another wrote", async () => {
    // The backup is written by whichever context happened to save, and read by
    // whichever one the user opens when recovering.
    await backend.saveSnippets([makeSnippet({ id: "shared" })]);

    const fresh = new IndexedDBBackend();
    await expect(fresh.getSnippets()).resolves.toEqual([
      makeSnippet({ id: "shared" }),
    ]);
  });
});

describe("IndexedDBBackend — saveSnippets replaces rather than merges", () => {
  it("drops a snippet that is absent from the new list", async () => {
    // This is the property that stops a deleted snippet reappearing from the
    // backup. A merge here would resurrect deletions on recovery.
    await backend.saveSnippets([
      makeSnippet({ id: "keep" }),
      makeSnippet({ id: "gone" }),
    ]);
    await backend.saveSnippets([makeSnippet({ id: "keep" })]);

    const ids = (await backend.getSnippets()).map((s) => s.id);
    expect(ids).toEqual(["keep"]);
  });

  it("empties the store when given an empty list", async () => {
    await backend.saveSnippets([makeSnippet()]);
    await backend.saveSnippets([]);

    await expect(backend.getSnippets()).resolves.toEqual([]);
  });

  it("overwrites a snippet with the same id", async () => {
    await backend.saveSnippets([makeSnippet({ id: "a", content: "old" })]);
    await backend.saveSnippets([makeSnippet({ id: "a", content: "new" })]);

    const stored = await backend.getSnippets();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.content).toBe("new");
  });
});

describe("IndexedDBBackend — intent-based mutations", () => {
  it("upsert keeps a record it did not mention", async () => {
    // The whole point of the intent API: the primary store is written from two
    // contexts at once, and the backup must not lose the other context's write.
    await backend.saveSnippets([makeSnippet({ id: "keep" })]);
    await backend.upsertSnippets([makeSnippet({ id: "added" })]);

    const ids = (await backend.getSnippets()).map((s) => s.id).sort();
    expect(ids).toEqual(["added", "keep"]);
  });

  it("upsert replaces a record with the same id", async () => {
    await backend.saveSnippets([makeSnippet({ id: "a", content: "old" })]);
    await backend.upsertSnippets([makeSnippet({ id: "a", content: "new" })]);

    const stored = await backend.getSnippets();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.content).toBe("new");
  });

  it("removeSnippetsById deletes only the ids it was given", async () => {
    await backend.saveSnippets([
      makeSnippet({ id: "keep" }),
      makeSnippet({ id: "drop" }),
    ]);
    await backend.removeSnippetsById(["drop"]);

    expect((await backend.getSnippets()).map((s) => s.id)).toEqual(["keep"]);
  });

  it("removeSnippetsById ignores an id that is not present", async () => {
    await backend.saveSnippets([makeSnippet({ id: "a" })]);
    await backend.removeSnippetsById(["ghost"]);

    expect((await backend.getSnippets()).map((s) => s.id)).toEqual(["a"]);
  });
});

describe("IndexedDBBackend — legacy contentFormat migration", () => {
  it("converts a legacy html body on read", async () => {
    // Shares normalizeSnippet with the sync and local backends. Wave 3 changed
    // that shared step, so this is the assertion that the backup did not drift
    // out of the migration.
    const legacy = {
      ...makeSnippet({ id: "legacy", content: "<p>Hi</p><p>There</p>" }),
      contentFormat: "html",
    } as unknown as Snippet;
    await backend.saveSnippets([legacy]);

    const stored = await backend.getSnippets();
    expect(stored[0]!.content).toBe("Hi\n\nThere");
    expect(stored[0]).not.toHaveProperty("contentFormat");
  });

  it("leaves a markdown body untouched", async () => {
    await backend.saveSnippets([makeSnippet({ content: "**bold**" })]);

    expect((await backend.getSnippets())[0]!.content).toBe("**bold**");
  });
});

/**
 * Make `indexedDB.open` fail, the way a revoked permission or a corrupt schema
 * would. Closing a connection is not enough: the backend opens a fresh one per
 * call, so a closed connection does not make the next open fail.
 */
function breakIndexedDB(): void {
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open: () => {
      throw new Error("IndexedDB unavailable");
    },
  };
}

describe("IndexedDBBackend — error contract", () => {
  // The asymmetry below is deliberate, not a typo. A read or a whole-list save
  // that failed can safely report "nothing changed". An intent-based mutation
  // that failed MUST surface, or the caller believes a deletion succeeded while
  // the record is still on disk. Pinned in both directions so a well-meaning
  // "make these consistent" change fails the suite.
  //
  // These use a throwing store rather than a mocked IDB, because the property
  // under test is what each method does with a failure.

  it("getSnippetCount returns 0 instead of throwing", async () => {
    breakIndexedDB();

    await expect(backend.getSnippetCount()).resolves.toBe(0);
  });

  it("getSnippets returns [] instead of throwing", async () => {
    breakIndexedDB();

    await expect(backend.getSnippets()).resolves.toEqual([]);
  });

  it("saveSnippets does not throw when the database is unavailable", async () => {
    breakIndexedDB();

    await expect(backend.saveSnippets([makeSnippet()])).resolves.not.toThrow();
  });

  it("clear does not throw when the database is unavailable", async () => {
    breakIndexedDB();

    await expect(backend.clear()).resolves.not.toThrow();
  });

  it("upsertSnippets re-throws so a failed write is not silent", async () => {
    breakIndexedDB();

    // A swallowed failure here would tell the caller a save succeeded.
    const outcome = await backend
      .upsertSnippets([makeSnippet()])
      .then(() => "RESOLVED")
      .catch(() => "RETHREW");
    expect(outcome).toBe("RETHREW");
  });

  it("removeSnippetsById re-throws so a failed delete is not silent", async () => {
    breakIndexedDB();

    // The dangerous one: a swallowed failure reports a deletion that never
    // happened, while the record is still in the user's backup.
    const outcome = await backend
      .removeSnippetsById(["s1"])
      .then(() => "RESOLVED")
      .catch(() => "RETHREW");
    expect(outcome).toBe("RETHREW");
  });

  it("reports a failure to Sentry rather than swallowing it silently", async () => {
    breakIndexedDB();

    await backend.getSnippets();

    expect(captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: "idb.getSnippets" })
    );
  });
});

describe("openDB — schema", () => {
  it("creates the snippets store on a fresh database", async () => {
    const db = await openDB();

    expect(db.objectStoreNames.contains(IDB_CONFIG.STORE_NAME)).toBe(true);
    db.close();
  });

  it("creates the media store", async () => {
    const db = await openDB();

    expect(db.objectStoreNames.contains(IDB_CONFIG.MEDIA_STORE_NAME)).toBe(
      true
    );
    db.close();
  });

  it("adds the non-unique hash index to the media store", async () => {
    // Content-hash dedup depends on this index. Without it every insert
    // re-hashes the entire store.
    const db = await openDB();
    const tx = db.transaction(IDB_CONFIG.MEDIA_STORE_NAME, "readonly");
    const store = tx.objectStore(IDB_CONFIG.MEDIA_STORE_NAME);

    expect(store.indexNames.contains("hash")).toBe(true);
    expect(store.index("hash").unique).toBe(false);
    db.close();
  });

  it("opens at the configured version", async () => {
    const db = await openDB();

    expect(db.version).toBe(IDB_CONFIG.VERSION);
    db.close();
  });

  it("reopens an existing database at the same version", async () => {
    // Guards the upgrade path: a second open must not try to upgrade again,
    // which would fire onupgradeneeded and could re-create stores.
    const first = await openDB();
    first.close();
    const second = await openDB();

    expect(second.version).toBe(IDB_CONFIG.VERSION);
    second.close();
  });
});
