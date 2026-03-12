/**
 * Tests for src/storage/backends/sync.ts — SyncBackend
 * spec: specs/storage.spec.md#SyncBackend
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SyncBackend } from "./sync";
import { StorageQuotaError } from "../types";
import {
  resetBrowserMocks,
  seedSyncStore,
  simulateSyncQuotaError,
  mockStorageSync,
} from "../../../tests/mocks/browser";
import type { Snippet } from "~/types";

const makeSnippet = (overrides: Partial<Snippet> = {}): Snippet => ({
  id: "test-id",
  label: "Test",
  shortcut: "ts",
  content: "content",
  tags: [],
  usageCount: 0,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  ...overrides,
});

describe("SyncBackend", () => {
  let backend: SyncBackend;

  beforeEach(() => {
    resetBrowserMocks();
    backend = new SyncBackend();
  });

  // ── getSnippets ──────────────────────────────────────────────────────────

  describe("getSnippets", () => {
    // spec: returns empty array when no snip: keys exist
    it("returns empty array when storage is empty", async () => {
      const snippets = await backend.getSnippets();
      expect(snippets).toEqual([]);
    });

    // spec: reads all snip: keys
    it("reads snippets stored under snip: prefix", async () => {
      const snippet = makeSnippet({ id: "abc123" });
      seedSyncStore({ "snip:abc123": snippet });
      const snippets = await backend.getSnippets();
      expect(snippets).toHaveLength(1);
      expect(snippets[0].id).toBe("abc123");
    });

    it("reads multiple snippets", async () => {
      seedSyncStore({
        "snip:a": makeSnippet({ id: "a" }),
        "snip:b": makeSnippet({ id: "b" }),
        "other-key": "ignored",
      });
      const snippets = await backend.getSnippets();
      expect(snippets).toHaveLength(2);
    });

    // spec: ignores non-snip: keys
    it("ignores non-snip: keys", async () => {
      seedSyncStore({ storageMode: "sync", "not-a-snippet": {} });
      const snippets = await backend.getSnippets();
      expect(snippets).toEqual([]);
    });

    // spec: migrates legacy "snippets" key to per-key layout
    it("migrates legacy snippets key", async () => {
      const snippet = makeSnippet({ id: "migrated" });
      seedSyncStore({ snippets: [snippet] });
      const snippets = await backend.getSnippets();
      expect(snippets).toHaveLength(1);
      expect(snippets[0].id).toBe("migrated");
      // Legacy key should have been removed
      expect(mockStorageSync.remove).toHaveBeenCalledWith("snippets");
    });

    // spec: handles JSON string values
    it("parses JSON string values", async () => {
      const snippet = makeSnippet({ id: "json-id" });
      seedSyncStore({ "snip:json-id": JSON.stringify(snippet) });
      const snippets = await backend.getSnippets();
      expect(snippets[0].id).toBe("json-id");
    });
  });

  // ── saveSnippets ──────────────────────────────────────────────────────────

  describe("saveSnippets", () => {
    // spec: saves snippets under snip: keys
    it("stores each snippet under snip:<id> key", async () => {
      const snippet = makeSnippet({ id: "s1" });
      await backend.saveSnippets([snippet]);
      expect(mockStorageSync.set).toHaveBeenCalledWith(
        expect.objectContaining({ "snip:s1": snippet })
      );
    });

    // spec: removes stale snip: keys not in the new list
    it("removes keys not in the new snippets list", async () => {
      seedSyncStore({ "snip:old": makeSnippet({ id: "old" }) });
      const newSnippet = makeSnippet({ id: "new" });
      await backend.saveSnippets([newSnippet]);
      expect(mockStorageSync.remove).toHaveBeenCalledWith(
        expect.arrayContaining(["snip:old"])
      );
    });

    // spec: skips writing snippets with identical stored values
    it("skips write for already-identical snippets", async () => {
      const snippet = makeSnippet({ id: "same" });
      seedSyncStore({ "snip:same": snippet });
      await backend.saveSnippets([snippet]);
      // set should NOT be called for identical data
      expect(mockStorageSync.set).not.toHaveBeenCalled();
    });

    // spec: throws StorageQuotaError on quota errors
    it("throws StorageQuotaError when quota is exceeded", async () => {
      simulateSyncQuotaError();
      const snippet = makeSnippet();
      await expect(backend.saveSnippets([snippet])).rejects.toThrow(
        StorageQuotaError
      );
    });

    it("throws StorageQuotaError for MAX_ITEMS error", async () => {
      mockStorageSync.set.mockRejectedValueOnce(
        new Error("MAX_ITEMS exceeded")
      );
      await expect(backend.saveSnippets([makeSnippet()])).rejects.toThrow(
        StorageQuotaError
      );
    });

    // spec: re-throws non-quota errors
    it("re-throws non-quota errors", async () => {
      const networkError = new Error("Network failure");
      mockStorageSync.set.mockRejectedValueOnce(networkError);
      await expect(backend.saveSnippets([makeSnippet()])).rejects.toThrow(
        "Network failure"
      );
    });

    // Empty array
    it("removes all snip: keys when saving empty array", async () => {
      seedSyncStore({ "snip:old": makeSnippet({ id: "old" }) });
      await backend.saveSnippets([]);
      expect(mockStorageSync.remove).toHaveBeenCalled();
    });
  });

  // ── clear ────────────────────────────────────────────────────────────────

  describe("clear", () => {
    it("removes all snip: keys", async () => {
      seedSyncStore({
        "snip:a": makeSnippet({ id: "a" }),
        "snip:b": makeSnippet({ id: "b" }),
        other: "keep",
      });
      await backend.clear();
      expect(mockStorageSync.remove).toHaveBeenCalledWith(
        expect.arrayContaining(["snip:a", "snip:b"])
      );
    });

    it("does not throw when storage is empty", async () => {
      await expect(backend.clear()).resolves.not.toThrow();
    });
  });
});
