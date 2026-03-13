/**
 * IDB error-path tests for src/storage/backends/media.ts
 *
 * These tests mock `./indexeddb` so that `openDB()` returns a fake IDBDatabase
 * whose transactions fire `onerror`, exercising the catch blocks and `tx.onerror`
 * arrow functions that are otherwise impossible to reach with fake-indexeddb.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock sentry BEFORE importing media functions so captureError is intercepted
// ---------------------------------------------------------------------------
vi.mock("~/lib/sentry", () => ({
  captureError: vi.fn(),
  captureMessage: vi.fn(),
}));

import { captureError } from "~/lib/sentry";

// ---------------------------------------------------------------------------
// Mock ./indexeddb so openDB can be controlled per-test
// ---------------------------------------------------------------------------
vi.mock("./indexeddb", () => ({
  openDB: vi.fn(),
}));

import { openDB } from "./indexeddb";

import {
  saveMedia,
  restoreMediaEntry,
  getMedia,
  deleteMedia,
  deleteMediaBatch,
  updateMediaAlt,
  listMedia,
  getTotalSize,
  compressMedia,
} from "./media";
import type { MediaEntry } from "./media";

// ---------------------------------------------------------------------------
// Helper: build a mock IDBDatabase whose transaction fires onerror
// ---------------------------------------------------------------------------
function makeFakeError() {
  return new DOMException("IDB transaction failed", "UnknownError");
}

function makeFailingDB() {
  const fakeError = makeFakeError();
  return {
    transaction: vi.fn(() => {
      const tx = {
        objectStore: vi.fn(() => ({
          put: vi.fn(),
          delete: vi.fn(),
          get: vi.fn(() => {
            const req = {
              onsuccess: null as null | (() => void),
              onerror: null as null | (() => void),
              error: fakeError,
            };
            // Fire onerror on next microtask
            Promise.resolve().then(() => {
              if (req.onerror) req.onerror();
            });
            return req;
          }),
          getAll: vi.fn(() => {
            const req = {
              onsuccess: null as null | (() => void),
              onerror: null as null | (() => void),
              error: fakeError,
            };
            Promise.resolve().then(() => {
              if (req.onerror) req.onerror();
            });
            return req;
          }),
        })),
        oncomplete: null as null | (() => void),
        onerror: null as null | (() => void),
        error: fakeError,
      };
      // Fire onerror on next microtask so tx.onerror is set first
      Promise.resolve().then(() => {
        if (tx.onerror) tx.onerror();
      });
      return tx;
    }),
  } as unknown as IDBDatabase;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: openDB succeeds but returns a failing DB
  vi.mocked(openDB).mockResolvedValue(makeFailingDB());
});

// ---------------------------------------------------------------------------
// saveMedia — IDB write error (catch block + tx.onerror)
// ---------------------------------------------------------------------------

describe("saveMedia IDB error paths", () => {
  it("calls captureError and re-throws when IDB transaction fails", async () => {
    // saveMedia validates first, so provide a valid small blob
    // Call order: findByHash (dedup check), getTotalSize (listMedia), saveMedia write
    const emptyDB = {
      transaction: vi.fn(() => {
        const tx = {
          objectStore: vi.fn(() => ({
            getAll: vi.fn(() => {
              const req = {
                onsuccess: null as null | (() => void),
                onerror: null as null | (() => void),
                result: [],
              };
              Promise.resolve().then(() => {
                if (req.onsuccess) req.onsuccess();
              });
              return req;
            }),
          })),
          oncomplete: null as null | (() => void),
          onerror: null as null | (() => void),
          error: null,
        };
        Promise.resolve().then(() => {
          if (tx.oncomplete) tx.oncomplete();
        });
        return tx;
      }),
    } as unknown as IDBDatabase;

    // findByHash DB: returns null (no duplicate found)
    const findByHashDB = {
      transaction: vi.fn(() => {
        const tx = {
          objectStore: vi.fn(() => ({
            indexNames: { contains: vi.fn(() => true) },
            index: vi.fn(() => ({
              get: vi.fn(() => {
                const req = {
                  onsuccess: null as null | (() => void),
                  onerror: null as null | (() => void),
                  result: undefined,
                };
                Promise.resolve().then(() => {
                  if (req.onsuccess) req.onsuccess();
                });
                return req;
              }),
            })),
          })),
          oncomplete: null as null | (() => void),
          onerror: null as null | (() => void),
          error: null,
        };
        return tx;
      }),
    } as unknown as IDBDatabase;

    // Call order: findByHash, getTotalSize→listMedia, saveMedia write
    vi.mocked(openDB)
      .mockResolvedValueOnce(findByHashDB) // findByHash (dedup check)
      .mockResolvedValueOnce(emptyDB) // getTotalSize→listMedia
      .mockResolvedValueOnce(makeFailingDB()); // saveMedia write

    const file = new Blob([new Uint8Array(100)], { type: "image/png" });
    await expect(saveMedia(file)).rejects.toThrow();
    expect(captureError).toHaveBeenCalledWith(expect.anything(), {
      action: "media.save",
    });
  });
});

// ---------------------------------------------------------------------------
// restoreMediaEntry — IDB write error
// ---------------------------------------------------------------------------

describe("restoreMediaEntry IDB error paths", () => {
  it("calls captureError and re-throws when IDB transaction fails", async () => {
    const entry: MediaEntry = {
      id: "restore-error-id",
      mimeType: "image/png",
      width: 1,
      height: 1,
      size: 64,
      originalSize: 64,
      createdAt: "2025-01-01T00:00:00.000Z",
      blob: new Blob([new Uint8Array(64)], { type: "image/png" }),
    };

    await expect(restoreMediaEntry(entry)).rejects.toThrow();
    expect(captureError).toHaveBeenCalledWith(expect.anything(), {
      action: "media.restore",
    });
  });
});

// ---------------------------------------------------------------------------
// getMedia — IDB read error (req.onerror)
// ---------------------------------------------------------------------------

describe("getMedia IDB error paths", () => {
  it("calls captureError and returns null when IDB request fails", async () => {
    const result = await getMedia("any-id");
    expect(result).toBeNull();
    expect(captureError).toHaveBeenCalledWith(expect.anything(), {
      action: "media.get",
    });
  });
});

// ---------------------------------------------------------------------------
// deleteMedia — IDB delete error
// ---------------------------------------------------------------------------

describe("deleteMedia IDB error paths", () => {
  it("calls captureError when IDB transaction fails", async () => {
    // deleteMedia swallows the error (no re-throw)
    const deletingDB = {
      transaction: vi.fn(() => {
        const tx = {
          objectStore: vi.fn(() => ({
            delete: vi.fn(),
          })),
          oncomplete: null as null | (() => void),
          onerror: null as null | (() => void),
          error: makeFakeError(),
        };
        Promise.resolve().then(() => {
          if (tx.onerror) tx.onerror();
        });
        return tx;
      }),
    } as unknown as IDBDatabase;
    vi.mocked(openDB).mockResolvedValue(deletingDB);

    await expect(deleteMedia("some-id")).resolves.toBeUndefined();
    expect(captureError).toHaveBeenCalledWith(expect.anything(), {
      action: "media.delete",
    });
  });
});

// ---------------------------------------------------------------------------
// deleteMediaBatch — IDB delete error
// ---------------------------------------------------------------------------

describe("deleteMediaBatch IDB error paths", () => {
  it("calls captureError when IDB transaction fails", async () => {
    const batchDB = {
      transaction: vi.fn(() => {
        const tx = {
          objectStore: vi.fn(() => ({
            delete: vi.fn(),
          })),
          oncomplete: null as null | (() => void),
          onerror: null as null | (() => void),
          error: makeFakeError(),
        };
        Promise.resolve().then(() => {
          if (tx.onerror) tx.onerror();
        });
        return tx;
      }),
    } as unknown as IDBDatabase;
    vi.mocked(openDB).mockResolvedValue(batchDB);

    await expect(deleteMediaBatch(["id-1", "id-2"])).resolves.toBeUndefined();
    expect(captureError).toHaveBeenCalledWith(expect.anything(), {
      action: "media.deleteBatch",
    });
  });
});

// ---------------------------------------------------------------------------
// updateMediaAlt — IDB error on getMedia read
// ---------------------------------------------------------------------------

describe("updateMediaAlt IDB error paths", () => {
  it("calls captureError when underlying getMedia fails", async () => {
    // getMedia will fail (req.onerror fires), which throws, caught by updateMediaAlt
    await expect(updateMediaAlt("some-id", "new alt")).resolves.toBeUndefined();
    expect(captureError).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listMedia — IDB getAll error
// ---------------------------------------------------------------------------

describe("listMedia IDB error paths", () => {
  it("calls captureError and returns empty array when IDB request fails", async () => {
    const result = await listMedia();
    expect(result).toEqual([]);
    expect(captureError).toHaveBeenCalledWith(expect.anything(), {
      action: "media.list",
    });
  });
});

// ---------------------------------------------------------------------------
// getTotalSize — error propagation from listMedia
// ---------------------------------------------------------------------------

describe("getTotalSize IDB error paths", () => {
  it("calls captureError and returns 0 when listMedia IDB fails", async () => {
    // listMedia catches IDB error and returns [] → getTotalSize gets []
    // getTotalSize only hits its own catch if listMedia throws, which it doesn't.
    // So we test that getTotalSize handles the case where listMedia returns 0 after IDB error.
    const result = await getTotalSize();
    expect(result).toBe(0);
    // captureError called at the listMedia level
    expect(captureError).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// compressMedia — IDB error on write (tx.onerror in the update block)
// ---------------------------------------------------------------------------

describe("compressMedia IDB error paths", () => {
  it("calls captureError when compressMedia IDB write fails", async () => {
    // compressMedia calls getMedia first, then writes. We need getMedia to succeed
    // (return a PNG entry) and the write transaction to fail.
    const fakeEntry: MediaEntry = {
      id: "compress-err-id",
      mimeType: "image/png",
      width: 10,
      height: 10,
      size: 100,
      originalSize: 100,
      createdAt: "2025-01-01T00:00:00.000Z",
      blob: new Blob([new Uint8Array(100)], { type: "image/png" }),
    };

    // First openDB call: getMedia (returns the entry successfully)
    const readDB = {
      transaction: vi.fn(() => {
        const tx = {
          objectStore: vi.fn(() => ({
            get: vi.fn(() => {
              const req = {
                onsuccess: null as null | (() => void),
                onerror: null as null | (() => void),
                result: fakeEntry,
              };
              Promise.resolve().then(() => {
                if (req.onsuccess) req.onsuccess();
              });
              return req;
            }),
          })),
          oncomplete: null,
          onerror: null,
          error: null,
        };
        return tx;
      }),
    } as unknown as IDBDatabase;

    // Second openDB call (write after compression): fails
    const writeDB = makeFailingDB();

    vi.mocked(openDB)
      .mockResolvedValueOnce(readDB) // getMedia read
      .mockResolvedValueOnce(writeDB); // compressMedia write

    // Stub OffscreenCanvas + createImageBitmap so compression succeeds and produces a smaller blob
    const smallerBlob = new Blob([new Uint8Array(10)], { type: "image/webp" });
    const mockBitmap = { width: 10, height: 10, close: vi.fn() };
    const mockCtx = { drawImage: vi.fn() };
    const mockCanvas = {
      getContext: vi.fn(() => mockCtx),
      convertToBlob: vi.fn(async () => smallerBlob),
    };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => mockBitmap)
    );
    vi.stubGlobal(
      "OffscreenCanvas",
      vi.fn(function () {
        return mockCanvas;
      })
    );

    await expect(compressMedia("compress-err-id")).resolves.toBeUndefined();
    expect(captureError).toHaveBeenCalledWith(expect.anything(), {
      action: "media.compress",
    });

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// readDimensions success path (lines 47-50 in media.ts)
// Covered indirectly by saveMedia when createImageBitmap is stubbed to succeed.
// ---------------------------------------------------------------------------

describe("readDimensions success path", () => {
  it("reads dimensions when createImageBitmap succeeds during saveMedia", async () => {
    // Stub createImageBitmap to succeed (so readDimensions takes the success path)
    const mockBitmap = { width: 20, height: 30, close: vi.fn() };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => mockBitmap)
    );

    // findByHash DB: supports store.index("hash").get(...) → returns null (no duplicate)
    const findByHashDB = {
      transaction: vi.fn(() => {
        const tx = {
          objectStore: vi.fn(() => ({
            indexNames: { contains: vi.fn(() => true) },
            index: vi.fn(() => ({
              get: vi.fn(() => {
                const req = {
                  onsuccess: null as null | (() => void),
                  onerror: null as null | (() => void),
                  result: undefined,
                };
                Promise.resolve().then(() => {
                  if (req.onsuccess) req.onsuccess();
                });
                return req;
              }),
            })),
          })),
          oncomplete: null as null | (() => void),
          onerror: null as null | (() => void),
          error: null,
        };
        return tx;
      }),
    } as unknown as IDBDatabase;

    // getTotalSize needs a working listMedia → use empty getAll DB
    const emptyListDB = {
      transaction: vi.fn(() => {
        const tx = {
          objectStore: vi.fn(() => ({
            getAll: vi.fn(() => {
              const req = {
                onsuccess: null as null | (() => void),
                onerror: null as null | (() => void),
                result: [],
              };
              Promise.resolve().then(() => {
                if (req.onsuccess) req.onsuccess();
              });
              return req;
            }),
          })),
          oncomplete: null as null | (() => void),
          onerror: null as null | (() => void),
          error: null,
        };
        Promise.resolve().then(() => {
          if (tx.oncomplete) tx.oncomplete();
        });
        return tx;
      }),
    } as unknown as IDBDatabase;

    // saveMedia write DB
    const writeSuccessDB = {
      transaction: vi.fn(() => {
        const tx = {
          objectStore: vi.fn(() => ({ put: vi.fn() })),
          oncomplete: null as null | (() => void),
          onerror: null as null | (() => void),
          error: null,
        };
        Promise.resolve().then(() => {
          if (tx.oncomplete) tx.oncomplete();
        });
        return tx;
      }),
    } as unknown as IDBDatabase;

    vi.mocked(openDB)
      .mockResolvedValueOnce(findByHashDB) // findByHash (dedup check)
      .mockResolvedValueOnce(emptyListDB) // getTotalSize → listMedia
      .mockResolvedValueOnce(writeSuccessDB); // saveMedia write

    const file = new Blob([new Uint8Array(100)], { type: "image/png" });
    const entry = await saveMedia(file);

    // Dimensions should come from our stub
    expect(entry.width).toBe(20);
    expect(entry.height).toBe(30);
    expect(mockBitmap.close).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
