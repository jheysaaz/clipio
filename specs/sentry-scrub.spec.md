# Module: Sentry Scrubbing

> Source: `src/lib/sentry-scrub.ts`
> Coverage target: 90%

## Purpose

Removes sensitive data from Sentry events before they are sent.

## Scope

**In scope:** Event scrubbing logic.
**Out of scope:** Sentry initialization, transport.

---

## `scrubSentryEvent(event: Event): Event`

**Behavior:**

- Removes `clipboard` data from extra/context.
- Redacts snippet content in breadcrumbs.
- Keeps error messages and stack traces intact.
- Pure function.

---

## Error Handling

- Does not throw.
- Returns original event if scrubbing fails.

---

## Dependencies

- None.

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |