# Module: Media Storage

> Source: `src/storage/backends/media.ts`
> Coverage target: 85%

## Purpose

Stores image/media blobs in IndexedDB for snippets, keyed by content hash so
the same image pasted twice occupies one record.

## Scope

**In scope:** Media blob storage, retrieval, deletion, quota and type guards.
**Out of scope:** Image processing, snippet content.

---

## What this module actually contains

> **Corrected.** This spec previously documented a `MediaBackend` interface with
> `saveMedia(id, blob)`, `getMedia(id): Promise<Blob | null>`,
> `deleteMedia(id)` and `clear()`. The signatures were wrong and two members do
> not exist:
>
> - `saveMedia` takes a `File | Blob` and returns the stored `MediaEntry`. It
>   computes the hash itself and deduplicates; it does not take a caller-supplied id.
> - `getMedia` returns a `MediaEntry` (metadata), not a `Blob`. The blob is
>   `getMediaBlob`.
> - `clear()` does not exist.
>
> The spec also omitted most of the real surface. Found by the drift gate in
> `specs/coverage-honesty.spec.md`.

---

## `saveMedia(file: File | Blob): Promise<MediaEntry>`

Stores a blob and returns its entry, including the computed `id`.

**Behavior:**

- Computes a content hash (`computeHash`) and uses it as the id, so re-pasting an
  identical image returns the existing entry instead of writing a second one.
- Returns `{ id, hash, size, type, createdAt, alt? }`.
- Throws if the blob exceeds the file-size limit or its type is unsupported —
  the guards are exported (`isSupportedMediaType`, `isWithinFileSizeLimit`) so
  callers can check before calling.

## `findByHash(hash: string): Promise<MediaMetadata | null>`

The deduplication lookup. Returns metadata only, not the blob.

## `getMedia(id: string): Promise<MediaEntry | null>`

Returns the entry (metadata plus storage identifiers), or `null` when absent.

## `getMediaBlob(id: string): Promise<Blob | null>`

Returns the stored blob. Separate from `getMedia` so that listing or rendering
thumbnails does not pull every blob into memory.

## `deleteMedia(id: string): Promise<void>`

Deletes one entry.

## `deleteMediaBatch(ids: string[]): Promise<void>`

Deletes several entries in one transaction. Used when a snippet is deleted along
with every media placeholder it referenced.

## `restoreMediaEntry(entry: MediaEntry): Promise<void>`

Re-inserts a previously exported entry. Used by import so a shared snippet
archive restores its media rather than dropping placeholders.

## `updateMediaAlt(id: string, alt: string): Promise<void>`

Sets the alt text, which is why `alt` is optional on the entry: entries written
before alt text existed have none.

## `listMedia(): Promise<MediaMetadata[]>`

All entries as metadata, for the diagnostics panel.

## `getTotalSize(): Promise<number>`

Total bytes across all media, for the quota display.

## `compressMedia(id: string): Promise<void>`

Rewrites a stored blob in a more compact form, reclaiming space.

## Guards

- `isSupportedMediaType(type)` — whether a MIME type may be stored at all.
- `isWithinFileSizeLimit(size)` — whether a blob is small enough.
- `isWithinMediaQuota(...)` — whether storing it would breach the media quota.

These are exported so the UI can disable a control or show a message _before_
attempting a write, rather than surfacing a failure afterwards.

---

## Error Handling

- `saveMedia` throws on an unsupported type or an oversized blob; the guards
  above let callers pre-check.
- A missing id resolves to `null` from the getters rather than throwing —
  a dangling placeholder is a normal state, not an error.

---

## Dependencies

- `idb` for IndexedDB access.
- The storage quota types in `src/storage/types.ts`.

---

## Change History

| Date       | Change                                                                                  | Author |
| ---------- | --------------------------------------------------------------------------------------- | ------ |
| 2026-03-11 | Initial spec                                                                            | —      |
| 2026-10-02 | Corrected signatures; removed the never-existing `clear()`; documented the real surface | —      |
