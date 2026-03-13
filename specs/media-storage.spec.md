# Module: Media Storage

> Source: `src/storage/backends/media.ts`
> Coverage target: 85%

## Purpose

Provides persistent storage of image blobs (PNG, JPEG, WebP, GIF) in IndexedDB.
Images are stored in the `"media"` object store (DB `"clipio-backup"` v2).
GIFs from Giphy are **not** stored here — only their IDs are stored in the
snippet content as `{{gif:<id>}}` placeholders.

## Scope

**In scope:** saveMedia, getMedia, getMediaBlob, deleteMedia, deleteMediaBatch,
listMedia, getTotalSize, compressMedia.
**Out of scope:** Giphy API, snippet content parsing, UI rendering.

---

## Data Model

### `MediaMetadata`

- MUST have `id: string` (UUID)
- MUST have `mimeType: string` (one of the SUPPORTED_TYPES)
- MUST have `width: number` (pixels)
- MUST have `height: number` (pixels)
- MUST have `size: number` (bytes, after compression)
- MUST have `originalSize: number` (bytes, before compression)
- MUST have `createdAt: string` (ISO 8601)

### `MediaEntry`

- MUST extend `MediaMetadata`
- MUST have `blob: Blob`

---

## `saveMedia(file: File | Blob): Promise<MediaEntry>`

**Behavior:**

- MUST reject files larger than `MEDIA_LIMITS.MAX_FILE_SIZE` (2 MB).
  - MUST call `captureMessage` with tag `action: "media.sizeExceeded"`.
  - MUST throw an `Error` with message `"media.errors.tooLarge"`.
- MUST reject files with MIME types not in `MEDIA_LIMITS.SUPPORTED_TYPES`.
  - MUST call `captureMessage` with tag `action: "media.unsupportedType"`.
  - MUST throw an `Error` with message `"media.errors.unsupportedType"`.
- MUST reject when total stored size + file size would exceed
  `MEDIA_LIMITS.MAX_TOTAL_SIZE` (50 MB).
  - MUST call `captureMessage` with tag `action: "media.storageFull"`.
  - MUST throw an `Error` with message `"media.errors.storageFull"`.
- MUST generate a UUID via `crypto.randomUUID()` for the new entry's `id`.
- MUST read image dimensions using `createImageBitmap(file)`.
  - If `createImageBitmap` is unavailable or throws, dimensions MUST default to
    `{ width: 0, height: 0 }` (non-fatal).
- MUST set `originalSize` to `file.size`.
- MUST set `createdAt` to the current UTC ISO 8601 string.
- MUST store the entry (blob + metadata) in IndexedDB `"media"` store.
- MUST return the full `MediaEntry` on success.
- MUST wrap write failures in try/catch, call `captureError` with tag
  `action: "media.save"`, and rethrow.

---

## `getMedia(id: string): Promise<MediaEntry | null>`

**Behavior:**

- MUST return the full `MediaEntry` (including blob) for a known `id`.
- MUST return `null` for an unknown `id` (not throw).
- MUST call `captureError` with tag `action: "media.get"` on IndexedDB errors,
  then return `null` (never throw).

---

## `getMediaBlob(id: string): Promise<Blob | null>`

**Behavior:**

- MUST return only the `blob` field from the stored entry.
- MUST return `null` when `getMedia` returns `null`.

---

## `deleteMedia(id: string): Promise<void>`

**Behavior:**

- MUST delete the entry with the given `id` from the `"media"` store.
- MUST silently succeed if `id` does not exist.
- MUST call `captureError` with tag `action: "media.delete"` on IndexedDB errors
  (never throw).

---

## `deleteMediaBatch(ids: string[]): Promise<void>`

**Behavior:**

- MUST delete all entries for the given `ids` in a single transaction.
- MUST silently skip IDs that do not exist.
- MUST call `captureError` with tag `action: "media.deleteBatch"` on IndexedDB
  errors (never throw).

---

## `listMedia(): Promise<MediaMetadata[]>`

**Behavior:**

- MUST return metadata for all stored entries (no blobs).
- MUST return an empty array when no entries exist.
- MUST call `captureError` with tag `action: "media.list"` on IndexedDB errors,
  then return `[]` (never throw).

---

## `getTotalSize(): Promise<number>`

**Behavior:**

- MUST return the sum of `size` fields across all stored entries (bytes).
- MUST return `0` when no entries exist.
- MUST call `captureError` with tag `action: "media.totalSize"` on IndexedDB
  errors, then return `0` (never throw).

---

## `compressMedia(id: string): Promise<void>`

**Behavior:**

- MUST retrieve the existing entry by `id`.
- MUST silently return (no-op) if the entry does not exist.
- MUST skip compression if `mimeType === "image/gif"` (GIFs must not be
  re-encoded, as this would lose animation).
- MUST skip compression if `mimeType === "image/webp"` (already optimal).
- MUST use `OffscreenCanvas` to convert PNG/JPEG → WebP at quality 0.85.
  - If `OffscreenCanvas` is unavailable, MUST call `captureError` with tag
    `action: "media.compress"` and return silently.
- MUST only update the stored blob if the WebP size is strictly smaller than
  the current stored size.
- MUST update `mimeType`, `size` in the stored entry when compression saves space.
- MUST call `captureError` with tag `action: "media.compress"` on any failure,
  then return silently (never throw).
