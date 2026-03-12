# Module: Date Utilities

> Source: `src/utils/dateUtils.ts`
> Coverage target: 95%

## Purpose

Provides human-readable date formatting helpers used throughout the UI to display
snippet timestamps. All functions are pure (no side effects, deterministic given
a fixed clock) and operate on ISO date strings or `Date` objects.

## Scope

**In scope:** Relative time strings, short date labels, full date labels.
**Out of scope:** Timezone conversion, locale negotiation, internationalization
(UI locale is always `"en-US"`).

---

## Public API

### `getRelativeTime(date: string | Date): string`

**Description:** Returns a human-readable relative time string for how long ago
the given date occurred relative to `Date.now()`.

**Behavior:**

- MUST accept both ISO string and `Date` object as input.
- MUST return `"just now"` when the difference is less than 60 seconds.
- MUST return `"1 minute ago"` at exactly 60 seconds.
- MUST return `"N minutes ago"` for 2–59 minutes.
- MUST return `"1 hour ago"` at exactly 60 minutes.
- MUST return `"N hours ago"` for 2–23 hours.
- MUST return `"1 day ago"` at exactly 24 hours.
- MUST return `"N days ago"` for 2–6 days.
- MUST return `"1 week ago"` at exactly 7 days.
- MUST return `"N weeks ago"` for 2–3 weeks (< 4 weeks).
- MUST return `"1 month ago"` when days ≥ 28 and < 60.
- MUST return `"N months ago"` for 2–11 months (< 12).
- MUST return `"1 year ago"` at exactly 365 days.
- MUST return `"N years ago"` for 2+ years.
- MUST use integer division (floor) for all time unit calculations.

**Edge Cases:**

- Exactly 0 seconds difference → `"just now"`
- Future dates (negative difference) → treated as 0 seconds → `"just now"`
- Exactly 1 minute (60s) boundary → `"1 minute ago"`, not `"just now"`
- Exactly 1 hour (3600s) boundary → `"1 hour ago"`, not `"N minutes ago"`

**Invariants:**

- Output is always a non-empty string.
- Output always ends in `"ago"` or is `"just now"`.
- Function does not mutate its input.

**Examples:**

```ts
getRelativeTime(new Date(Date.now() - 30_000)); // → "just now"
getRelativeTime(new Date(Date.now() - 90_000)); // → "1 minute ago"
getRelativeTime(new Date(Date.now() - 7_200_000)); // → "2 hours ago"
getRelativeTime(new Date(Date.now() - 86_400_000)); // → "1 day ago"
getRelativeTime(new Date(Date.now() - 7 * 86400_000)); // → "1 week ago"
getRelativeTime("2020-01-01T00:00:00.000Z"); // → "N years ago"
```

---

### `formatShortDate(date: string | Date): string`

**Description:** Formats a date as a short, locale-formatted string (e.g. `"Nov 11"`).

**Behavior:**

- MUST accept both ISO string and `Date` object.
- MUST return a string in the format `"Mon DD"` (abbreviated month + day number).
- MUST use `"en-US"` locale.
- MUST NOT include the year.

**Invariants:**

- Output is always a non-empty string.
- Output matches `toLocaleDateString("en-US", { month: "short", day: "numeric" })`.

**Examples:**

```ts
formatShortDate("2025-11-11"); // → "Nov 11"
formatShortDate("2025-01-01"); // → "Jan 1"
formatShortDate(new Date("2025-06-15")); // → "Jun 15"
```

---

### `formatFullDate(date: string | Date): string`

**Description:** Formats a date as a full human-readable string (e.g. `"November 11, 2025"`).

**Behavior:**

- MUST accept both ISO string and `Date` object.
- MUST return a string in the format `"Month DD, YYYY"` (full month name, day, year).
- MUST use `"en-US"` locale.
- MUST include the year.

**Invariants:**

- Output is always a non-empty string.
- Output matches `toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })`.

**Examples:**

```ts
formatFullDate("2025-11-11"); // → "November 11, 2025"
formatFullDate("2025-01-01"); // → "January 1, 2025"
formatFullDate(new Date("2025-06-15")); // → "June 15, 2025"
```

---

## Error Handling

These functions do not throw on invalid inputs — they delegate to the JS `Date`
constructor which will produce `NaN`-based dates for invalid strings. Tests
should verify behavior on well-formed inputs only.

## Dependencies

None. All functions are pure with no external dependencies. Fully unit-testable
without mocks.

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |
