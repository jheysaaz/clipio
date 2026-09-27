# Spec: Media Import Hardening

> Source: `src/storage/backends/media.ts`, `src/lib/importers/clipio.ts`
> Tests: `src/storage/backends/media.test.ts`, `src/lib/importers/clipio.test.ts`
> Coverage target: 85%

## Purpose

A `.clipio.zip` export is untrusted input. The user may be talked into importing a file
someone sent them. The import path must apply the same limits as the upload path.

## Problem

Two gaps, both in the import path only.

### 1. `restoreMediaEntry` skipped all validation

Its docstring states: *"Skips validation (size/type) since the data was previously validated
on export."* That premise is false for an untrusted export. `importClipioZip` takes `meta`
verbatim from the attacker's `export.json`; `ImportWizard` calls `restoreMediaEntry` in a
loop. There is no MIME check, no per-file size check, and no quota check.

The attacker also controls `meta.size`, which is the value `getTotalSize()` sums — so the
quota accounting can be made to under-report, letting storage grow past `MAX_TOTAL_SIZE`.

**Impact is denial of service, not script execution.** The blob is later read by
`MEDIA_GET_DATA_URL` in the background, base64-encoded, and returned to the content script
for inlining into `<img src="data:...">`. A multi-megabyte blob therefore becomes a
multi-megabyte string, allocated three times across the process boundary, on every
expansion of a snippet that references it. `data:image/svg+xml` in an `img src` does not
execute script, so this is memory pressure and page freezes rather than XSS. It is
**durable**: the blob stays in IndexedDB until the user manually deletes it.

### 2. `unzipSync` had no decompression-bomb guard

`unzipSync` inflates the entire archive before any of the above runs. A 42-byte ZIP can
inflate to gigabytes, exhausting memory in the options page.

## Solution

### `restoreMediaEntry` validates at the trust boundary

- MIME type must be in `MEDIA_LIMITS.SUPPORTED_TYPES`.
- `entry.blob.size` must be ≤ `MEDIA_LIMITS.MAX_FILE_SIZE`.
- Projected total (current total + blob size) must be ≤ `MEDIA_LIMITS.MAX_TOTAL_SIZE`.
- The stored `size` field is **recomputed from the blob**, not trusted, so quota accounting
  cannot be lied to.

`saveMedia` is unchanged: its validation was already correct.

### `importClipioZip` bounds decompression

Uses fflate's `UnzipFileInfo.originalSize`, which is available in the `filter` callback
*before* extraction, to enforce a total-inflated-bytes budget. The budget is derived from
`MEDIA_LIMITS.MAX_TOTAL_SIZE` rather than hard-coded, so the two cannot drift.

`media.id` must be a short opaque token matching `[A-Za-z0-9_-]{1,64}`, because the id is
interpolated into `{{image:<id>}}` placeholders and used to build the `media/<id>.` archive
path. Without this, an export can inject `{{image:anything}}` tokens that the editor could
never create but the insertion path would still honour.

This is deliberately **not** a strict UUID match. `saveMedia` uses `crypto.randomUUID()`,
but a strict pattern would refuse any export whose ids came from a different scheme, and a
user restoring their own backup is not an attack. What matters is that an id cannot contain
a path separator, a dot, or the brace/colon characters that would let it escape into a
placeholder. A rejected id is reported in `missingMediaIds` rather than dropped silently.

## Acceptance Criteria

- [x] `restoreMediaEntry` rejects a blob whose MIME type is not allow-listed.
- [x] `restoreMediaEntry` rejects a blob larger than `MAX_FILE_SIZE`.
- [x] `restoreMediaEntry` rejects a write that would exceed `MAX_TOTAL_SIZE`.
- [x] `restoreMediaEntry` recomputes `size` from the blob rather than trusting the field.
- [x] A rejected entry is not written to IndexedDB.
- [x] A rejected entry does not consume quota.
- [x] `saveMedia`'s existing validation is unchanged and still passes its tests.
- [x] `importClipioZip` aborts when the declared total inflated size exceeds the budget.
- [x] `importClipioZip` rejects a `media[].id` that is not a safe opaque token.
- [x] A legitimate export round-trips unchanged.

## Edge Cases

- **A legitimate full export.** 25 × 2 MB images is exactly `MAX_TOTAL_SIZE`, and the
  archive also contains `export.json` on top. The budget is therefore
  `MAX_TOTAL_SIZE + MAX_MANIFEST_INFLATED_BYTES`, not `MAX_TOTAL_SIZE` — without the
  headroom a user at the media cap could not restore their own backup. An earlier revision
  of this spec got that arithmetic wrong, and the test written to match it asserted the
  opposite of its own name.
- **A `meta.mimeType` that is missing** falls back to `guessMimeFromPath`, and the result
  is still validated. A `.txt` renamed to `.png` is refused at the MIME check.
- **A `meta.size` that disagrees with the blob** is not an error — the blob is
  authoritative and the field is overwritten. Mismatches are not worth failing an import
  over.
- **Re-importing the same export** still short-circuits on the hash check, so a second
  import neither duplicates bytes nor re-consumes quota.

## Non-Goals

- Viruses or content scanning. Not relevant for a local-first extension.
- Refusing imports outright. The limits are the same ones the upload path already applies.

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-09-26 | Initial spec | —      |
