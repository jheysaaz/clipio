/**
 * Inner request/transaction error callbacks of IndexedDBBackend.
 *
 * The sibling tests break `indexedDB.open` (which takes the outer catch) or
 * abort a write with fake-indexeddb (which cannot fire request.onerror on a
 * readonly transaction). Here the real `openDB` and the real backend are used;
 * only the `indexedDB` factory is synthetic, so the `onsuccess` handler,
 * `request.onerror` and `tx.onerror` callbacks all run as shipped.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/sentry", () => ({
  captureError: vi.fn(),
  captureMessage: vi.fn(),
  initSentry: vi.fn(),
}));

import { IDB_CONFIG } from "@/config/constants";
import { captureError } from "@/lib/sentry";
import { IndexedDBBackend, openDB } from "./indexeddb";
import type { Snippet } from "@/types";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
 * A readonly request that fails with the given error on the next microtask.
 *
 * The failure is scheduled from the setter, not from construction: the backend
 * attaches `onerror` only after `openDB` resolves, so a timer started here
 * would fire against a null handler and the test would hang.
 */
function makeFailingRequest(error: Error, result: unknown) {
  let onerror: (() => void) | null = null;
  let onsuccess: (() => void) | null = null;
  let scheduled = false;
  const fired = { onerror: false, onsuccess: false };
  const request = {
    result,
    error,
    get onerror() {
      return onerror;
    },
    set onerror(handler: (() => void) | null) {
      onerror = handler;
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        fired.onerror = true;
        onerror?.();
      });
    },
    get onsuccess() {
      return onsuccess;
    },
    set onsuccess(handler: (() => void) | null) {
      onsuccess = handler;
    },
  };
  return { request, fired };
}

/**
 * Install an `indexedDB` factory that hands `openDB` a synthetic connection.
 *
 * The media read kicked off by `openDB` succeeds with an empty store so it
 * cannot be mistaken for the failure under test. Each call to `transaction`
 * for the snippets store returns the same synthetic transaction, whose
 * `onerror`/`oncomplete` fires after the backend has attached its handlers.
 */
function installDb(
  store: Record<string, unknown>,
  txError?: Error
): { fired: { onerror: boolean; oncomplete: boolean }; opened: () => number } {
  let oncomplete: (() => void) | null = null;
  let onerror: (() => void) | null = null;
  let scheduled = false;
  const fired = { onerror: false, oncomplete: false };
  // Fire only once the backend has attached a handler; scheduling at
  // construction would fire into a null callback before `openDB` resolves.
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      if (txError) {
        fired.onerror = true;
        onerror?.();
      } else {
        fired.oncomplete = true;
        oncomplete?.();
      }
    });
  };
  const snippetsTx = {
    objectStore: vi.fn(() => store),
    error: txError,
    get oncomplete() {
      return oncomplete;
    },
    set oncomplete(handler: (() => void) | null) {
      oncomplete = handler;
      schedule();
    },
    get onerror() {
      return onerror;
    },
    set onerror(handler: (() => void) | null) {
      onerror = handler;
      schedule();
    },
  };

  let mediaOnsuccess: (() => void) | null = null;
  const mediaRequest = {
    get onsuccess() {
      return mediaOnsuccess;
    },
    set onsuccess(handler: (() => void) | null) {
      mediaOnsuccess = handler;
      queueMicrotask(() => handler?.());
    },
    onerror: null as (() => void) | null,
    result: [] as unknown[],
    error: null,
  };

  const open = vi.fn(() => {
    let onsuccess: (() => void) | null = null;
    const request = {
      result: {
        transaction: vi.fn((name: string) => {
          if (name === IDB_CONFIG.MEDIA_STORE_NAME) {
            return {
              objectStore: vi.fn(() => ({
                getAll: vi.fn(() => mediaRequest),
              })),
            };
          }
          return snippetsTx;
        }),
      } as unknown as IDBDatabase,
      onupgradeneeded: null as (() => void) | null,
      get onsuccess() {
        return onsuccess;
      },
      set onsuccess(handler: (() => void) | null) {
        onsuccess = handler;
        queueMicrotask(() => handler?.());
      },
      onerror: null as (() => void) | null,
      error: null,
    };
    return request;
  });
  vi.stubGlobal("indexedDB", { open });

  return { fired, opened: () => open.mock.calls.length };
}

describe("IndexedDBBackend — request.onerror", () => {
  it("getSnippets returns [] and reports the read error", async () => {
    const error = new Error("getAll failed");
    const { request, fired } = makeFailingRequest(error, [makeSnippet()]);
    installDb({ getAll: vi.fn(() => request) });

    await expect(new IndexedDBBackend().getSnippets()).resolves.toEqual([]);

    // The failure came from the request callback, not from openDB failing.
    expect(fired.onerror).toBe(true);
    expect(captureError).toHaveBeenCalledWith(error, {
      action: "idb.getSnippets",
    });
  });

  it("getSnippetCount returns 0 and reports the count error", async () => {
    const error = new Error("count failed");
    const { request, fired } = makeFailingRequest(error, 1);
    installDb({ count: vi.fn(() => request) });

    await expect(new IndexedDBBackend().getSnippetCount()).resolves.toBe(0);

    expect(fired.onerror).toBe(true);
    expect(captureError).toHaveBeenCalledWith(error, {
      action: "idb.getSnippetCount",
    });
  });
});

describe("IndexedDBBackend — tx.onerror", () => {
  it("saveSnippets swallows a failed clear-and-rewrite transaction", async () => {
    const error = new Error("write failed");
    const clear = vi.fn();
    const put = vi.fn();
    const { fired } = installDb({ clear, put }, error);
    const snippet = makeSnippet();

    await expect(
      new IndexedDBBackend().saveSnippets([snippet])
    ).resolves.toBeUndefined();

    expect(fired.onerror).toBe(true);
    expect(clear).toHaveBeenCalled();
    expect(put).toHaveBeenCalledWith(snippet);
    expect(captureError).toHaveBeenCalledWith(error, {
      action: "idb.saveSnippets",
    });
  });

  it("upsertSnippets rethrows a failed write transaction", async () => {
    const error = new Error("upsert failed");
    const put = vi.fn();
    const { fired } = installDb({ put }, error);
    const snippet = makeSnippet();

    await expect(new IndexedDBBackend().upsertSnippets([snippet])).rejects.toBe(
      error
    );

    // A swallowed failure here would tell the caller the write succeeded.
    expect(fired.onerror).toBe(true);
    expect(put).toHaveBeenCalledWith(snippet);
    expect(captureError).toHaveBeenCalledWith(error, {
      action: "idb.upsertSnippets",
    });
  });

  it("removeSnippetsById rethrows a failed delete transaction", async () => {
    const error = new Error("delete failed");
    const del = vi.fn();
    const { fired } = installDb({ delete: del }, error);

    await expect(
      new IndexedDBBackend().removeSnippetsById(["s1"])
    ).rejects.toBe(error);

    // A swallowed failure reports a deletion that never happened.
    expect(fired.onerror).toBe(true);
    expect(del).toHaveBeenCalledWith("s1");
    expect(captureError).toHaveBeenCalledWith(error, {
      action: "idb.removeSnippetsById",
    });
  });

  it("clear swallows a failed clear transaction", async () => {
    const error = new Error("clear failed");
    const clear = vi.fn();
    const { fired } = installDb({ clear }, error);

    await expect(new IndexedDBBackend().clear()).resolves.toBeUndefined();

    expect(fired.onerror).toBe(true);
    expect(clear).toHaveBeenCalled();
    expect(captureError).toHaveBeenCalledWith(error, {
      action: "idb.clear",
    });
  });

  it("does not report an error when the transaction completes", async () => {
    // Guards against a fake that reports failure indiscriminately: a clean
    // transaction must not produce a Sentry event.
    const clear = vi.fn();
    const { fired } = installDb({ clear });

    await expect(new IndexedDBBackend().clear()).resolves.toBeUndefined();

    expect(fired.oncomplete).toBe(true);
    expect(fired.onerror).toBe(false);
    expect(captureError).not.toHaveBeenCalled();
  });
});

describe("IndexedDBBackend — openDB error callback", () => {
  it("rejects with the request error when opening fails", async () => {
    // The read/save methods swallow this; openDB itself must not.
    const error = new Error("open failed");
    vi.stubGlobal("indexedDB", {
      open: vi.fn(() => {
        const request = {
          error,
          onupgradeneeded: null as (() => void) | null,
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
        };
        queueMicrotask(() => request.onerror?.());
        return request;
      }),
    });

    await expect(openDB()).rejects.toBe(error);
    expect(captureError).not.toHaveBeenCalled();
  });
});
