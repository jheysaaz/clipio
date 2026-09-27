# Spec: Import Validation

> Source: `src/lib/snippet-schema.ts`
> Tests: `src/lib/snippet-schema.test.ts`
> Consumers: `src/lib/importers/clipio.ts`, `src/storage/manager.ts`
> Status: implemented

## Purpose

An import file is something the user was talked into importing. It may be malformed, hostile,
or simply enormous. Every field that reaches storage is bounded and type-checked in one place.

## Problem

Two separate validation implementations existed, and the weaker one guarded a more dangerous
path.

`importers/clipio.ts` had `isValidSnippet`, which checked that four fields were strings and
that `contentFormat` was one of two values.

`manager.importSnippets` had its own inline filter checking only that `id`, `label`,
`shortcut` and `content` were strings. **No bounds, no timestamps, no tags, no prototype-key
check, no duplicate-id check.** It is the path the Options "Import" button uses.

The concrete consequence: `browser.storage.sync` allows 512 items and 102,400 bytes total.
A single imported snippet with a 10 KB `content` string, or a file with 5,000 entries, does
not fail the import — it succeeds, and then **every subsequent write throws a quota error**.
The manager flips the user to local storage permanently, and their snippets stop syncing
across devices. `AdvancedSection` offers a manual switch back, but the user has no reason to
know why it happened.

A crafted `id` containing `__proto__` also reached storage, where it becomes a `snip:` key
and an object-store `keyPath`.

## Solution

`src/lib/snippet-schema.ts` is the single validator, used by both paths.

### `validateImportedSnippet(raw)`

Returns `{ ok: true, snippet }` with a **normalised** record, or `{ ok: false, reason }`.

Normalisation, rather than rejection, for defects that are cosmetic and recoverable — refusing
them would lose a user's real snippet over a formatting nit:

- missing `contentFormat` → `"markdown"`
- missing/unparseable `createdAt` / `updatedAt` → now
- missing or nonsensical `usageCount` → `0`

`contentFormat: "html"` is accepted on the wire for backwards compatibility but **normalised to
`"markdown"`**. This matters: the editor always serialises markdown, so an `"html"` label on a
markdown body is the data-corruption vector described in `specs/content-format-migration`.

Rejection, for genuine integrity or safety problems: non-objects, missing or over-long fields,
`contentFormat` that is neither markdown nor html, a non-array or over-long `tags`, an
unparseable timestamp, a `usageCount` that is not a safe non-negative integer, and any `id`
containing `__proto__`, `constructor` or `prototype`.

### `validateImportPayload(raw)`

Validates a whole payload, and — crucially — **skips** a bad record rather than aborting.
One malformed entry in an otherwise good export should not cost the user their other 200
snippets. It returns the accepted records, the reason and index for each rejection, and a
`tooManySnippets` flag, so the UI can say out loud what was dropped instead of silently
discarding data. Duplicate ids within one file are rejected, since the second would silently
overwrite the first.

### `IMPORT_LIMITS`

`maxFileBytes` 8 MB · `maxSnippets` 2000 · `maxContentLength` 32,000 ·
`maxLabelLength` 200 · `maxShortcutLength` 64 · `maxTags` 20 · `maxTagLength` 40

`maxSnippets` is set above the 512 sync cap on purpose: in **local** mode a user legitimately
holds far more than 512 snippets, and rejecting the import at 512 would be a regression.
Sync mode degrades through the existing quota fallback, which is the designed behaviour.

## Acceptance Criteria

- [x] A well-formed record is accepted and normalised.
- [x] Missing `contentFormat` becomes `"markdown"`.
- [x] `contentFormat: "html"` is normalised to `"markdown"`.
- [x] An unknown `contentFormat` is rejected.
- [x] Missing timestamps default to a valid ISO time.
- [x] An unparseable timestamp is rejected.
- [x] A negative, fractional or unsafe-integer `usageCount` is rejected.
- [x] A missing `usageCount` becomes `0`.
- [x] `tags` is capped in count and per-tag length.
- [x] A non-array `tags` is rejected.
- [x] An over-long `content` is rejected.
- [x] An over-long `label` / `shortcut` is rejected.
- [x] An `id` containing `__proto__` / `constructor` / `prototype` is rejected.
- [x] A duplicate id within one payload keeps the first and reports the second.
- [x] A payload of non-objects yields an empty accepted list, not a throw.
- [x] A payload larger than `maxSnippets` is truncated with the flag set.
- [x] One bad record does not reject the good ones.
- [x] `isValidImportedSnippet` agrees with `validateImportedSnippet(...).ok`.
- [x] `manager.importSnippets` routes through the shared validator.
- [x] `importers/clipio.ts` delegates to the shared validator rather than keeping a copy.

## Edge Cases

- **An empty payload** yields zero accepted records; `manager.importSnippets` turns that
  into its existing "No valid snippets found" error, so behaviour is unchanged.
- **A record that is `null`** is rejected as `not-an-object`, not dereferenced.
- **`usageCount` of `0`** is preserved, not confused with "absent".
- **A `tags` array containing a non-string** is rejected rather than silently coerced.
- **The `maxSnippets` cap skips the remainder without reporting each as a rejection**,
  because they were never individually examined. `tooManySnippets` communicates this.

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-09-26 | Initial spec | —      |
