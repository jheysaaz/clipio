# Spec: Image Content-Hash Deduplication

## Goal

Prevent storing the same image bytes more than once in IndexedDB, regardless of how
many snippets reference it or how many times the user uploads it. Two images are
considered identical if their SHA-256 digests match. Deduplication is **silent** —
the caller receives the existing entry's metadata with no UI feedback.

---

## Background

Prior to this feature every `saveMedia()` call generated a fresh UUID and stored a
new blob, even for identical files. This wasted the 50 MB quota and inflated export
ZIP sizes.

---

## IDB Schema Migration (v2 → v3)

| Version | Change                                             |
| ------- | -------------------------------------------------- |
| v1      | `"snippets"` object store created                  |
| v2      | `"media"` object store created                     |
| **v3**  | Non-unique `"hash"` index added to `"media"` store |

### Backward compatibility

- The upgrade is **non-destructive**: only a new index is added.
- Existing entries that lack a `hash` field are not touched during `onupgradeneeded`
  (IDB upgrades are synchronous and cannot await crypto operations).
- A **lazy backfill** runs asynchronously after the DB connection opens: entries
  missing a `hash` are read, their SHA-256 is computed, and the entry is updated in
  place. This runs once and is idempotent.
- Opening the database at version 1 from legacy e2e helpers returns the same DB
  silently (IDB ignores downgrade requests); no breakage.

---

## `MediaMetadata` Interface Change

```ts
interface MediaMetadata {
  id: string;
  mimeType: string;
  width: number;
  height: number;
  size: number;
  originalSize: number;
  createdAt: string;
  alt?: string;
  hash?: string; // NEW — SHA-256 hex of the stored blob bytes
}
```

`hash` is **optional** to allow existing entries (pre-v3) to pass TypeScript
checks until the backfill completes.

---

## `saveMedia()` Deduplication Flow

```
saveMedia(file: Blob | File) →
  1. Validate MIME type          → throw FiletypeError if unsupported
  2. Validate file size          → throw FileSizeError if > MAX_FILE_SIZE
  3. Validate total quota        → throw StorageFullError if would exceed MAX_TOTAL_SIZE
  4. Compute SHA-256(file bytes) → hash: string
  5. Query IDB "hash" index      → existing: MediaMetadata | undefined
  6. If existing found           → return existing metadata (SILENT DEDUP — no new UUID, no new blob)
  7. Otherwise                   → generate UUID, read dimensions, store MediaEntry, return metadata
```

Step 3 (quota check) must **exclude** the dedup branch: if we return an existing
entry we do not consume additional quota, so the quota guard is checked before the
hash lookup only for the "new write" path. Practically: compute hash first, check
for existing, and only check the quota if no match is found.

---

## `compressMedia()` Re-hash Flow

After WebP conversion the stored blob changes bytes. The hash field must be
updated so future uploads of the same (already-compressed) bytes deduplicate:

```
compressMedia(id) →
  1. Look up entry by id
  2. Skip GIF / WebP (unchanged)
  3. Attempt PNG/JPEG → WebP conversion
  4. If WebP is smaller:
     a. Compute SHA-256(webpBlob bytes) → newHash
     b. Check IDB "hash" index for newHash
     c. If another entry already has newHash → delete current entry, snippet
        references already point to the *same id* so this edge-case is noted
        but not handled (post-compression cross-entry dedup is out of scope)
     d. Store updated entry with new blob + new hash + updated mimeType/size
```

---

## `restoreMediaEntry()` Dedup on Import

When importing a ZIP that was exported from a different device, the same image may
already exist in the local IDB (e.g. the user has the same image in a local snippet).
`restoreMediaEntry()` should:

1. Compute `SHA-256` of the incoming blob.
2. Query the `"hash"` index.
3. If an entry with the same hash already exists **and has the same ID** → skip
   (idempotent re-import of the same export).
4. If an entry with the same hash exists **with a different ID** → skip the new
   entry and do **not** rewrite snippet references (out of scope; the ZIP importer
   already handles ID conflicts at a higher level).
5. Otherwise → store normally with the computed hash.

---

## `findByHash(hash: string)` Helper

A new exported function for tests and internal use:

```ts
async function findByHash(hash: string): Promise<MediaMetadata | null>;
```

Returns the first matching entry metadata (no blob), or `null`.

---

## Acceptance Criteria

### AC-1: Duplicate upload returns existing ID

Uploading the same file bytes twice produces one IDB entry and both calls return
the same `id`.

### AC-2: Different file produces new entry

Uploading two files with different content produces two distinct IDB entries.

### AC-3: Quota is not charged for dedup

Uploading a duplicate file when the store is near-full succeeds (returns existing
entry) without throwing `StorageFullError`.

### AC-4: Post-compression dedup

After `compressMedia()` runs on an entry, the entry's `hash` field reflects the
SHA-256 of the compressed WebP blob, not the original.

### AC-5: Import dedup (same hash, same ID)

`restoreMediaEntry()` called with an entry whose ID already exists in IDB skips
the write (existing entry is preserved).

### AC-6: Migration preserves all existing entries

After upgrading from IDB v2 to v3, all existing media entries remain readable and
the backfill assigns a `hash` to each of them.

### AC-7: Fresh install (v0 → v3) works correctly

New installs with no prior DB get both stores and the hash index created together.
