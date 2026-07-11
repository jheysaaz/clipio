# Module: Usage Tracking

> Source: `src/utils/usageTracking.ts`
> Coverage target: 85%

## Purpose

Tracks anonymous usage statistics for product insights.

## Scope

**In scope:** Event tracking, stats aggregation.
**Out of scope:** Personal data, analytics dashboard.

---

## `trackEvent(event: string, props?: Record<string, unknown>): void`

**Behavior:**

- Sends event to analytics endpoint if enabled.
- No-op if disabled or no endpoint configured.
- Fire-and-forget (doesn't await).

---

## `getUsageStats(): Promise<UsageStats>`

**Behavior:**

- Reads from storage.
- Returns `{ totalSnippets, totalExpansions, topShortcuts }`.

---

## `UsageStats` Type

```ts
interface UsageStats {
  totalSnippets: number;
  totalExpansions: number;
  topShortcuts: { shortcut: string; count: number }[];
}
```

---

## Error Handling

- Tracking failures are silent.
- Stats return zeros on storage error.

---

## Dependencies

- Storage.
- Optional analytics endpoint.

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |