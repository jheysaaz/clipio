/**
 * Tests for src/storage/manager.ts — StorageManager
 * spec: specs/storage.spec.md#StorageManager
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { StorageManager } from "./manager";
import { StorageQuotaError } from "./types";
import type { Snippet } from "~/types";

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
} = vi.hoisted(() => ({
  mockSyncBackend: {
    getSnippets: vi.fn(),
    saveSnippets: vi.fn(),
    clear: vi.fn(),
  },
  mockLocalBackend: {
    getSnippets: vi.fn(),
    saveSnippets: vi.fn(),
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
  extractMediaIds: vi.fn(() => []),
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
    mockSyncBackend.getSnippets.mockResolvedValue([]);
    mockSyncBackend.saveSnippets.mockResolvedValue(undefined);
    mockLocalBackend.getSnippets.mockResolvedValue([]);
    mockLocalBackend.saveSnippets.mockResolvedValue(undefined);
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
  });

  // ── saveSnippet ───────────────────────────────────────────────────────────

  describe("saveSnippet", () => {
    it("appends a new snippet to the existing list", async () => {
      const existing = makeSnippet({ id: "existing" });
      const newSnippet = makeSnippet({ id: "new" });
      mockSyncBackend.getSnippets.mockResolvedValue([existing]);
      await manager.saveSnippet(newSnippet);
      expect(mockSyncBackend.saveSnippets).toHaveBeenCalledWith(
        expect.arrayContaining([existing, newSnippet])
      );
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
    it("replaces the snippet with the matching id", async () => {
      const original = makeSnippet({ id: "s1", label: "Original" });
      const updated = makeSnippet({ id: "s1", label: "Updated" });
      mockSyncBackend.getSnippets.mockResolvedValue([original]);
      await manager.updateSnippet(updated);
      expect(mockSyncBackend.saveSnippets).toHaveBeenCalledWith([updated]);
    });

    it("does not affect other snippets when updating one", async () => {
      const s1 = makeSnippet({ id: "s1", label: "One" });
      const s2 = makeSnippet({ id: "s2", label: "Two" });
      const updatedS1 = makeSnippet({ id: "s1", label: "One Updated" });
      mockSyncBackend.getSnippets.mockResolvedValue([s1, s2]);
      await manager.updateSnippet(updatedS1);
      const saved = mockSyncBackend.saveSnippets.mock.calls[0][0] as Snippet[];
      expect(saved).toHaveLength(2);
      expect(saved.find((s) => s.id === "s2")).toEqual(s2);
    });
  });

  // ── deleteSnippet ─────────────────────────────────────────────────────────

  describe("deleteSnippet", () => {
    it("removes the snippet with the given id", async () => {
      const s1 = makeSnippet({ id: "s1" });
      const s2 = makeSnippet({ id: "s2" });
      mockSyncBackend.getSnippets.mockResolvedValue([s1, s2]);
      await manager.deleteSnippet("s1");
      const saved = mockSyncBackend.saveSnippets.mock.calls[0][0] as Snippet[];
      expect(saved).toHaveLength(1);
      expect(saved[0].id).toBe("s2");
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
      mockSyncBackend.saveSnippets.mockRejectedValue(new StorageQuotaError());
      await expect(manager.saveSnippet(makeSnippet())).rejects.toThrow(
        StorageQuotaError
      );
      expect(mockStorageMode.setValue).toHaveBeenCalledWith("local");
      expect(mockLocalBackend.saveSnippets).toHaveBeenCalled();
    });
  });

  // ── getStorageStatus ──────────────────────────────────────────────────────

  describe("getStorageStatus", () => {
    it("returns mode:sync, quotaExceeded:false in sync mode", async () => {
      mockStorageMode.getValue.mockResolvedValue("sync");
      const status = await manager.getStorageStatus();
      expect(status).toEqual({ mode: "sync", quotaExceeded: false });
    });

    it("returns mode:local, quotaExceeded:true in local mode", async () => {
      mockStorageMode.getValue.mockResolvedValue("local");
      const status = await manager.getStorageStatus();
      expect(status).toEqual({ mode: "local", quotaExceeded: true });
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
    it("does not throw when IDB backup write fails", async () => {
      mockIdbBackend.saveSnippets.mockRejectedValue(new Error("IDB error"));
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await manager.saveSnippet(makeSnippet());
      // Allow fire-and-forget to flush
      await new Promise((r) => setTimeout(r, 10));
      consoleSpy.mockRestore();
    });
  });

  // ── saveSnippet in local mode ───────────────────────────────────────────

  describe("saveSnippet in local mode", () => {
    it("writes to LocalBackend when mode is local", async () => {
      mockStorageMode.getValue.mockResolvedValue("local");
      const snippet = makeSnippet();
      mockLocalBackend.getSnippets.mockResolvedValue([]);
      await manager.saveSnippet(snippet);
      expect(mockLocalBackend.saveSnippets).toHaveBeenCalledWith([snippet]);
    });
  });

  // ── persistSnippets non-quota error ─────────────────────────────────────

  describe("persistSnippets non-quota error", () => {
    it("re-throws non-quota errors from SyncBackend on save", async () => {
      mockSyncBackend.saveSnippets.mockRejectedValue(
        new Error("Network error")
      );
      await expect(manager.saveSnippet(makeSnippet())).rejects.toThrow(
        "Network error"
      );
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
      const { snippetsContainMedia, extractMediaIds } =
        await import("~/lib/exporters/clipio");
      const { listMedia, getMedia } = await import("~/storage/backends/media");

      // Make snippetsContainMedia return true for this test
      vi.mocked(snippetsContainMedia).mockReturnValue(true);
      vi.mocked(extractMediaIds).mockReturnValue(["media-id-1"]);
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
});
