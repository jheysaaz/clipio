# Module: Preview Privacy

> Source: `src/lib/preview-privacy.ts`
> Coverage target: 85%

## Purpose

Sanitizes HTML for safe preview rendering.

## Scope

**In scope:** HTML sanitization for preview.
**Out of scope:** Full content sanitization, editor integration.

---

## `sanitizeForPreview(html: string): string`

**Behavior:**

- Strips `data-clipio-*` attributes.
- Removes cursor marker span.
- Returns sanitized HTML safe for preview.

---

## Error Handling

- Returns empty string for invalid input.
- Does not throw.

---

## Dependencies

- None.

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |