# Module: Image Deduplication

> **Rewritten 2026-09-27.** This spec previously pointed at
> `src/lib/image-dedup.ts` and a `deduplicateImages(snippets)` function.
> **Neither exists** — verified by grep. Deduplication is not a snippet-level
> transform at all; it happens at the media-storage layer, and this spec
> described a design that was never built.

## Where deduplication actually lives

Deduplication is by **content hash of the blob**, in the media store — not by scanning snippet
bodies.

- `src/storage/backends/media.ts` — `findByHash(hash)` looks the blob up through a
  non-unique `hash` index on the media object store, so an identical image pasted twice is stored
  once.
- `src/storage/backends/indexeddb.ts` — the index is created in schema **v3**, and
  `backfillMediaHashes` assigns SHA-256 hashes to entries written before that version. It runs
  fire-and-forget on every database open, and a failure on one entry does not abort the rest.

The index is deliberately **non-unique**: two entries may share a hash transiently, e.g. during a
backfill race, and a unique index would make the second insert fail outright rather than dedupe.

## Why there is no `deduplicateImages`

The original idea was a snippet-level pass that rewrote duplicate `{{image:…}}` references to
point at one entry. That is not needed and would be wrong: a snippet legitimately references the
same image twice at different widths, and collapsing references by id would lose the second
width. What matters for storage is that the _blob_ is stored once, which the hash index already
achieves.

## Related

- `specs/media-storage.spec.md` — the media store, quotas, and the IDB schema versions.
- `specs/media-import-hardening.spec.md` — import-time limits.
- `specs/media-placeholders.spec.md` — the placeholder grammar those references use.

## Change History

| Date       | Change                                                            | Author |
| ---------- | ----------------------------------------------------------------- | ------ |
| 2026-09-26 | Initial spec — described a module and function that never existed | —      |
| 2026-09-27 | Rewritten to describe the hash-index deduplication that exists    | —      |
