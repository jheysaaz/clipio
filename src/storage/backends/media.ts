/**
 * MediaStore — IndexedDB-backed storage for image blobs.
 *
 * Stores images (PNG, JPEG, WebP, GIF) in the "media" object store of
 * the "clipio-backup" database (v2). GIFs from Giphy are NOT stored here;
 * only their IDs appear in snippet content as {{gif:<id>}} placeholders.
 *
 * All public methods are wrapped in try/catch. Validation failures throw
 * descriptive errors so callers can show user-facing messages. Internal
 * (unexpected) failures are silently captured to Sentry and never throw.
 */

import { IDB_CONFIG, MEDIA_LIMITS } from "@/config/constants";
import { captureError, captureMessage } from "@/lib/sentry";
import { openDB } from "./indexeddb";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MediaMetadata {
  id: string;
  mimeType: string;
  width: number;
  height: number;
  /** Bytes stored (after compression). */
  size: number;
  /** Bytes of the original uploaded file (before compression). */
  originalSize: number;
  createdAt: string;
  /** Optional user-supplied description (used as the image alt text). */
  alt?: string;
  /** SHA-256 hex digest of the stored blob bytes (added in IDB v3). */
  hash?: string;
}

export interface MediaEntry extends MediaMetadata {
  blob: Blob;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readDimensions(
  file: File | Blob
): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return { width: 0, height: 0 };
  }
}

/**
 * Compute the SHA-256 hex digest of a Blob's bytes.
 */
export async function computeHash(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Find the first media entry whose stored `hash` matches the given SHA-256 hex.
 * Returns null if not found or on IDB error.
 */
export async function findByHash(hash: string): Promise<MediaMetadata | null> {
  try {
    const db = await openDB();
    return await new Promise<MediaMetadata | null>((resolve, reject) => {
      const tx = db.transaction(IDB_CONFIG.MEDIA_STORE_NAME, "readonly");
      const store = tx.objectStore(IDB_CONFIG.MEDIA_STORE_NAME);
      // The "hash" index was added in IDB v3; fall back to null if absent.
      if (!store.indexNames.contains("hash")) {
        resolve(null);
        return;
      }
      const req = store.index("hash").get(hash);
      req.onsuccess = () => {
        if (!req.result) {
          resolve(null);
          return;
        }
        const { blob: _blob, ...meta } = req.result as MediaEntry;
        resolve(meta as MediaMetadata);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    captureError(err, { action: "media.findByHash" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate, store, and return a new MediaEntry.
 * Throws on validation failures (size, type, quota). Never throws on IDB errors.
 *
 * Deduplication: if an entry with the same SHA-256 hash already exists, it is
 * returned immediately without consuming quota or writing a new entry.
 */
export async function saveMedia(file: File | Blob): Promise<MediaEntry> {
  const mimeType = file.type;

  // Validate MIME type
  if (
    !MEDIA_LIMITS.SUPPORTED_TYPES.includes(
      mimeType as (typeof MEDIA_LIMITS.SUPPORTED_TYPES)[number]
    )
  ) {
    captureMessage("Unsupported media type uploaded", "warning", {
      action: "media.unsupportedType",
      mimeType,
    });
    throw new Error("media.errors.unsupportedType");
  }

  // Validate file size
  if (file.size > MEDIA_LIMITS.MAX_FILE_SIZE) {
    captureMessage("Media file exceeds size limit", "warning", {
      action: "media.sizeExceeded",
      size: file.size,
    });
    throw new Error("media.errors.tooLarge");
  }

  // Deduplication: compute hash and check for an existing entry.
  const hash = await computeHash(file);
  const existing = await findByHash(hash);
  if (existing) {
    // Silent reuse — fetch full entry (with blob) and return it.
    const full = await getMedia(existing.id);
    if (full) return full;
    // Unlikely: metadata found but blob missing — fall through to save new.
  }

  // Validate total quota (only for new entries)
  const currentTotal = await getTotalSize();
  if (currentTotal + file.size > MEDIA_LIMITS.MAX_TOTAL_SIZE) {
    captureMessage("Media storage full", "warning", {
      action: "media.storageFull",
      currentTotal,
      fileSize: file.size,
    });
    throw new Error("media.errors.storageFull");
  }

  const id = crypto.randomUUID();
  const { width, height } = await readDimensions(file);
  const createdAt = new Date().toISOString();

  const entry: MediaEntry = {
    id,
    mimeType,
    width,
    height,
    size: file.size,
    originalSize: file.size,
    createdAt,
    hash,
    blob: file,
  };

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_CONFIG.MEDIA_STORE_NAME, "readwrite");
      tx.objectStore(IDB_CONFIG.MEDIA_STORE_NAME).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    captureError(err, { action: "media.save" });
    throw err;
  }

  return entry;
}

/**
 * Pure: would accepting a blob of `incomingSize` bytes exceed the total cap?
 *
 * Extracted so the limit is unit-testable without seeding tens of megabytes
 * into fake-indexeddb to reach the threshold.
 * spec: specs/media-import-hardening.spec.md
 */
export function isWithinMediaQuota(
  currentTotal: number,
  incomingSize: number
): boolean {
  return currentTotal + incomingSize <= MEDIA_LIMITS.MAX_TOTAL_SIZE;
}

/**
 * Pure: is this MIME type one the media store accepts?
 *
 * The allow-list is intentionally narrow: no `image/svg+xml` (script-capable
 * in some embedding contexts) and no `text/html`.
 * spec: specs/media-import-hardening.spec.md
 */
export function isSupportedMediaType(
  mimeType: string | undefined | null
): boolean {
  return (
    typeof mimeType === "string" &&
    (MEDIA_LIMITS.SUPPORTED_TYPES as readonly string[]).includes(mimeType)
  );
}

/**
 * Pure: is this blob within the per-file size limit?
 * spec: specs/media-import-hardening.spec.md
 */
export function isWithinFileSizeLimit(size: number): boolean {
  return size <= MEDIA_LIMITS.MAX_FILE_SIZE;
}

/**
 * Restore a media entry from a ZIP import, preserving its original ID.
 *
 * An export is untrusted input — the user may be importing a file someone
 * else authored — so this applies the same limits as `saveMedia`. Validation
 * is deliberately NOT skipped on the grounds that "the data was validated on
 * export": that premise only holds for a file this extension wrote.
 *
 * The stored `size` field is recomputed from the blob rather than trusted,
 * because `getTotalSize()` sums that field and an attacker could otherwise
 * under-report it and grow the store past MAX_TOTAL_SIZE.
 *
 * Deduplication: if an entry with the same hash (any ID) already exists,
 * the restore is skipped to avoid storing duplicate bytes. The dedup check
 * runs first so a re-import neither duplicates bytes nor consumes quota.
 *
 * Throws on validation failure or IDB errors.
 * spec: specs/media-import-hardening.spec.md
 */
export async function restoreMediaEntry(entry: MediaEntry): Promise<void> {
  // Validate MIME type against the same allow-list as saveMedia.
  if (!isSupportedMediaType(entry.blob.type)) {
    captureMessage("Unsupported media type in import", "warning", {
      action: "media.restore.unsupportedType",
      mimeType: entry.blob.type,
    });
    throw new Error("media.errors.unsupportedType");
  }

  // Validate per-file size against the same limit as saveMedia.
  if (!isWithinFileSizeLimit(entry.blob.size)) {
    captureMessage("Imported media exceeds size limit", "warning", {
      action: "media.restore.sizeExceeded",
      size: entry.blob.size,
    });
    throw new Error("media.errors.tooLarge");
  }

  // Compute hash for the incoming blob if not already set.
  const hash = entry.hash ?? (await computeHash(entry.blob));

  // Skip if a same-hash entry already exists (idempotent import). Done before
  // the quota check so a re-import does not consume budget twice.
  const existing = await findByHash(hash);
  if (existing) return;

  // Validate total quota. The blob's real size is used, never entry.size.
  const currentTotal = await getTotalSize();
  if (!isWithinMediaQuota(currentTotal, entry.blob.size)) {
    captureMessage("Media storage full during import", "warning", {
      action: "media.restore.storageFull",
      currentTotal,
      fileSize: entry.blob.size,
    });
    throw new Error("media.errors.storageFull");
  }

  const entryWithHash: MediaEntry = {
    ...entry,
    hash,
    size: entry.blob.size,
  };

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_CONFIG.MEDIA_STORE_NAME, "readwrite");
      tx.objectStore(IDB_CONFIG.MEDIA_STORE_NAME).put(entryWithHash);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    captureError(err, { action: "media.restore" });
    throw err;
  }
}

/**
 * Retrieve a full MediaEntry (blob + metadata) by ID.
 * Returns null if not found or on IDB error.
 */
export async function getMedia(id: string): Promise<MediaEntry | null> {
  try {
    const db = await openDB();
    return await new Promise<MediaEntry | null>((resolve, reject) => {
      const tx = db.transaction(IDB_CONFIG.MEDIA_STORE_NAME, "readonly");
      const req = tx.objectStore(IDB_CONFIG.MEDIA_STORE_NAME).get(id);
      req.onsuccess = () => resolve((req.result as MediaEntry) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    captureError(err, { action: "media.get" });
    return null;
  }
}

/**
 * Convenience: return only the Blob for a given media ID.
 * Returns null if not found.
 */
export async function getMediaBlob(id: string): Promise<Blob | null> {
  const entry = await getMedia(id);
  return entry?.blob ?? null;
}

/**
 * Delete a single media entry by ID. Silent no-op if not found.
 */
export async function deleteMedia(id: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_CONFIG.MEDIA_STORE_NAME, "readwrite");
      tx.objectStore(IDB_CONFIG.MEDIA_STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    captureError(err, { action: "media.delete" });
  }
}

/**
 * Delete multiple media entries in a single transaction.
 */
export async function deleteMediaBatch(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_CONFIG.MEDIA_STORE_NAME, "readwrite");
      const store = tx.objectStore(IDB_CONFIG.MEDIA_STORE_NAME);
      for (const id of ids) {
        store.delete(id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    captureError(err, { action: "media.deleteBatch" });
  }
}

/**
 * Update the `alt` (description) field of an existing media entry.
 * No-op if the entry is not found. Never throws.
 */
export async function updateMediaAlt(id: string, alt: string): Promise<void> {
  try {
    const entry = await getMedia(id);
    if (!entry) return;
    const updated: MediaEntry = { ...entry, alt: alt.trim() || undefined };
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_CONFIG.MEDIA_STORE_NAME, "readwrite");
      tx.objectStore(IDB_CONFIG.MEDIA_STORE_NAME).put(updated);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    captureError(err, { action: "media.updateAlt" });
  }
}

/**
 * List metadata for all stored media entries (no blobs).
 */
export async function listMedia(): Promise<MediaMetadata[]> {
  try {
    const db = await openDB();
    return await new Promise<MediaMetadata[]>((resolve, reject) => {
      const tx = db.transaction(IDB_CONFIG.MEDIA_STORE_NAME, "readonly");
      const req = tx.objectStore(IDB_CONFIG.MEDIA_STORE_NAME).getAll();
      req.onsuccess = () => {
        // Strip blobs from the returned entries
        const entries = (req.result as MediaEntry[]).map(
          ({ blob: _blob, ...meta }) => meta as MediaMetadata
        );
        resolve(entries);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    captureError(err, { action: "media.list" });
    return [];
  }
}

/**
 * Return the total bytes consumed by all stored media.
 */
export async function getTotalSize(): Promise<number> {
  try {
    const entries = await listMedia();
    return entries.reduce((sum, e) => sum + e.size, 0);
  } catch (err) {
    captureError(err, { action: "media.totalSize" });
    return 0;
  }
}

/**
 * Attempt to compress a stored PNG/JPEG to WebP.
 * Updates the stored entry only if the WebP result is smaller.
 * Fire-and-forget — never throws.
 */
export async function compressMedia(id: string): Promise<void> {
  try {
    const entry = await getMedia(id);
    if (!entry) return;

    // Skip types that should not be re-encoded
    if (entry.mimeType === "image/gif" || entry.mimeType === "image/webp") {
      return;
    }

    // OffscreenCanvas is available in service workers and extension pages
    if (typeof OffscreenCanvas === "undefined") {
      captureError(new Error("OffscreenCanvas unavailable"), {
        action: "media.compress",
      });
      return;
    }

    const bitmap = await createImageBitmap(entry.blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const webpBlob = await canvas.convertToBlob({
      type: "image/webp",
      quality: 0.85,
    });

    // Only update if smaller
    if (webpBlob.size < entry.size) {
      const webpHash = await computeHash(webpBlob);
      const db = await openDB();
      const updated: MediaEntry = {
        ...entry,
        blob: webpBlob,
        mimeType: "image/webp",
        size: webpBlob.size,
        hash: webpHash,
      };
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_CONFIG.MEDIA_STORE_NAME, "readwrite");
        tx.objectStore(IDB_CONFIG.MEDIA_STORE_NAME).put(updated);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  } catch (err) {
    captureError(err, { action: "media.compress" });
  }
}
