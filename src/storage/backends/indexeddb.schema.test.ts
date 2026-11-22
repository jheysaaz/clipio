/**
 * Schema-upgrade and media-backfill seams for src/storage/backends/indexeddb.ts.
 *
 * The sibling indexeddb.test.ts drives a real fake-indexeddb database. That
 * fake cannot produce several upgrade states and does not structured-clone a
 * Blob, so the guards in the upgrade handler and the backfill loop are not
 * reachable there. These tests call the extracted seams with synthetic fakes
 * — the shipped functions themselves, not copies of their logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/sentry", () => ({
  captureError: vi.fn(),
  captureMessage: vi.fn(),
  initSentry: vi.fn(),
}));

import { IDB_CONFIG } from "@/config/constants";
import { captureError } from "@/lib/sentry";
import {
  applySchemaUpgrades,
  backfillMediaHashes,
  defaultBackfillMediaDeps,
  openDB,
} from "./indexeddb";
import type { BackfillMediaDeps, MediaBackfillEntry } from "./indexeddb";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Schema upgrades
// ---------------------------------------------------------------------------

/**
 * A database whose store/index registries can be seeded to any schema state,
 * including states fake-indexeddb refuses to create (a store that already
 * exists below the version that would create it, for instance).
 */
function makeUpgradeHarness(
  existingStores: readonly string[],
  existingIndexes: readonly string[] = []
) {
  const stores = [...existingStores];
  const indexes = [...existingIndexes];
  const mediaStore = {
    indexNames: {
      contains: vi.fn((name: string) => indexes.includes(name)),
    },
    createIndex: vi.fn((name: string) => {
      indexes.push(name);
    }),
  };
  const db = {
    objectStoreNames: {
      contains: vi.fn((name: string) => stores.includes(name)),
    },
    createObjectStore: vi.fn((name: string) => {
      stores.push(name);
    }),
  };
  const request = {
    transaction: { objectStore: vi.fn(() => mediaStore) },
  } as unknown as IDBOpenDBRequest;

  return {
    db: db as unknown as IDBDatabase,
    request,
    dbFake: db,
    mediaStore,
    stores,
  };
}

const { STORE_NAME, MEDIA_STORE_NAME } = IDB_CONFIG;

describe("applySchemaUpgrades — v1", () => {
  it("creates the snippets store on a database with no stores at all", () => {
    // Proves the v1 branch actually creates the store rather than merely
    // leaving one that the harness happened to seed.
    const h = makeUpgradeHarness([]);

    applySchemaUpgrades(h.db, 0, h.request, h.request);

    expect(h.dbFake.createObjectStore).toHaveBeenCalledWith(STORE_NAME, {
      keyPath: "id",
    });
    expect(h.stores).toContain(STORE_NAME);
  });

  it("does not recreate an existing snippets store", () => {
    // Recreating it on an v0→v3 open would throw ConstraintError and take the
    // user's recovered snippets with it.
    const h = makeUpgradeHarness([STORE_NAME]);

    applySchemaUpgrades(h.db, 0, h.request, h.request);

    expect(h.dbFake.createObjectStore).not.toHaveBeenCalledWith(
      STORE_NAME,
      expect.anything()
    );
    expect(h.stores).toEqual([STORE_NAME, MEDIA_STORE_NAME]);
  });
});

describe("applySchemaUpgrades — v2", () => {
  it("creates a missing media store before the v3 index step", () => {
    const h = makeUpgradeHarness([STORE_NAME]);

    applySchemaUpgrades(h.db, 1, h.request, h.request);

    expect(h.dbFake.createObjectStore).toHaveBeenCalledTimes(1);
    expect(h.dbFake.createObjectStore).toHaveBeenCalledWith(MEDIA_STORE_NAME, {
      keyPath: "id",
    });
    expect(h.mediaStore.createIndex).toHaveBeenCalledWith("hash", "hash", {
      unique: false,
    });
  });

  it("does not recreate the media store when it already exists", () => {
    const h = makeUpgradeHarness([STORE_NAME, MEDIA_STORE_NAME]);

    applySchemaUpgrades(h.db, 2, h.request, h.request);

    expect(h.dbFake.createObjectStore).not.toHaveBeenCalled();
    expect(h.mediaStore.createIndex).toHaveBeenCalledWith("hash", "hash", {
      unique: false,
    });
  });

  it("leaves an existing media store alone when upgrading from v1", () => {
    // The v2 guard is false here while the v3 step still runs: exactly the
    // combination that the v2-only test cannot reach.
    const h = makeUpgradeHarness([STORE_NAME, MEDIA_STORE_NAME], ["hash"]);

    applySchemaUpgrades(h.db, 1, h.request, h.request);

    expect(h.dbFake.createObjectStore).not.toHaveBeenCalled();
    expect(h.mediaStore.createIndex).not.toHaveBeenCalled();
  });
});

describe("applySchemaUpgrades — v3", () => {
  it("adds the non-unique hash index on v2 → v3", () => {
    const h = makeUpgradeHarness([STORE_NAME, MEDIA_STORE_NAME]);

    applySchemaUpgrades(h.db, 2, h.request, h.request);

    expect(h.request.transaction!.objectStore).toHaveBeenCalledWith(
      MEDIA_STORE_NAME
    );
    expect(h.mediaStore.createIndex).toHaveBeenCalledWith("hash", "hash", {
      unique: false,
    });
  });

  it("does not create an index that is already present", () => {
    // A repeated upgrade firing on a schema that already has the index would
    // throw ConstraintError; the contains guard must be taken.
    const h = makeUpgradeHarness([STORE_NAME, MEDIA_STORE_NAME], ["hash"]);

    applySchemaUpgrades(h.db, 2, h.request, h.request);

    expect(h.mediaStore.indexNames.contains).toHaveBeenCalledWith("hash");
    expect(h.mediaStore.createIndex).not.toHaveBeenCalled();
  });

  it("skips the index step when the upgrade event has no current target", () => {
    // The falsy guard exists to avoid dereferencing an event with no target.
    // With no target there is no transaction to look the media store up in.
    const h = makeUpgradeHarness([STORE_NAME, MEDIA_STORE_NAME]);

    expect(() => applySchemaUpgrades(h.db, 2, h.request, null)).not.toThrow();
    expect(h.request.transaction!.objectStore).not.toHaveBeenCalled();
    expect(h.mediaStore.createIndex).not.toHaveBeenCalled();
  });

  it("does nothing when the database is already at the configured version", () => {
    const h = makeUpgradeHarness([STORE_NAME, MEDIA_STORE_NAME], ["hash"]);

    applySchemaUpgrades(h.db, IDB_CONFIG.VERSION, h.request, h.request);

    // All three version guards must be false: no writes to a schema this build
    // already understands.
    expect(h.dbFake.createObjectStore).not.toHaveBeenCalled();
    expect(h.request.transaction!.objectStore).not.toHaveBeenCalled();
    expect(h.mediaStore.createIndex).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Media hash backfill
// ---------------------------------------------------------------------------

type Fired = { onsuccess: boolean; onerror: boolean; oncomplete: boolean };

/** A request whose success/error callback is fired on the next microtask. */
function makeRequest<T>(result: T, error: Error | undefined, fail: boolean) {
  let onsuccess: (() => void) | null = null;
  let onerror: (() => void) | null = null;
  const fired: Fired = {
    onsuccess: false,
    onerror: false,
    oncomplete: false,
  };
  const request = {
    result,
    error,
    get onsuccess() {
      return onsuccess;
    },
    set onsuccess(handler: (() => void) | null) {
      onsuccess = handler;
    },
    get onerror() {
      return onerror;
    },
    set onerror(handler: (() => void) | null) {
      onerror = handler;
    },
  };
  queueMicrotask(() => {
    if (fail) {
      fired.onerror = true;
      onerror?.();
    } else {
      fired.onsuccess = true;
      onsuccess?.();
    }
  });
  return { request, fired };
}

/** A write transaction that completes or errors on the next microtask. */
function makeWriteTx(store: object, error?: Error) {
  let oncomplete: (() => void) | null = null;
  let onerror: (() => void) | null = null;
  const fired: Fired = {
    onsuccess: false,
    onerror: false,
    oncomplete: false,
  };
  const tx = {
    objectStore: vi.fn(() => store),
    error,
    get oncomplete() {
      return oncomplete;
    },
    set oncomplete(handler: (() => void) | null) {
      oncomplete = handler;
    },
    get onerror() {
      return onerror;
    },
    set onerror(handler: (() => void) | null) {
      onerror = handler;
    },
  };
  queueMicrotask(() => {
    if (error) {
      fired.onerror = true;
      onerror?.();
    } else {
      fired.oncomplete = true;
      oncomplete?.();
    }
  });
  return { tx, fired };
}

function makeBackfillHarness(
  options: {
    entries?: MediaBackfillEntry[];
    getAllError?: Error;
    writeError?: Error;
  } = {}
) {
  const written: MediaBackfillEntry[] = [];
  const readFired: Fired[] = [];
  const writeFired: Fired[] = [];
  const db = {
    transaction: vi.fn((_name: string, mode: IDBTransactionMode) => {
      if (mode === "readonly") {
        const { request, fired } = makeRequest(
          options.entries ?? [],
          options.getAllError,
          Boolean(options.getAllError)
        );
        readFired.push(fired);
        return {
          objectStore: vi.fn(() => ({ getAll: vi.fn(() => request) })),
        } as unknown as IDBTransaction;
      }

      const store = {
        put: vi.fn((entry: MediaBackfillEntry) => {
          written.push(entry);
        }),
      };
      const { tx, fired } = makeWriteTx(store, options.writeError);
      writeFired.push(fired);
      return tx as unknown as IDBTransaction;
    }),
  };
  return {
    db: db as unknown as IDBDatabase,
    written,
    readFired,
    writeFired,
  };
}

const makeEntry = (
  id: string,
  overrides: Partial<MediaBackfillEntry> = {}
): MediaBackfillEntry => ({ id, blob: new Blob(["hello"]), ...overrides });

const depsWithHash = (hashBlob: BackfillMediaDeps["hashBlob"]) => ({
  ...defaultBackfillMediaDeps,
  hashBlob,
});

describe("backfillMediaHashes — filter", () => {
  it("does nothing when the media store has no entries", async () => {
    const h = makeBackfillHarness({ entries: [] });
    const hashBlob = vi.fn(async () => "unused");

    await backfillMediaHashes(h.db, depsWithHash(hashBlob));

    expect(hashBlob).not.toHaveBeenCalled();
    expect(h.written).toEqual([]);
    expect(captureError).not.toHaveBeenCalled();
  });

  it("skips an entry that already has a hash", async () => {
    const h = makeBackfillHarness({
      entries: [makeEntry("m1", { hash: "already-set" })],
    });
    const hashBlob = vi.fn(async () => "should-not-run");

    await backfillMediaHashes(h.db, depsWithHash(hashBlob));

    expect(hashBlob).not.toHaveBeenCalled();
    expect(h.written).toEqual([]);
  });

  it("skips a row whose blob did not survive storage", async () => {
    // fake-indexeddb reads a stored Blob back as a plain object. The seam must
    // reject it rather than calling arrayBuffer on something that has none.
    const h = makeBackfillHarness({
      entries: [
        {
          id: "m1",
          blob: { type: "image/png" } as unknown as Blob,
        },
      ],
    });
    const hashBlob = vi.fn(async () => "should-not-run");

    await backfillMediaHashes(h.db, depsWithHash(hashBlob));

    expect(hashBlob).not.toHaveBeenCalled();
    expect(h.written).toEqual([]);
    expect(captureError).not.toHaveBeenCalled();
  });
});

describe("backfillMediaHashes — hashing loop", () => {
  it("hashes an un-hashed Blob and writes the result back", async () => {
    const entry = makeEntry("m1");
    const h = makeBackfillHarness({ entries: [entry] });
    const hashBlob = vi.fn(async () => "deadbeef");

    await backfillMediaHashes(h.db, depsWithHash(hashBlob));

    // The write must carry the original fields plus the digest; dropping any
    // of them would lose the user's media metadata during the upgrade.
    expect(hashBlob).toHaveBeenCalledWith(entry.blob);
    expect(h.written).toEqual([{ ...entry, hash: "deadbeef" }]);
    expect(h.writeFired[0]?.oncomplete).toBe(true);
    expect(captureError).not.toHaveBeenCalled();
  });

  it("computes the real SHA-256 digest through the default dependencies", async () => {
    // Pins the shipped hashing implementation, not just an injected stub.
    const h = makeBackfillHarness({ entries: [makeEntry("m1")] });

    await backfillMediaHashes(h.db);

    expect(h.written[0]?.hash).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });

  it("captures a hash failure per entry and still processes the next one", async () => {
    const failing = makeEntry("bad");
    const good = makeEntry("good");
    const h = makeBackfillHarness({ entries: [failing, good] });
    const hashBlob = vi.fn(async (blob: Blob) => {
      if (blob === failing.blob) throw new Error("digest failed");
      return "good-hash";
    });

    await expect(
      backfillMediaHashes(h.db, depsWithHash(hashBlob))
    ).resolves.toBeUndefined();

    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      action: "idb.backfillMediaHashes.entry",
      id: "bad",
    });
    expect(h.written).toEqual([{ ...good, hash: "good-hash" }]);
  });
});

describe("backfillMediaHashes — failure paths", () => {
  it("rejects when the getAll request fails instead of writing anything", async () => {
    const error = new Error("read failed");
    const h = makeBackfillHarness({ getAllError: error });

    await expect(
      backfillMediaHashes(h.db, depsWithHash(vi.fn(async () => "unused")))
    ).rejects.toBe(error);

    expect(h.readFired[0]?.onerror).toBe(true);
    expect(h.written).toEqual([]);
  });

  it("captures a write-transaction failure for that entry", async () => {
    const h = makeBackfillHarness({
      entries: [makeEntry("m1")],
      writeError: new Error("quota"),
    });

    await expect(
      backfillMediaHashes(h.db, depsWithHash(vi.fn(async () => "hash")))
    ).resolves.toBeUndefined();

    expect(h.writeFired[0]?.onerror).toBe(true);
    expect(h.written).toHaveLength(1);
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      action: "idb.backfillMediaHashes.entry",
      id: "m1",
    });
  });

  it("reports a whole-run backfill failure without rejecting openDB", async () => {
    // openDB deliberately does not await the backfill. A read failure must
    // still hand back a usable database while reporting the failure once at
    // the top-level action.
    const error = new Error("backfill read failed");
    const h = makeBackfillHarness({ getAllError: error });
    vi.stubGlobal("indexedDB", {
      open: vi.fn(() => {
        const request = {
          result: h.db,
          onupgradeneeded: null as (() => void) | null,
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
          error: null,
        };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      }),
    });

    await expect(openDB()).resolves.toBe(h.db);
    await vi.waitFor(() =>
      expect(captureError).toHaveBeenCalledWith(error, {
        action: "idb.backfillMediaHashes",
      })
    );
  });
});
