# Module: Preview Helpers

> Source: `src/lib/preview-helpers.ts`
> Coverage target: 85%

## Purpose

Analyzes snippet content for privacy-sensitive data before preview.

## Scope

**In scope:** Privacy analysis for preview.
**Out of scope:** Content sanitization, rendering.

---

## `computePreviewPrivacy(snippet): PreviewPrivacy`

**Behavior:**

- Analyzes snippet content for privacy-sensitive data.
- Returns `{ hasClipboard, hasDate, hasDatePicker, hasCursor }`.

---

## Error Handling

- Returns all `false` for invalid input.
- Does not throw.

---

## Dependencies

- None.

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |