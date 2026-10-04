/**
 * IndexedDBBackend — the disaster-recovery path.
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
    // Shares normalizeStoredSnippet with the sync and local backends. Wave 3 changed
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

/**
 * Build a database at an older schema version, the way a user who installed an
 * earlier release would have it on disk.
 *
 * `openDB()` always opens at the current VERSION, so the only way to reach an
 * upgrade from v1 or v2 is to open at that version directly. Every other test in
 * this file starts from a fresh factory, which means `oldVersion` is always 0 and
 * the "already exists" side of each upgrade guard is never taken.
 */
function createLegacyDb(
  version: number,
  stores: readonly string[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_CONFIG.DB_NAME, version);
    req.onupgradeneeded = () => {
      for (const name of stores) {
        req.result.createObjectStore(name, { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

describe("openDB — upgrading a database left by an older release", () => {
  it("keeps the v1 snippets store and adds the media store on v1 -> v3", async () => {
    await createLegacyDb(1, [IDB_CONFIG.STORE_NAME]);

    const db = await openDB();

    // The snippets store must survive — it holds the user's recovered snippets.
    // Re-creating it here would throw ConstraintError and take the whole
    // recovery with it.
    expect(db.objectStoreNames.contains(IDB_CONFIG.STORE_NAME)).toBe(true);
    expect(db.objectStoreNames.contains(IDB_CONFIG.MEDIA_STORE_NAME)).toBe(
      true
    );
    db.close();
  });

  it("preserves snippets written before the upgrade", async () => {
    await createLegacyDb(1, [IDB_CONFIG.STORE_NAME]);
    // Write through a raw v1 connection, the way the old release would have.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(IDB_CONFIG.DB_NAME, 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(IDB_CONFIG.STORE_NAME, "readwrite");
        tx.objectStore(IDB_CONFIG.STORE_NAME).put(makeSnippet({ id: "old" }));
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const db = await openDB();
    const read = await new Promise<Snippet[]>((resolve, reject) => {
      const r = db
        .transaction(IDB_CONFIG.STORE_NAME, "readonly")
        .objectStore(IDB_CONFIG.STORE_NAME)
        .getAll();
      r.onsuccess = () => resolve(r.result as Snippet[]);
      r.onerror = () => reject(r.error);
    });

    expect(read.map((s) => s.id)).toEqual(["old"]);
    db.close();
  });

  it("adds the hash index on v2 -> v3 without disturbing the media store", async () => {
    await createLegacyDb(2, [
      IDB_CONFIG.STORE_NAME,
      IDB_CONFIG.MEDIA_STORE_NAME,
    ]);

    const db = await openDB();
    const store = db
      .transaction(IDB_CONFIG.MEDIA_STORE_NAME, "readonly")
      .objectStore(IDB_CONFIG.MEDIA_STORE_NAME);

    expect(store.indexNames.contains("hash")).toBe(true);
    db.close();
  });
});

/** Put a media row directly, bypassing any hashing. */
async function putMediaRaw(entry: {
  id: string;
  blob: Blob;
  hash?: string;
}): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_CONFIG.MEDIA_STORE_NAME, "readwrite");
    tx.objectStore(IDB_CONFIG.MEDIA_STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function readMedia(id: string): Promise<{ hash?: string } | undefined> {
  const db = await openDB();
  const entry = await new Promise<{ hash?: string } | undefined>(
    (resolve, reject) => {
      const r = db
        .transaction(IDB_CONFIG.MEDIA_STORE_NAME, "readonly")
        .objectStore(IDB_CONFIG.MEDIA_STORE_NAME)
        .get(id);
      r.onsuccess = () => resolve(r.result as { hash?: string } | undefined);
      r.onerror = () => reject(r.error);
    }
  );
  db.close();
  return entry;
}

describe("openDB — media hash backfill", () => {
  /**
   * The backfill cannot be exercised end to end here, and the reason is worth
   * stating rather than working around.
   *
   * `backfillMediaHashes` filters on `e.blob instanceof Blob` before hashing.
   * `fake-indexeddb` does not structured-clone a Blob: a blob written to the
   * store reads back as a bare `{ type: "..." }` object with no `arrayBuffer`
   * and a plain-Object prototype. So under this test environment the filter
   * rejects every row, `needsHash` is always empty, and the hashing loop is
   * unreachable. That is the filter working, not a defect — but it does mean
   * the loop itself is only covered by the media e2e specs.
   *
   * What IS reachable, and what these tests pin, is that a row the backfill
   * cannot hash is skipped quietly rather than throwing or being corrupted.
   */
  it("skips an entry whose blob did not survive storage", async () => {
    await putMediaRaw({ id: "m1", blob: new Blob(["hello"]) });

    // Must not reject, and must not report a failure: an unreadable row is
    // skipped, not treated as an error worth waking someone for.
    await expect(openDB().then((db) => db.close())).resolves.toBeUndefined();
    expect(captureError).not.toHaveBeenCalled();
  });

  it("leaves the unreadable entry untouched rather than dropping it", async () => {
    await putMediaRaw({ id: "m1", blob: new Blob(["hello"]) });

    await openDB().then((db) => db.close());
    const after = await readMedia("m1");

    // The entry itself must survive even though it was not hashable — losing it
    // would lose the user's image, which is the one thing this backup exists to
    // prevent.
    expect(after).toBeDefined();
    expect(after?.hash).toBeUndefined();
  });

  it("reports nothing when there is nothing to backfill", async () => {
    await openDB().then((db) => db.close());

    expect(captureError).not.toHaveBeenCalled();
  });
});

describe("IndexedDBBackend — empty inputs do no work", () => {
  it("upsertSnippets writes nothing for an empty list", async () => {
    await backend.saveSnippets([makeSnippet()]);
    const open = vi.spyOn(globalThis.indexedDB, "open");

    await backend.upsertSnippets([]);

    // Asserted on the transaction, not just on the data: clearing and re-writing
    // an empty list would leave the data correct while destroying any snippet a
    // concurrent caller had written since. The early return has to happen
    // before the store is touched.
    expect(open).not.toHaveBeenCalled();
    expect(await backend.getSnippets()).toHaveLength(1);
  });

  it("removeSnippetsById deletes nothing when given no ids", async () => {
    await backend.saveSnippets([makeSnippet()]);
    const open = vi.spyOn(globalThis.indexedDB, "open");

    await backend.removeSnippetsById([]);

    expect(open).not.toHaveBeenCalled();
    expect(await backend.getSnippets()).toHaveLength(1);
  });

  it("does not throw on empty inputs even with no database at all", async () => {
    // Both are no-ops by contract, so they must not depend on the database
    // being reachable — the manager calls them during teardown and recovery.
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      new IDBFactory();

    await expect(backend.upsertSnippets([])).resolves.toBeUndefined();
    await expect(backend.removeSnippetsById([])).resolves.toBeUndefined();
  });
});

describe("IndexedDBBackend — transaction-level failures", () => {
  /**
   * The existing error-contract tests make `openDB()` fail, so every method
   * takes its outer `catch`. That leaves the inner `tx.onerror` and
   * `request.onerror` callbacks untested, and those are the ones that decide
   * whether a *partially* applied write is reported or silently dropped.
   *
   * Aborting the transaction is the realistic shape of that failure — a quota
   * error mid-write behaves the same way — and fake-indexeddb fires the same
   * events a browser would.
   */
  /**
   * fake-indexeddb does not expose IDBObjectStore as a global, so the prototype
   * to patch is taken from a live store.
   */
  async function storePrototype(): Promise<object> {
    const db = await openDB();
    const store = db
      .transaction(IDB_CONFIG.STORE_NAME, "readonly")
      .objectStore(IDB_CONFIG.STORE_NAME);
    const proto = Object.getPrototypeOf(store);
    db.close();
    return proto;
  }

  /** Make the named store method abort its transaction, as a quota error would. */
  async function abortOn(method: "put" | "getAll" | "count"): Promise<void> {
    const proto = (await storePrototype()) as Record<string, unknown>;
    vi.spyOn(proto, method).mockImplementation(function (this: {
      transaction: { abort: () => void };
    }) {
      this.transaction.abort();
      return {} as IDBRequest;
    });
  }

  it("clear does not throw when its transaction aborts", async () => {
    await abortOn("put");

    await expect(backend.clear()).resolves.toBeUndefined();
  });
});

describe("openDB — refusing to downgrade", () => {
  it("rejects when the database on disk is newer than this build expects", async () => {
    // A user who downgrades the extension, or restores a profile from a newer
    // machine, leaves a higher-versioned database behind. Opening at a lower
    // version must fail loudly rather than silently presenting a schema the
    // current code does not understand.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(IDB_CONFIG.DB_NAME, IDB_CONFIG.VERSION + 2);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_CONFIG.STORE_NAME, { keyPath: "id" });
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });

    await expect(openDB()).rejects.toBeTruthy();
  });
});
