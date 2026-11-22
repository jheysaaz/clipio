/**
 * IndexedDB error-path tests for src/storage/backends/history.ts.
 *
 * fake-indexeddb cannot naturally fail a getAll or a transaction, so openDB is
 * mocked to return databases whose request/transaction handlers fire onerror.
 * These are the paths that keep a broken local history out of the rest of the
 * app: every error is captured and swallowed by the backend.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/sentry", () => ({
  captureError: vi.fn(),
  captureMessage: vi.fn(),
  initSentry: vi.fn(),
}));

vi.mock("./indexeddb", () => ({
  openDB: vi.fn(),
}));

import { captureError } from "@/lib/sentry";
import { openDB } from "./indexeddb";
import type { HistoryEntry } from "@/lib/history-policy";
import type { Snippet } from "@/types";
import { deleteHistory, listHistory, writeHistory } from "./history";

const failure = (): Error => new Error("indexedDB is unavailable");

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

function entry(): HistoryEntry {
  return {
    id: "h1",
    snippetId: "s1",
    rev: 2,
    reason: "edit",
    snapshot: snippet(),
    createdAt: "2026-01-01T00:00:00.000Z",
    bytes: 100,
  };
}

function listFailureDatabase(): IDBDatabase {
  const error = failure();
  return {
    transaction: () => ({
      objectStore: () => ({
        getAll: () => {
          const request = {
            error,
            onsuccess: null as null | (() => void),
            onerror: null as null | (() => void),
          };
          Promise.resolve().then(() => request.onerror?.());
          return request;
        },
      }),
    }),
  } as unknown as IDBDatabase;
}

function writeFailureDatabase(): IDBDatabase {
  const error = failure();
  return {
    transaction: () => {
      const tx = {
        error,
        oncomplete: null as null | (() => void),
        onerror: null as null | (() => void),
        objectStore: () => ({
          put: vi.fn(),
          delete: vi.fn(),
        }),
      };
      // Fire after history.ts has had a chance to assign tx.onerror.
      Promise.resolve().then(() => tx.onerror?.());
      return tx;
    },
  } as unknown as IDBDatabase;
}

describe("history backend IndexedDB errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty list and reports a failed getAll", async () => {
    vi.mocked(openDB).mockResolvedValue(listFailureDatabase());

    expect(await listHistory()).toEqual([]);
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      action: "history.list",
    });
  });

  it("swallows a failed history write", async () => {
    vi.mocked(openDB).mockResolvedValue(writeFailureDatabase());

    await expect(writeHistory([entry()])).resolves.toBeUndefined();
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      action: "history.write",
    });
  });

  it("swallows a failed history delete", async () => {
    vi.mocked(openDB).mockResolvedValue(writeFailureDatabase());

    await expect(deleteHistory(["h1"])).resolves.toBeUndefined();
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      action: "history.delete",
    });
  });
});
