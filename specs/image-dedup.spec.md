# Module: Image Deduplication

> Source: `src/lib/image-dedup.ts`
> Coverage target: 85%

## Purpose

Deduplicates images in snippets to save storage.

## Scope

**In scope:** Image hash computation, deduplication logic.
**Out of scope:** Image upload, editor integration.

---

## `deduplicateImages(snippets: Snippet[]): Snippet[]`

**Behavior:**

- Computes perceptual hash for each image.
- Replaces duplicate image references with a single stored copy.
- Returns updated snippets array.

---

## Error Handling

- Returns original snippets on failure.
- Does not throw.

---

## Dependencies

- Image hash library.

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |