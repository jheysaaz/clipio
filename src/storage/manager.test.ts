/**
 * Tests for src/storage/manager.ts — StorageManager
 * spec: specs/storage.spec.md#StorageManager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StorageManager } from "./manager";
import { StorageQuotaError } from "./types";
import type { Snippet } from "@/types";

// ---------------------------------------------------------------------------
// Mock all backends and dependencies
// ---------------------------------------------------------------------------

const {
  mockSyncBackend,
  mockLocalBackend,
  mockIdbBackend,
  mockUpdateContentScriptCache,
  mockStorageMode,
  mockSyncDataLost,
  mockStorageModeReason,
} = vi.hoisted(() => ({
  mockSyncBackend: {
    getSnippets: vi.fn(),
    saveSnippets: vi.fn(),
    // Intent-based mutations. The manager uses these for single-snippet CRUD
    // so a concurrent write in another context is not clobbered — see
    // specs/storage-durability.spec.md.
    upsertSnippets: vi.fn(),
    removeSnippetsById: vi.fn(),
    clear: vi.fn(),
  },
  mockLocalBackend: {
    getSnippets: vi.fn(),
    saveSnippets: vi.fn(),
    upsertSnippets: vi.fn(),
    removeSnippetsById: vi.fn(),
    clear: vi.fn(),
  },
  mockIdbBackend: {
    getSnippets: vi.fn(),
    saveSnippets: vi.fn(),
    clear: vi.fn(),
  },
  mockUpdateContentScriptCache: vi.fn(),
  mockStorageMode: {
    getValue: vi.fn().mockResolvedValue("sync"),
    setValue: vi.fn().mockResolvedValue(undefined),
    removeValue: vi.fn(),
    watch: vi.fn(),
  },
  mockSyncDataLost: {
    getValue: vi.fn().mockResolvedValue(false),
    setValue: vi.fn().mockResolvedValue(undefined),
    removeValue: vi.fn(),
    watch: vi.fn(),
  },
  mockStorageModeReason: {
    getValue: vi.fn().mockResolvedValue("quota"),
    setValue: vi.fn().mockResolvedValue(undefined),
    removeValue: vi.fn(),
    watch: vi.fn(),
  },
}));

vi.mock("./backends/sync", () => ({
  SyncBackend: function () {
    return mockSyncBackend;
  },
}));

vi.mock("./backends/local", () => ({
  LocalBackend: function () {
    return mockLocalBackend;
  },
  updateContentScriptCache: (...args: unknown[]) =>
    mockUpdateContentScriptCache(...args),
}));

vi.mock("./backends/indexeddb", () => ({
  IndexedDBBackend: function () {
    return mockIdbBackend;
  },
}));

vi.mock("./items", () => ({
  storageModeItem: mockStorageMode,
  syncDataLostItem: mockSyncDataLost,
  storageModeReasonItem: mockStorageModeReason,
}));

// debugLog is a no-op in tests — it's a separate unit with its own test file
vi.mock("~/lib/debug", () => ({
  debugLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/storage/backends/media", () => ({
  getMedia: vi.fn(async () => null),
  listMedia: vi.fn(async () => []),
}));

vi.mock("~/lib/exporters/clipio", () => ({
  buildClipioExport: vi.fn((snippets: Snippet[]) => ({
    version: 1,
    format: "clipio",
    exportedAt: new Date().toISOString(),
    snippets,
  })),
  buildClipioExportV2: vi.fn((snippets: Snippet[], media: unknown[]) => ({
    version: 2,
    format: "clipio",
    exportedAt: new Date().toISOString(),
    snippets,
    media,
  })),
  buildClipioZip: vi.fn(
    async () => new Blob(["zip"], { type: "application/zip" })
  ),
  snippetsContainMedia: vi.fn(() => false),
  collectReferencedMediaIds: vi.fn(() => []),
}));

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

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

describe("StorageManager", () => {
  let manager: StorageManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageMode.getValue.mockResolvedValue("sync");
    mockStorageModeReason.getValue.mockResolvedValue("quota");
    mockStorageModeReason.setValue.mockResolvedValue(undefined);
    // NOTE: vi.clearAllMocks() clears call history but NOT implementations, so
    // a mockRejectedValue set by one test leaks into the next. Every mock the
    // manager touches must therefore be re-primed here, not only the ones
    // that existed when this suite was written.
    mockSyncBackend.getSnippets.mockResolvedValue([]);
    mockSyncBackend.saveSnippets.mockResolvedValue(undefined);
    mockSyncBackend.upsertSnippets.mockResolvedValue(undefined);
    mockSyncBackend.removeSnippetsById.mockResolvedValue(undefined);
    mockLocalBackend.getSnippets.mockResolvedValue([]);
    mockLocalBackend.saveSnippets.mockResolvedValue(undefined);
    mockLocalBackend.upsertSnippets.mockResolvedValue(undefined);
    mockLocalBackend.removeSnippetsById.mockResolvedValue(undefined);
    mockIdbBackend.saveSnippets.mockResolvedValue(undefined);
    mockIdbBackend.getSnippets.mockResolvedValue([]);
    mockUpdateContentScriptCache.mockResolvedValue(undefined);
    manager = new StorageManager();
  });

  // ── getSnippets ──────────────────────────────────────────────────────────

  describe("getSnippets", () => {
    // spec: reads from SyncBackend when mode is "sync"
    it("reads from SyncBackend in sync mode", async () => {
      const snippets = [makeSnippet()];
      mockSyncBackend.getSnippets.mockResolvedValue(snippets);
      const result = await manager.getSnippets();
      expect(mockSyncBackend.getSnippets).toHaveBeenCalled();
      expect(result).toEqual(snippets);
    });

    // spec: reads from LocalBackend when mode is "local"
    it("reads from LocalBackend in local mode", async () => {
      mockStorageMode.getValue.mockResolvedValue("local");
      const snippets = [makeSnippet()];
      mockLocalBackend.getSnippets.mockResolvedValue(snippets);
      const result = await manager.getSnippets();
      expect(mockLocalBackend.getSnippets).toHaveBeenCalled();
      expect(result).toEqual(snippets);
    });

    // spec: catches StorageQuotaError from SyncBackend and falls back to LocalBackend
    it("falls back to LocalBackend on StorageQuotaError", async () => {
      mockSyncBackend.getSnippets.mockRejectedValue(new StorageQuotaError());
      const fallbackSnippets = [makeSnippet({ id: "fallback" })];
      mockLocalBackend.getSnippets.mockResolvedValue(fallbackSnippets);
      const result = await manager.getSnippets();
      expect(mockLocalBackend.getSnippets).toHaveBeenCalled();
      expect(result).toEqual(fallbackSnippets);
    });

    // spec: re-throws non-quota errors
    it("re-throws non-quota errors from SyncBackend", async () => {
      mockSyncBackend.getSnippets.mockRejectedValue(new Error("Network error"));
      await expect(manager.getSnippets()).rejects.toThrow("Network error");
    });

    // spec: specs/storage.spec.md#StorageManager — fallback is keyed on the
    // StorageQuotaError TYPE, never on message text: a plain Error that merely
    // mentions quota must NOT switch the manager to local mode.
    it("does not fall back for a plain Error with a quota-like message", async () => {
      mockSyncBackend.getSnippets.mockRejectedValue(
        new Error("QUOTA_BYTES quota exceeded")
      );
      await expect(manager.getSnippets()).rejects.toThrow(
        "QUOTA_BYTES quota exceeded"
      );
      expect(mockLocalBackend.getSnippets).not.toHaveBeenCalled();
      expect(mockStorageMode.setValue).not.toHaveBeenCalled();
      expect(mockStorageModeReason.setValue).not.toHaveBeenCalled();
    });
  });

  // ── write-path quota fallback ─────────────────────────────────────────────
  //
  // The read path has a quota fallback; so does the write path, and it is a
  // different shape. A sync WRITE that exceeds the quota must not simply fail:
  // the manager switches to local, replays the same intent there, and rethrows
  // so the caller knows the write did not land in the store it asked for.
  // spec: specs/storage-durability.spec.md

  describe("write-path quota fallback", () => {
    beforeEach(() => {
      mockStorageMode.getValue.mockResolvedValue("sync");
    });

    it("switches to local and replays the save when a sync write hits quota", async () => {
      mockSyncBackend.upsertSnippets.mockRejectedValue(new StorageQuotaError());
      mockLocalBackend.upsertSnippets.mockResolvedValue(undefined);

      await expect(manager.saveSnippet(makeSnippet())).rejects.toThrow(
        StorageQuotaError
      );

      expect(mockStorageMode.setValue).toHaveBeenCalledWith("local");
      expect(mockStorageModeReason.setValue).toHaveBeenCalledWith("quota");
      expect(mockLocalBackend.upsertSnippets).toHaveBeenCalled();
    });

    it("switches to local and replays the removal when a sync write hits quota", async () => {
      mockSyncBackend.removeSnippetsById.mockRejectedValue(
        new StorageQuotaError()
      );
      mockLocalBackend.removeSnippetsById.mockResolvedValue(undefined);

      await expect(manager.deleteSnippet("s1")).rejects.toThrow(
        StorageQuotaError
      );

      expect(mockStorageMode.setValue).toHaveBeenCalledWith("local");
      expect(mockStorageModeReason.setValue).toHaveBeenCalledWith("quota");
      expect(mockLocalBackend.removeSnippetsById).toHaveBeenCalledWith(["s1"]);
    });

    it("does not switch modes for a non-quota write error", async () => {
      // Keyed on the error TYPE, never on message text — the same rule the read
      // path follows. Flipping to local on a transient network error would
      // strand the user's snippets in the wrong store.
      mockSyncBackend.upsertSnippets.mockRejectedValue(
        new Error("QUOTA_BYTES quota exceeded")
      );

      await expect(manager.saveSnippet(makeSnippet())).rejects.toThrow(
        "QUOTA_BYTES quota exceeded"
      );

      expect(mockStorageMode.setValue).not.toHaveBeenCalled();
      expect(mockLocalBackend.upsertSnippets).not.toHaveBeenCalled();
    });

    it("does not switch modes for a non-quota removal error", async () => {
      mockSyncBackend.removeSnippetsById.mockRejectedValue(
        new Error("Network error")
      );

      await expect(manager.deleteSnippet("s1")).rejects.toThrow(
        "Network error"
      );

      expect(mockStorageMode.setValue).not.toHaveBeenCalled();
      expect(mockLocalBackend.removeSnippetsById).not.toHaveBeenCalled();
    });

    it("writes straight to local when the mode is already local", async () => {
      mockStorageMode.getValue.mockResolvedValue("local");

      await manager.saveSnippet(makeSnippet());

      expect(mockLocalBackend.upsertSnippets).toHaveBeenCalled();
      expect(mockSyncBackend.upsertSnippets).not.toHaveBeenCalled();
    });

    it("deletes straight from local when the mode is already local", async () => {
      mockStorageMode.getValue.mockResolvedValue("local");

      await manager.deleteSnippet("s1");

      expect(mockLocalBackend.removeSnippetsById).toHaveBeenCalledWith(["s1"]);
      expect(mockSyncBackend.removeSnippetsById).not.toHaveBeenCalled();
    });
  });

  // ── saveSnippet ───────────────────────────────────────────────────────────

  describe("saveSnippet", () => {
    it("upserts only the new snippet, not the whole list", async () => {
      // Writing the whole list is what clobbered a concurrent write in
      // another context. spec: specs/storage-durability.spec.md
      const newSnippet = makeSnippet({ id: "new" });
      mockSyncBackend.getSnippets.mockResolvedValue([
        makeSnippet({ id: "existing" }),
      ]);
      await manager.saveSnippet(newSnippet);
      expect(mockSyncBackend.upsertSnippets).toHaveBeenCalledWith([newSnippet]);
      expect(mockSyncBackend.saveSnippets).not.toHaveBeenCalled();
    });

    it("leaves a snippet created by another context after our read intact", async () => {
      // The lost-update case. Previously the read list was written back whole,
      // so anything added in between was silently deleted.
      const newSnippet = makeSnippet({ id: "new" });
      // Our read saw only `stale`; another context then added `theirs`.
      mockSyncBackend.getSnippets.mockResolvedValue([
        makeSnippet({ id: "stale" }),
        makeSnippet({ id: "theirs" }),
      ]);
      await manager.saveSnippet(newSnippet);
      // We upserted one key and issued no remove at all.
      expect(mockSyncBackend.upsertSnippets).toHaveBeenCalledWith([newSnippet]);
      expect(mockSyncBackend.removeSnippetsById).not.toHaveBeenCalled();
    });

    // spec: always calls updateContentScriptCache
    it("updates the content script cache after saving", async () => {
      await manager.saveSnippet(makeSnippet());
      expect(mockUpdateContentScriptCache).toHaveBeenCalled();
    });

    // spec: shadow-writes to IndexedDB
    it("shadow-writes to IndexedDB", async () => {
      await manager.saveSnippet(makeSnippet());
      // Allow micro-tasks to flush
      await new Promise((r) => setTimeout(r, 0));
      expect(mockIdbBackend.saveSnippets).toHaveBeenCalled();
    });
  });

  // ── updateSnippet ─────────────────────────────────────────────────────────

  describe("updateSnippet", () => {
    it("upserts only the updated snippet", async () => {
      const updated = makeSnippet({ id: "s1", label: "Updated" });
      mockSyncBackend.getSnippets.mockResolvedValue([
        makeSnippet({ id: "s1", label: "Original" }),
      ]);
      await manager.updateSnippet(updated);
      expect(mockSyncBackend.upsertSnippets).toHaveBeenCalledWith([updated]);
      expect(mockSyncBackend.saveSnippets).not.toHaveBeenCalled();
    });

    it("does not re-write other snippets", async () => {
      // The old implementation re-serialised every snippet on every update,
      // which is also what made a concurrent change to another snippet get
      // reverted by a stale list.
      const updatedS1 = makeSnippet({ id: "s1", label: "One Updated" });
      mockSyncBackend.getSnippets.mockResolvedValue([
        makeSnippet({ id: "s1" }),
        makeSnippet({ id: "s2" }),
      ]);
      await manager.updateSnippet(updatedS1);
      const upserted = mockSyncBackend.upsertSnippets.mock
        .calls[0][0] as Snippet[];
      expect(upserted).toHaveLength(1);
      expect(upserted[0].id).toBe("s1");
      expect(mockSyncBackend.removeSnippetsById).not.toHaveBeenCalled();
    });
  });

  // ── deleteSnippet ─────────────────────────────────────────────────────────

  describe("deleteSnippet", () => {
    it("removes exactly the named id", async () => {
      mockSyncBackend.getSnippets.mockResolvedValue([
        makeSnippet({ id: "s1" }),
        makeSnippet({ id: "s2" }),
      ]);
      await manager.deleteSnippet("s1");
      expect(mockSyncBackend.removeSnippetsById).toHaveBeenCalledWith(["s1"]);
      expect(mockSyncBackend.saveSnippets).not.toHaveBeenCalled();
    });

    it("cannot delete a snippet it never saw", async () => {
      // The exact bug: the old filter-based delete removed everything absent
      // from a stale read, so a snippet added in another context between the
      // read and the write was destroyed. Removing by id cannot do that.
      mockSyncBackend.getSnippets.mockResolvedValue([
        makeSnippet({ id: "s1" }),
      ]);
      await manager.deleteSnippet("s1");
      const removed = mockSyncBackend.removeSnippetsById.mock
        .calls[0][0] as string[];
      expect(removed).toEqual(["s1"]);
    });
  });

  // ── bulkSaveSnippets ──────────────────────────────────────────────────────

  describe("bulkSaveSnippets", () => {
    it("persists the provided array directly", async () => {
      const snippets = [makeSnippet({ id: "a" }), makeSnippet({ id: "b" })];
      await manager.bulkSaveSnippets(snippets);
      expect(mockSyncBackend.saveSnippets).toHaveBeenCalledWith(snippets);
    });
  });

  // ── Quota fallback in write path ──────────────────────────────────────────

  describe("persistSnippets quota handling", () => {
    it("switches to local mode on StorageQuotaError and re-throws", async () => {
      mockSyncBackend.upsertSnippets.mockRejectedValue(new StorageQuotaError());
      await expect(manager.saveSnippet(makeSnippet())).rejects.toThrow(
        StorageQuotaError
      );
      expect(mockStorageMode.setValue).toHaveBeenCalledWith("local");
      expect(mockLocalBackend.upsertSnippets).toHaveBeenCalled();
    });

    it("falls back to a by-id removal when a delete hits the quota", async () => {
      mockSyncBackend.removeSnippetsById.mockRejectedValue(
        new StorageQuotaError()
      );
      await expect(manager.deleteSnippet("s1")).rejects.toThrow(
        StorageQuotaError
      );
      expect(mockLocalBackend.removeSnippetsById).toHaveBeenCalledWith(["s1"]);
    });
  });

  // ── getStorageStatus ──────────────────────────────────────────────────────

  describe("getStorageStatus", () => {
    it("returns mode:sync, quotaExceeded:false in sync mode", async () => {
      mockStorageMode.getValue.mockResolvedValue("sync");
      mockStorageModeReason.getValue.mockResolvedValue("quota");
      const status = await manager.getStorageStatus();
      expect(status).toEqual({
        mode: "sync",
        quotaExceeded: false,
        localReason: "quota",
      });
    });

    it("returns mode:local, quotaExceeded:true when reason is quota", async () => {
      mockStorageMode.getValue.mockResolvedValue("local");
      mockStorageModeReason.getValue.mockResolvedValue("quota");
      const status = await manager.getStorageStatus();
      expect(status).toEqual({
        mode: "local",
        quotaExceeded: true,
        localReason: "quota",
      });
    });

    it("returns mode:local, quotaExceeded:false when reason is manual", async () => {
      mockStorageMode.getValue.mockResolvedValue("local");
      mockStorageModeReason.getValue.mockResolvedValue("manual");
      const status = await manager.getStorageStatus();
      expect(status).toEqual({
        mode: "local",
        quotaExceeded: false,
        localReason: "manual",
      });
    });
  });

  // ── tryRecoverFromBackup ──────────────────────────────────────────────────

  describe("tryRecoverFromBackup", () => {
    it("reads from IndexedDB backend", async () => {
      const backupSnippets = [makeSnippet({ id: "backup" })];
      mockIdbBackend.getSnippets.mockResolvedValue(backupSnippets);
      const result = await manager.tryRecoverFromBackup();
      expect(result).toEqual(backupSnippets);
    });

    it("does not modify any storage (read-only)", async () => {
      mockIdbBackend.getSnippets.mockResolvedValue([]);
      await manager.tryRecoverFromBackup();
      expect(mockSyncBackend.saveSnippets).not.toHaveBeenCalled();
      expect(mockLocalBackend.saveSnippets).not.toHaveBeenCalled();
    });
  });

  // ── clearSyncDataLostFlag ─────────────────────────────────────────────────

  describe("clearSyncDataLostFlag", () => {
    it("calls syncDataLostItem.removeValue", async () => {
      await manager.clearSyncDataLostFlag();
      expect(mockSyncDataLost.removeValue).toHaveBeenCalled();
    });
  });

  // ── IDB shadow-write error handling ──────────────────────────────────────

  describe("IDB shadow-write error handling", () => {
    it("completes the primary write even when the IDB backup fails", async () => {
      // Previously this test had no assertion at all, so it could not fail.
      // Assert that the save still landed: the backup is best-effort and must
      // never take the primary write down with it.
      mockIdbBackend.saveSnippets.mockRejectedValue(new Error("IDB error"));
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const snippet = makeSnippet({ id: "s1" });
        await expect(manager.saveSnippet(snippet)).resolves.toBeUndefined();
        expect(mockSyncBackend.upsertSnippets).toHaveBeenCalledWith([snippet]);
        expect(mockUpdateContentScriptCache).toHaveBeenCalled();
        // Let the fire-and-forget rejection land so it is observed, not raced.
        await new Promise((r) => setTimeout(r, 10));
        expect(consoleSpy).toHaveBeenCalled();
      } finally {
        consoleSpy.mockRestore();
      }
    });

    it("completes the write when debugLog rejects (fire-and-forget catch)", async () => {
      // Exercises the .catch(() => {}) no-op callbacks on debugLog calls
      const { debugLog } = await import("~/lib/debug");
      vi.mocked(debugLog).mockRejectedValue(new Error("debug error"));
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const snippet = makeSnippet({ id: "s1" });
      await manager.saveSnippet(snippet);
      // Assert the write landed, not merely that nothing threw.
      expect(mockSyncBackend.upsertSnippets).toHaveBeenCalledWith([snippet]);
      // Allow fire-and-forget microtasks to flush
      await new Promise((r) => setTimeout(r, 10));
      consoleSpy.mockRestore();
      // Restore debugLog to default resolved for subsequent tests
      vi.mocked(debugLog).mockResolvedValue(undefined);
    });
  });

  // ── fire-and-forget handlers ─────────────────────────────────────────────
  //
  // Every mutation attaches a `.catch()` to a debugLog call and a shadow-write
  // to the IndexedDB backup, so neither a failing debug log nor a failing
  // backup can fail the user's save. These assert the write actually landed,
  // rather than merely that nothing threw.

  describe("fire-and-forget handlers", () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    /** Make debugLog reject, so the `.catch(() => {})` handlers run. */
    async function breakDebugLog() {
      const { debugLog } = await import("~/lib/debug");
      vi.mocked(debugLog).mockRejectedValue(new Error("debug error"));
    }

    afterEach(async () => {
      const { debugLog } = await import("~/lib/debug");
      vi.mocked(debugLog).mockResolvedValue(undefined);
    });

    it("still saves when the IndexedDB backup write fails", async () => {
      mockStorageMode.getValue.mockResolvedValue("sync");
      mockSyncBackend.saveSnippets.mockResolvedValue(undefined);
      mockIdbBackend.saveSnippets.mockRejectedValue(new Error("idb down"));
      const snippets = [makeSnippet({ id: "s1" })];

      await manager.bulkSaveSnippets(snippets);

      expect(mockSyncBackend.saveSnippets).toHaveBeenCalledWith(snippets);
      await new Promise((r) => setTimeout(r, 10));
      expect(consoleSpy).toHaveBeenCalled();
    });

    /**
     * A failing debug log must not affect the mutation.
     *
     * There used to be four more tests here, one per log call site, asserting
     * that a rejected debugLog still let the write through. They were theatre:
     * the write succeeds whether or not the call site has a `.catch`, so all
     * four passed with every handler deleted. The swallowed rejection is not
     * observable from a test either — a floating rejected promise is absorbed
     * by the runner, so an unhandled-rejection listener never fires.
     *
     * The contract now lives where it is actually enforceable: `debugLog`
     * resolves unconditionally (see debug.test.ts), so no call site needs a
     * handler. This test keeps the one case that is genuinely observable — a
     * failing IndexedDB shadow-write, which must be reported rather than
     * silently dropped.
     */
    it("saves even though the debug log rejects", async () => {
      const { debugLog } = await import("~/lib/debug");
      vi.mocked(debugLog).mockRejectedValue(new Error("debug error"));
      mockStorageMode.getValue.mockResolvedValue("sync");
      mockSyncBackend.saveSnippets.mockResolvedValue(undefined);
      mockIdbBackend.saveSnippets.mockResolvedValue(undefined);
      const snippets = [makeSnippet({ id: "s1" })];

      await manager.bulkSaveSnippets(snippets);

      expect(mockSyncBackend.saveSnippets).toHaveBeenCalledWith(snippets);
    });
  });

  // ── saveSnippet in local mode ───────────────────────────────────────────

  describe("saveSnippet in local mode", () => {
    it("writes to LocalBackend when mode is local", async () => {
      mockStorageMode.getValue.mockResolvedValue("local");
      const snippet = makeSnippet();
      mockLocalBackend.getSnippets.mockResolvedValue([]);
      await manager.saveSnippet(snippet);
      expect(mockLocalBackend.upsertSnippets).toHaveBeenCalledWith([snippet]);
      // The sync backend must not be touched at all in local mode.
      expect(mockSyncBackend.upsertSnippets).not.toHaveBeenCalled();
    });
  });

  // ── persistSnippets non-quota error ─────────────────────────────────────

  describe("persistSnippets non-quota error", () => {
    it("re-throws non-quota errors from SyncBackend on save", async () => {
      mockSyncBackend.upsertSnippets.mockRejectedValue(
        new Error("Network error")
      );
      await expect(manager.saveSnippet(makeSnippet())).rejects.toThrow(
        "Network error"
      );
      // A non-quota failure must not silently switch storage mode.
      expect(mockStorageMode.setValue).not.toHaveBeenCalledWith("local");
    });
  });

  // ── exportSnippets ──────────────────────────────────────────────────────

  describe("exportSnippets", () => {
    it("creates a JSON download link and clicks it (no media)", async () => {
      const snippets = [makeSnippet()];
      mockSyncBackend.getSnippets.mockResolvedValue(snippets);

      const mockClick = vi.fn();
      const mockAnchor = { href: "", download: "", click: mockClick };
      vi.spyOn(document, "createElement").mockReturnValue(
        mockAnchor as unknown as HTMLElement
      );
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

      await manager.exportSnippets();

      expect(mockClick).toHaveBeenCalled();
      expect(mockAnchor.download).toMatch(/^clipio-snippets-/);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    });

    it("produces a ZIP download when snippets contain media", async () => {
      const { snippetsContainMedia, collectReferencedMediaIds } =
        await import("~/lib/exporters/clipio");
      const { listMedia, getMedia } = await import("~/storage/backends/media");

      // Make snippetsContainMedia return true for this test
      vi.mocked(snippetsContainMedia).mockReturnValue(true);
      vi.mocked(collectReferencedMediaIds).mockReturnValue(["media-id-1"]);
      vi.mocked(listMedia).mockResolvedValue([
        {
          id: "media-id-1",
          mimeType: "image/png",
          width: 1,
          height: 1,
          size: 10,
          originalSize: 10,
          createdAt: new Date().toISOString(),
        },
      ]);
      vi.mocked(getMedia).mockResolvedValue({
        id: "media-id-1",
        mimeType: "image/png",
        width: 1,
        height: 1,
        size: 10,
        originalSize: 10,
        createdAt: new Date().toISOString(),
        blob: new Blob([new Uint8Array(10)], { type: "image/png" }),
      });

      const snippets = [makeSnippet()];
      mockSyncBackend.getSnippets.mockResolvedValue(snippets);

      const mockClick = vi.fn();
      const mockAnchor = { href: "", download: "", click: mockClick };
      vi.spyOn(document, "createElement").mockReturnValue(
        mockAnchor as unknown as HTMLElement
      );
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:zip-url");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

      await manager.exportSnippets();

      expect(mockClick).toHaveBeenCalled();
      expect(mockAnchor.download).toMatch(/\.clipio\.zip$/);
    });

    it("falls back to JSON export when ZIP build throws", async () => {
      const { snippetsContainMedia, buildClipioZip } =
        await import("~/lib/exporters/clipio");

      vi.mocked(snippetsContainMedia).mockReturnValue(true);
      vi.mocked(buildClipioZip).mockRejectedValue(new Error("ZIP failed"));

      const snippets = [makeSnippet()];
      mockSyncBackend.getSnippets.mockResolvedValue(snippets);

      const mockClick = vi.fn();
      const mockAnchor = { href: "", download: "", click: mockClick };
      vi.spyOn(document, "createElement").mockReturnValue(
        mockAnchor as unknown as HTMLElement
      );
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fallback-url");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

      await manager.exportSnippets();

      // Should still click (fallback JSON export)
      expect(mockClick).toHaveBeenCalled();
      expect(mockAnchor.download).toMatch(/^clipio-snippets-.*\.json$/);
    });
  });

  // ── importSnippets ──────────────────────────────────────────────────────

  describe("importSnippets", () => {
    const makeFile = (content: string): File => {
      return new File([content], "test.json", { type: "application/json" });
    };

    it("imports valid snippets from a JSON file", async () => {
      const imported = [makeSnippet({ id: "imported-1" })];
      const file = makeFile(JSON.stringify(imported));
      mockSyncBackend.getSnippets.mockResolvedValue([]);
      const result = await manager.importSnippets(file);
      expect(result.imported).toBe(1);
    });

    it("skips snippets with duplicate IDs", async () => {
      const existing = makeSnippet({ id: "s1" });
      const imported = [makeSnippet({ id: "s1" }), makeSnippet({ id: "s2" })];
      const file = makeFile(JSON.stringify(imported));
      mockSyncBackend.getSnippets.mockResolvedValue([existing]);
      const result = await manager.importSnippets(file);
      expect(result.imported).toBe(1);
    });

    it("throws for invalid JSON", async () => {
      const file = makeFile("not valid json{{{");
      await expect(manager.importSnippets(file)).rejects.toThrow(
        "Invalid JSON file."
      );
    });

    it("throws when file is not a JSON array", async () => {
      const file = makeFile(JSON.stringify({ not: "array" }));
      await expect(manager.importSnippets(file)).rejects.toThrow(
        "File must contain a JSON array of snippets."
      );
    });

    it("throws when no valid snippets found", async () => {
      const file = makeFile(JSON.stringify([{ invalid: true }]));
      await expect(manager.importSnippets(file)).rejects.toThrow(
        "No valid snippets found in the file."
      );
    });
  });

  // ── forceSetMode ─────────────────────────────────────────────────────────

  describe("forceSetMode", () => {
    // spec: no-op when already on the requested mode
    it("is a no-op when already on the target mode", async () => {
      mockStorageMode.getValue.mockResolvedValue("sync");
      await manager.forceSetMode("sync");
      expect(mockSyncBackend.getSnippets).not.toHaveBeenCalled();
      expect(mockLocalBackend.saveSnippets).not.toHaveBeenCalled();
      expect(mockStorageMode.setValue).not.toHaveBeenCalled();
    });

    // spec: migrates snippets from sync → local, sets mode flag, updates cache
    it("migrates snippets from sync to local and switches mode", async () => {
      const snippets = [makeSnippet({ id: "s1" }), makeSnippet({ id: "s2" })];
      mockStorageMode.getValue.mockResolvedValue("sync");
      mockSyncBackend.getSnippets.mockResolvedValue(snippets);

      await manager.forceSetMode("local");

      expect(mockSyncBackend.getSnippets).toHaveBeenCalled();
      expect(mockLocalBackend.saveSnippets).toHaveBeenCalledWith(snippets);
      expect(mockStorageMode.setValue).toHaveBeenCalledWith("local");
      expect(mockUpdateContentScriptCache).toHaveBeenCalledWith(snippets);
    });

    // spec: migrates snippets from local → sync, sets mode flag, updates cache
    it("migrates snippets from local to sync and switches mode", async () => {
      const snippets = [makeSnippet({ id: "s3" })];
      mockStorageMode.getValue.mockResolvedValue("local");
      mockLocalBackend.getSnippets.mockResolvedValue(snippets);

      await manager.forceSetMode("sync");

      expect(mockLocalBackend.getSnippets).toHaveBeenCalled();
      expect(mockSyncBackend.saveSnippets).toHaveBeenCalledWith(snippets);
      expect(mockStorageMode.setValue).toHaveBeenCalledWith("sync");
      expect(mockUpdateContentScriptCache).toHaveBeenCalledWith(snippets);
    });

    // spec: shadows the migrated data to IDB backup (fire-and-forget)
    it("writes migrated snippets to IDB backup after switch", async () => {
      const snippets = [makeSnippet()];
      mockStorageMode.getValue.mockResolvedValue("sync");
      mockSyncBackend.getSnippets.mockResolvedValue(snippets);

      await manager.forceSetMode("local");

      // IDB write is fire-and-forget — give microtasks a tick to settle
      await Promise.resolve();
      expect(mockIdbBackend.saveSnippets).toHaveBeenCalledWith(snippets);
    });

    // spec: IDB backup failure is swallowed and does not propagate
    it("does not throw when IDB backup write fails after mode switch", async () => {
      const snippets = [makeSnippet()];
      mockStorageMode.getValue.mockResolvedValue("sync");
      mockSyncBackend.getSnippets.mockResolvedValue(snippets);
      mockIdbBackend.saveSnippets.mockRejectedValue(new Error("IDB error"));

      // forceSetMode should complete without throwing
      await expect(manager.forceSetMode("local")).resolves.not.toThrow();
      // Flush microtasks so the .catch() callback runs
      await Promise.resolve();
    });
  });

  // ── clearIDBBackup ────────────────────────────────────────────────────────

  describe("clearIDBBackup", () => {
    // spec: delegates to IndexedDBBackend.clear()
    it("calls idb.clear()", async () => {
      mockIdbBackend.clear.mockResolvedValue(undefined);
      await manager.clearIDBBackup();
      expect(mockIdbBackend.clear).toHaveBeenCalled();
    });
  });
});
