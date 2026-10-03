# Module: Usage Tracking

> Source: `src/utils/usageTracking.ts`
> Coverage target: 85%

## Purpose

Counts how often each snippet has been used, locally. No analytics endpoint is
involved — this is a per-device counter used to order the snippet list and to
decide when the review prompt is eligible.

## Scope

**In scope:** Per-snippet usage counters, the global insertion total.
**Out of scope:** Any remote analytics.

---

## What this module actually contains

> **Corrected.** This spec previously documented `trackEvent(event, props?)`,
> `getUsageStats()` and a `UsageStats` type carrying `topShortcuts`. **None of
> them exist.** The module has no analytics concept at all — no event name, no
> props, no endpoint. That earlier text read as a precise API contract while
> describing code that was never written. Found by the drift gate in
> `specs/coverage-honesty.spec.md`.

---

## `getUsageCounts(): Promise<Record<string, number>>`

Every snippet's count, keyed by snippet id.

## `getSnippetUsageCount(snippetId: string): Promise<number>`

One snippet's count. Used to sort the list most-used first.

## `incrementSnippetUsage(snippetId: string): Promise<void>`

Adds one to a snippet's count.

## `resetSnippetUsage(snippetId: string): Promise<void>`

Zeroes one snippet's count.

## `clearAllUsageCounts(): Promise<void>`

Zeroes every counter.

## `incrementTotalInsertions(): Promise<void>`

Adds one to the global total-insertions counter.

**Why it is separate from the per-snippet counters:** the review prompt's
eligibility check in `src/lib/review-prompt.ts` requires
`totalSnippetInsertions >= REVIEW_MIN_INSERTIONS` (20). That is a distinct
number from any per-snippet count, so it needs its own counter.

**Fire-and-forget.** The content script calls this on every expansion and must
never let a storage failure disrupt an expansion, so failures are swallowed
after logging.

---

## Error Handling

- No operation throws to the caller. Storage failures are logged and swallowed;
  a missing or unreadable count resolves to `0`.
- `incrementTotalInsertions` is explicitly documented as never disrupting
  expansion on failure.

---

## Dependencies

- WXT typed storage (`wxt/utils/storage`).

---

## Change History

| Date       | Change                                                                           | Author |
| ---------- | -------------------------------------------------------------------------------- | ------ |
| 2026-03-11 | Initial spec                                                                     | —      |
| 2026-10-02 | Corrected: removed the never-built `trackEvent`/`getUsageStats`/`UsageStats` API | —      |
