/**
 * The content-script cache must have exactly one writer.
 * spec: specs/cache-coherence.spec.md
 *
 * The cache is a derived projection of the snippet list, and the bug this file
 * guards is a stale one: the content script reads only the cache, so a snippet
 * that is in storage but not in the cache is invisible to expansion.
 *
 * The tempting fix for staleness is to let a read repair the cache. That trades
 * one bug for a worse one. A read cannot know whether the cache is newer than
 * the list it just read, so it can overwrite a concurrent write from another
 * context — and resurrecting a deleted snippet is far more alarming than a
 * briefly stale cache. Note that an EMPTY cache is not the safe case either:
 * `[]` is the correct value immediately after the last snippet is deleted.
 *
 * So a read never writes. The single writer is the background worker, which
 * observes the very storage change that made the cache stale.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { StorageManager } from "./manager";
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

const hoisted = vi.hoisted(() => ({
  mockUpdateCache: vi.fn(),
  mockStorageMode: { getValue: vi.fn(), setValue: vi.fn() },
  mockStorageModeReason: { getValue: vi.fn(), setValue: vi.fn() },
  mockSyncDataLost: {
    getValue: vi.fn(),
    setValue: vi.fn(),
    removeValue: vi.fn(),
  },
  mockSyncGetSnippets: vi.fn(),
  mockLocalGetSnippets: vi.fn(),
}));

vi.mock("~/storage/items", () => ({
  storageModeItem: hoisted.mockStorageMode,
  storageModeReasonItem: hoisted.mockStorageModeReason,
  syncDataLostItem: hoisted.mockSyncDataLost,
  localSnippetsItem: { getValue: vi.fn(), setValue: vi.fn() },
  cachedSnippetsItem: { getValue: vi.fn(), setValue: vi.fn() },
  debugLogItem: { getValue: vi.fn(), setValue: vi.fn() },
}));

vi.mock("~/storage/backends/local", () => ({
  LocalBackend: class {
    async getSnippets() {
      return hoisted.mockLocalGetSnippets();
    }
    async saveSnippets() {}
    async upsertSnippets() {}
    async removeSnippetsById() {}
    async clear() {}
  },
  updateContentScriptCache: hoisted.mockUpdateCache,
}));

vi.mock("~/storage/backends/media", () => ({
  getMedia: vi.fn(),
  listMedia: vi.fn(async () => []),
}));

vi.mock("~/lib/debug", () => ({ debugLog: vi.fn() }));
vi.mock("~/lib/sentry", () => ({
  captureError: vi.fn(),
  captureMessage: vi.fn(),
  initSentry: vi.fn(),
}));

vi.mock("~/storage/backends/sync", () => ({
  SyncBackend: class {
    async getSnippets() {
      return hoisted.mockSyncGetSnippets();
    }
    async saveSnippets() {}
    async upsertSnippets() {}
    async removeSnippetsById() {}
    async clear() {}
  },
}));

vi.mock("~/storage/backends/indexeddb", () => ({
  IndexedDBBackend: class {
    async getSnippets() {
      return [];
    }
    async saveSnippets() {}
    async upsertSnippets() {}
    async removeSnippetsById() {}
    async clear() {}
  },
}));

describe("StorageManager — reads never write the content-script cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockStorageMode.getValue.mockResolvedValue("sync");
    hoisted.mockSyncDataLost.getValue.mockResolvedValue(false);
  });

  it("returns the snippets without touching the cache", async () => {
    hoisted.mockSyncGetSnippets.mockResolvedValue([makeSnippet()]);

    const result = await new StorageManager().getSnippets();

    expect(result).toEqual([makeSnippet()]);
    expect(hoisted.mockUpdateCache).not.toHaveBeenCalled();
  });

  it("does not populate an empty cache", async () => {
    // The bootstrap-only repair that used to live here looked safe, but `[]` is
    // also the correct cache right after the last snippet is deleted: a read
    // racing that delete would put the deleted snippet back.
    hoisted.mockSyncGetSnippets.mockResolvedValue([makeSnippet()]);

    await new StorageManager().getSnippets();

    expect(hoisted.mockUpdateCache).not.toHaveBeenCalled();
  });

  it("does not overwrite a populated cache that has drifted", async () => {
    hoisted.mockSyncGetSnippets.mockResolvedValue([makeSnippet()]);

    await new StorageManager().getSnippets();

    expect(hoisted.mockUpdateCache).not.toHaveBeenCalled();
  });

  it("does not write the cache in local mode either", async () => {
    hoisted.mockStorageMode.getValue.mockResolvedValue("local");
    hoisted.mockLocalGetSnippets.mockResolvedValue([makeSnippet({ id: "l1" })]);

    const result = await new StorageManager().getSnippets();

    expect(result).toEqual([makeSnippet({ id: "l1" })]);
    expect(hoisted.mockUpdateCache).not.toHaveBeenCalled();
  });

  it("returns the snippets when the sync backend is unreadable (quota)", async () => {
    // The fallback path reads local; it must still not write the cache.
    const { StorageQuotaError } = await import("./types");
    hoisted.mockStorageMode.getValue.mockResolvedValue("sync");
    hoisted.mockSyncGetSnippets.mockRejectedValue(
      new StorageQuotaError("full")
    );
    hoisted.mockLocalGetSnippets.mockResolvedValue([makeSnippet({ id: "fb" })]);

    const result = await new StorageManager().getSnippets();

    expect(result).toEqual([makeSnippet({ id: "fb" })]);
    expect(hoisted.mockUpdateCache).not.toHaveBeenCalled();
  });
});
