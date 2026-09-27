# Module: Media Storage

> Source: `src/storage/backends/media.ts`
> Coverage target: 85%

## Purpose

Manages image/media storage in IndexedDB for snippets.

## Scope

**In scope:** Media blob storage, retrieval, cleanup.
**Out of scope:** Image processing, snippet content.

---

## `MediaBackend` Interface

### `saveMedia(id: string, blob: Blob): Promise<void>`

Stores a media blob.

### `getMedia(id: string): Promise<Blob | null>`

Retrieves a media blob.

### `deleteMedia(id: string): Promise<void>`

Deletes a media blob.

### `clear(): Promise<void>`

Clears all media.

---

## Error Handling

- Operations fail silently with logging.
- Does not throw to caller.

---

## Dependencies

- IndexedDB.

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |