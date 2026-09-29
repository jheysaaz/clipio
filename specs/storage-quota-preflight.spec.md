# Spec: sync quota preflight (Wave 9, rescoped)

spec: src/storage/quota-preflight.ts
status: implemented

## Problem

`storage.sync` is hard-capped at three limits, declared in `src/config/constants.ts`:

| Limit                        | Value                               |
| ---------------------------- | ----------------------------------- |
| total bytes across all items | `SYNC_QUOTA.TOTAL_BYTES` = 102,400  |
| bytes per item               | `SYNC_QUOTA.BYTES_PER_ITEM` = 8,192 |
| number of items              | `SYNC_QUOTA.MAX_ITEMS` = 512        |

Clipio stores one snippet per key (`snip:<id>`), so a snippet text over 8 KB cannot be stored in
sync at all, and a few hundred ordinary snippets exhaust the 100 KB total.

Today the user finds out the hard way:

1. A write throws a `QUOTA_BYTES` error inside `SyncBackend.applyWrite`.
2. `StorageManager` catches `StorageQuotaError`, calls `setMode("local")` and
   `storageModeReasonItem.setValue("quota")` — **permanently** — writes the batch to IndexedDB-backed
   local storage, and re-throws.
3. The user has silently lost cross-device sync. The only signal is the amber `warning-quota`
   banner on the options Dashboard, which they may not open for weeks.
4. There is no path back to sync except manually switching storage mode in settings, which
   re-migrates and can fail the same way.

A snippet tool is _going_ to hit a 100 KB ceiling. That is a product limit, not an edge case. The
bug is not that the limit exists; it is that hitting it is silent, permanent, and unexplained.

## Solution

A pure preflight that projects the post-write state against all three limits **before anything is
mutated**, and reports which limit breaks and by how much.

- Pure function, no I/O, fully unit-testable.
- On failure, throw a `StorageQuotaError` carrying structured reasons.
- **Do not** switch to local mode. **Do not** write to local. Nothing changes until the user decides.
- The UI can then say "this snippet is 9 KB and sync allows 8 KB per snippet" instead of silently
  dropping sync forever.

### The accounting caveat — stated up front

Chrome's own quota accounting is not exactly `JSON.stringify(value).length`, and not exactly UTF-8
byte length either. There is no documented formula we can reproduce exactly.

So the preflight is a **guard, not an authority**:

- It measures with `TextEncoder` (real UTF-8 byte length) plus the key's own byte length, which is
  the closest documented basis.
- It applies **no fudge factor**. An earlier version of this spec proposed rounding each item up
  to the next 64 bytes "to err toward warning early"; that was wrong, because it rejected a
  snippet of exactly `BYTES_PER_ITEM`, and a false refusal sitting on the documented limit is the
  worst possible place to be conservative. The rounding was removed from both this spec and the code.
- The browser's own `QUOTA_BYTES` error remains the source of truth. If the preflight passes and the
  browser still fails, the write is refused and the miss is reported to Sentry as
  `storage.quotaPreflightMiss`, because an inaccurate projection is a bug and silence is the only
  way it would never be found.
- A preflight failure when the write would actually have fit is likewise a false warning, not data
  loss: the write is refused and the user is asked.

## Acceptance Criteria

- [x] `checkQuota` is a pure function: no storage, no clock, no randomness.
- [x] Detects each of the three limits **independently**, and reports all that are breached (not
      just the first).
- [x] Each reason carries the actual value, the limit, and the key/id responsible.
- [x] A write that fits returns `{ ok: true }` with no reasons.
- [x] A snippet whose serialised size exceeds `BYTES_PER_ITEM` is reported against **that snippet**,
      by id.
- [x] Exceeding `MAX_ITEMS` is reported as a count, not as a byte total.
- [x] Byte-identical rewrites are excluded from the projection, matching `SyncBackend.planWrite` —
      re-saving unchanged snippets must not report a quota problem that no write would cause.
- [x] Removing snippets frees space: projected usage below current usage is not an error.
- [x] Non-ASCII is measured in UTF-8 bytes, not JS string length. `"é"` is 2 bytes, `"😀"` is 4.
- [ ] **Known gap, not solved:** the projection is given a list of snippets, so it cannot see the
      other keys the same code path writes — the `_pendingWrite` journal (up to
      `JOURNAL_MAX_BYTES` = 8,192 bytes) and any `corrupt:` quarantine records. Those _do_ count
      against the browser's real limits. A write can therefore pass the preflight and still be
      refused by the browser; that is what `storage.quotaPreflightMiss` reports, and there is a test
      pinning the gap (`quota-preflight.test.ts`, "cannot see the journal key"). Closing it means
      reading the real key set and accounting for non-snippet keys.
- [x] Exactly at a limit is allowed; one byte over is not.
- [x] An empty result set (everything removed) always fits.
- [x] `StorageManager` does **not** switch mode and does **not** write to local when the preflight
      fails.
- [x] The error thrown by the manager is a `StorageQuotaError` and carries the reasons, so existing
      callers that already catch it keep working unchanged.

## Known gaps

- The journal and quarantine keys above.
- Chrome's accounting is estimated, not exact. A write may be refused that would have fit.

## Edge Cases

- A snippet is exactly `BYTES_PER_ITEM` → fits. `BYTES_PER_ITEM + 1` → does not.
- Byte-identical rewrite of every snippet → no delta, fits, even at 99 % of the limit.
- A single snippet that can never fit in sync (e.g. 20 KB of text) → reported per-snippet, and the
  message must make clear that _this snippet_ is the problem, not the user's total usage.
- Mixed: total breached _and_ one oversized item → both reasons present.
- `local` mode active → the preflight does not run at all; local has no such limit. This must be
  explicit in the code path, not implied by the caller.
- Unicode that is 2 bytes (`é`, `→`) and 4 bytes (emoji) must both be counted as bytes, since a
  snippet of 4,000 emoji is 16 KB and would breach the 8 KB per-item limit while looking small.
- Key byte length counts. `snip:` plus a UUID is 41 bytes before any content.

## Non-Goals

- **Making IndexedDB the source of truth.** The original Wave 9 scope. It inverts the Wave 1–2
  design (sync authoritative, IndexedDB a fire-and-forget shadow backup) and a content script cannot
  reach the extension's IndexedDB at all. Rescoped by explicit decision.
- Raising the 100 KB ceiling. The browser owns it.
- Automatic truncation of oversized snippets. Losing snippet text silently is worse than refusing
  the write.
- Chunking a large snippet across items. It would break `snippetKey(id)` lookups everywhere.
- A migration UI for users already stuck in local mode. Worth doing; separate.

## Change History

| Date       | Change                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-27 | Initial spec. Wave 9 rescoped from "IndexedDB source of truth" to a quota preflight after the inversion was identified as conflicting with the Wave 1–2 design.                                                                |
| 2026-09-27 | Implemented. The per-item 64-byte rounding first proposed here was **removed**: it made a snippet of exactly `BYTES_PER_ITEM` get rejected, and a false refusal on the documented limit is the worst place to be conservative. |
