# Module: Usage Tracking

> Source: `src/utils/usageTracking.ts`
> Coverage target: 85%

## Purpose

Tracks how many times each snippet has been expanded (inserted) by the content
script. Counts are stored in `browser.storage.local` under a per-snippet map
keyed by snippet ID.

Usage counts are informational only — they do not affect snippet functionality
and are never synced across devices.

## Scope

**In scope:** Reading, incrementing, resetting, and clearing usage counts.
**Out of scope:** Display formatting (handled by UI components), sync storage.

---

## Public API

### `getUsageCounts(): Promise<Record<string, number>>`

**Description:** Returns the full usage count map for all snippets.

**Behavior:**

- MUST return a `Record<string, number>` mapping snippet IDs to their count.
- MUST return `{}` when no usage data has been recorded yet.
- MUST return `{}` when reading from storage throws an error (graceful degradation).
- MUST log errors to console and report to Sentry on failure.

---

### `getSnippetUsageCount(snippetId: string): Promise<number>`

**Description:** Returns the usage count for a specific snippet.

**Behavior:**

- MUST return the count for the given `snippetId`.
- MUST return `0` when the snippet has no recorded usage.
- MUST return `0` when storage is unavailable.

---

### `incrementSnippetUsage(snippetId: string): Promise<number>`

**Description:** Increments the usage count for a snippet by 1 and persists it.

**Behavior:**

- MUST read the current usage counts.
- MUST increment the count for `snippetId` by 1 (starting from 0 if not present).
- MUST persist the updated counts to storage.
- MUST return the new count after incrementing.
- MUST return `0` and log the error when storage throws (graceful degradation).

**Invariants:**

- After a successful call, `getSnippetUsageCount(snippetId)` returns the previous value + 1.

---

### `resetSnippetUsage(snippetId: string): Promise<void>`

**Description:** Removes the usage count entry for a specific snippet.

**Behavior:**

- MUST delete the entry for `snippetId` from the usage map.
- MUST persist the updated map to storage.
- MUST handle the case where `snippetId` is not in the map (no-op, no error).
- MUST log errors silently on storage failure (no Sentry report).

---

### `clearAllUsageCounts(): Promise<void>`

**Description:** Removes all usage count data from storage.

**Behavior:**

- MUST call `usageCountsItem.removeValue()` to clear the entire map.
- MUST log errors silently on storage failure.

---

## Error Handling

All functions in this module use try/catch and degrade gracefully:

- `getUsageCounts` → returns `{}`
- `getSnippetUsageCount` → returns `0`
- `incrementSnippetUsage` → returns `0`
- `resetSnippetUsage` / `clearAllUsageCounts` → silently no-ops

## Dependencies

- `usageCountsItem` from `src/storage/items.ts` — WXT typed storage item wrapping `browser.storage.local`.
- `captureError` from `src/lib/sentry.ts` — used by `getUsageCounts` and `incrementSnippetUsage`.

In tests, both must be mocked. `usageCountsItem` can be mocked with a simple
in-memory store; `captureError` can be a `vi.fn()`.

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |
