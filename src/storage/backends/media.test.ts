/**
 * Tests for src/storage/backends/media.ts
 * spec: specs/media-storage.spec.md
 *
 * Uses fake-indexeddb to simulate the IndexedDB environment without a real browser.
 */

import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  saveMedia,
  getMedia,
  getMediaBlob,
  deleteMedia,
  deleteMediaBatch,
  listMedia,
  getTotalSize,
  compressMedia,
} from "./media";
import { MEDIA_LIMITS } from "~/config/constants";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("~/lib/sentry", () => ({
  captureError: vi.fn(),
  captureMessage: vi.fn(),
}));

import { captureError, captureMessage } from "~/lib/sentry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBlob(sizeBytes: number, type = "image/png"): Blob {
  return new Blob([new Uint8Array(sizeBytes)], { type });
}

function makeFile(
  sizeBytes: number,
  type = "image/png",
  name = "test.png"
): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

// Reset the IDB between tests by replacing the global indexedDB instance
beforeEach(async () => {
  // Re-import fake-indexeddb to get a fresh DB instance per test
  const { IDBFactory } = await import("fake-indexeddb");
  (globalThis as unknown as Record<string, unknown>).indexedDB =
    new IDBFactory();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// saveMedia
// ---------------------------------------------------------------------------

describe("saveMedia", () => {
  it("stores a valid image blob and returns a MediaEntry", async () => {
    const file = makeBlob(1024, "image/png");
    const entry = await saveMedia(file);

    expect(entry.id).toBeTruthy();
    expect(entry.mimeType).toBe("image/png");
    expect(entry.size).toBe(1024);
    expect(entry.originalSize).toBe(1024);
    expect(entry.blob).toBe(file);
    expect(entry.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("stores a File object correctly", async () => {
    const file = makeFile(512, "image/jpeg");
    const entry = await saveMedia(file);

    expect(entry.mimeType).toBe("image/jpeg");
    expect(entry.size).toBe(512);
  });

  it("assigns a unique UUID to each saved entry", async () => {
    const a = await saveMedia(makeBlob(100, "image/png"));
    const b = await saveMedia(makeBlob(100, "image/png"));
    expect(a.id).not.toBe(b.id);
  });

  it("throws media.errors.unsupportedType for unsupported MIME", async () => {
    const file = makeBlob(100, "image/svg+xml");
    await expect(saveMedia(file)).rejects.toThrow(
      "media.errors.unsupportedType"
    );
    expect(captureMessage).toHaveBeenCalled();
  });

  it("throws media.errors.tooLarge when file exceeds MAX_FILE_SIZE", async () => {
    const file = makeBlob(MEDIA_LIMITS.MAX_FILE_SIZE + 1, "image/png");
    await expect(saveMedia(file)).rejects.toThrow("media.errors.tooLarge");
    expect(captureMessage).toHaveBeenCalled();
  });

  it("throws media.errors.storageFull when total would exceed MAX_TOTAL_SIZE", async () => {
    // We cannot physically fill 50MB in tests, so we directly verify the guard
    // logic by spying on getTotalSize to simulate a near-full state.
    const { getTotalSize: realGetTotalSize } = await import("./media");

    // Temporarily override the internal check by saving a normal file and then
    // using vi.spyOn on the module to fake a large total.
    // Since getTotalSize is called internally, we test the path by importing
    // the module and verifying the guard throws for a file whose size alone
    // would push things over MAX_TOTAL_SIZE.
    // The simplest reliable test: save a file slightly over the limit relative
    // to a mocked total. We do this by overwriting indexedDB to return a
    // large total from listMedia — but that's complex. Instead, we test the
    // quota math by checking MAX_TOTAL_SIZE limit itself using a file whose
    // size is MAX_TOTAL_SIZE + 1 (which also triggers tooLarge, so we check
    // the order: tooLarge guard fires first for oversized individual files,
    // storageFull fires when total + file > MAX_TOTAL_SIZE with valid file size).

    // Use a realistic scenario: fill up close to the total limit by saving
    // MAX_FILE_SIZE files repeatedly... or spy on the internal call.
    // For test simplicity, we verify via the logic contract: save a file that
    // fits per-file but pushes total over limit by mocking the store.

    // Save 25 files of 2MB each to reach 50MB total (the max)
    // This is impractical in tests. Instead verify the guard is wired correctly
    // by checking that a 2MB file still passes when total is 0, and checking
    // that the error message key is "media.errors.storageFull" (distinct from tooLarge)
    // by directly calling with a file whose size, combined with current total, exceeds the limit.

    // Practical approach: inject a large "initial" file with a fake blob to fill up the total.
    // We do this by saving a fake entry directly into the IDB bypassing saveMedia.
    const { IDBFactory } = await import("fake-indexeddb");
    const fakeDB = new IDBFactory();
    (globalThis as unknown as Record<string, unknown>).indexedDB = fakeDB;

    // Open DB and insert a fake large-sized entry
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = fakeDB.open("clipio-backup", 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("snippets"))
          db.createObjectStore("snippets", { keyPath: "id" });
        if (!db.objectStoreNames.contains("media"))
          db.createObjectStore("media", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    // Insert a fake entry with a large size field (the actual blob can be small)
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("media", "readwrite");
      tx.objectStore("media").put({
        id: "fake-large-entry",
        mimeType: "image/png",
        width: 1,
        height: 1,
        size: MEDIA_LIMITS.MAX_TOTAL_SIZE - 100, // just under total limit
        originalSize: MEDIA_LIMITS.MAX_TOTAL_SIZE - 100,
        createdAt: new Date().toISOString(),
        blob: new Blob([new Uint8Array(1)], { type: "image/png" }),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Now try to save a file that pushes us over the total
    const file = makeBlob(200, "image/png"); // 100 (sentinel) + 200 > 50MB
    await expect(saveMedia(file)).rejects.toThrow("media.errors.storageFull");
    expect(captureMessage).toHaveBeenCalled();
  });

  it("supports all SUPPORTED_TYPES", async () => {
    for (const mimeType of MEDIA_LIMITS.SUPPORTED_TYPES) {
      const file = makeBlob(100, mimeType);
      const entry = await saveMedia(file);
      expect(entry.mimeType).toBe(mimeType);
    }
  });
});

// ---------------------------------------------------------------------------
// getMedia
// ---------------------------------------------------------------------------

describe("getMedia", () => {
  it("returns the full MediaEntry for a saved id", async () => {
    const file = makeBlob(256, "image/webp");
    const saved = await saveMedia(file);
    const fetched = await getMedia(saved.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(saved.id);
    expect(fetched!.blob).toBeDefined();
  });

  it("returns null for an unknown id", async () => {
    const result = await getMedia("non-existent-id");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getMediaBlob
// ---------------------------------------------------------------------------

describe("getMediaBlob", () => {
  it("returns a non-null value for a saved id", async () => {
    const file = makeBlob(128, "image/jpeg");
    const saved = await saveMedia(file);
    const blob = await getMediaBlob(saved.id);

    // fake-indexeddb serializes Blob as a plain object; we just verify
    // the value is non-null and truthy (real IDB would return a proper Blob).
    expect(blob).not.toBeNull();
    expect(blob).toBeTruthy();
  });

  it("returns null for an unknown id", async () => {
    expect(await getMediaBlob("missing")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deleteMedia
// ---------------------------------------------------------------------------

describe("deleteMedia", () => {
  it("removes an existing entry", async () => {
    const saved = await saveMedia(makeBlob(64, "image/png"));
    await deleteMedia(saved.id);
    expect(await getMedia(saved.id)).toBeNull();
  });

  it("silently succeeds for a non-existent id", async () => {
    await expect(deleteMedia("ghost")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// deleteMediaBatch
// ---------------------------------------------------------------------------

describe("deleteMediaBatch", () => {
  it("removes all specified entries in one call", async () => {
    const a = await saveMedia(makeBlob(10, "image/png"));
    const b = await saveMedia(makeBlob(10, "image/jpeg"));
    const c = await saveMedia(makeBlob(10, "image/webp"));

    await deleteMediaBatch([a.id, b.id]);

    expect(await getMedia(a.id)).toBeNull();
    expect(await getMedia(b.id)).toBeNull();
    expect(await getMedia(c.id)).not.toBeNull(); // untouched
  });

  it("handles an empty array without error", async () => {
    await expect(deleteMediaBatch([])).resolves.toBeUndefined();
  });

  it("silently skips IDs that do not exist", async () => {
    const saved = await saveMedia(makeBlob(10, "image/png"));
    await expect(
      deleteMediaBatch([saved.id, "ghost"])
    ).resolves.toBeUndefined();
    expect(await getMedia(saved.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listMedia
// ---------------------------------------------------------------------------

describe("listMedia", () => {
  it("returns an empty array when no entries exist", async () => {
    expect(await listMedia()).toEqual([]);
  });

  it("returns metadata for all saved entries (no blobs)", async () => {
    const a = await saveMedia(makeBlob(10, "image/png"));
    const b = await saveMedia(makeBlob(20, "image/jpeg"));
    const list = await listMedia();

    expect(list).toHaveLength(2);
    const ids = list.map((e) => e.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);

    // No blob on metadata objects
    for (const item of list) {
      expect("blob" in item).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// getTotalSize
// ---------------------------------------------------------------------------

describe("getTotalSize", () => {
  it("returns 0 when no entries exist", async () => {
    expect(await getTotalSize()).toBe(0);
  });

  it("returns the sum of all stored entry sizes", async () => {
    await saveMedia(makeBlob(100, "image/png"));
    await saveMedia(makeBlob(200, "image/jpeg"));
    expect(await getTotalSize()).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// compressMedia
// ---------------------------------------------------------------------------

describe("compressMedia", () => {
  it("silently returns for a non-existent id (no-op)", async () => {
    await expect(compressMedia("missing")).resolves.toBeUndefined();
  });

  it("skips GIF entries without modifying them", async () => {
    const entry = await saveMedia(makeBlob(100, "image/gif"));
    await compressMedia(entry.id);
    const after = await getMedia(entry.id);
    expect(after!.mimeType).toBe("image/gif");
  });

  it("skips WebP entries without modifying them", async () => {
    const entry = await saveMedia(makeBlob(100, "image/webp"));
    await compressMedia(entry.id);
    const after = await getMedia(entry.id);
    expect(after!.mimeType).toBe("image/webp");
  });

  it("handles OffscreenCanvas unavailability gracefully", async () => {
    const entry = await saveMedia(makeBlob(100, "image/png"));

    // Remove OffscreenCanvas to simulate unavailability
    const original = (globalThis as unknown as Record<string, unknown>)
      .OffscreenCanvas;
    delete (globalThis as unknown as Record<string, unknown>).OffscreenCanvas;

    await expect(compressMedia(entry.id)).resolves.toBeUndefined();
    expect(captureError).toHaveBeenCalled();

    // Restore
    (globalThis as unknown as Record<string, unknown>).OffscreenCanvas =
      original;
  });
});
