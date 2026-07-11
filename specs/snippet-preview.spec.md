# Module: Snippet Preview

> Source: `src/lib/snippet-preview-ui.ts`
> Coverage target: 85%

## Purpose

Renders snippet content as HTML for preview in the UI.

## Scope

**In scope:** Preview rendering, markdown processing, placeholder handling.
**Out of scope:** Full editor, snippet persistence.

---

## `renderSnippetPreview(snippet, options): string`

**Behavior:**

- Renders snippet content as HTML for preview.
- Handles markdown, placeholders, images.
- Respects `maxLength` truncation.
- Pure function.

---

## Error Handling

- Returns empty string on failure.
- Does not throw.

---

## Dependencies

- Markdown utilities.
- Preview helpers.

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |