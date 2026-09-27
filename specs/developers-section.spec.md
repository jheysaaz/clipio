# Module: Debug Logging

> Source: `src/lib/debug.ts`
> Coverage target: 85%

## Purpose

Provides debug logging with a fast-path no-op when disabled.

## Scope

**In scope:** Debug log storage, circular buffer, console echo.
**Out of scope:** UI for viewing logs, log export.

---

## `debugLog(context, event, detail): Promise<void>`

**Behavior:**

- No-op when debug mode off (fast-path after first init).
- When on: appends to circular buffer (`MAX_DEBUG_ENTRIES = 100`), echoes to `console.warn`.
- Initializes flag cache on first call via `debugModeItem.getValue()`.
- Watches `debugModeItem` for changes.
- Silently ignores storage read/write failures.

---

## Error Handling

- Does not throw on storage errors.
- Returns `undefined` on read failure.

---

## Dependencies

- `debugModeItem`, `debugLogItem` from storage.

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |