# Module: Markdown Utilities

> Source: `src/lib/markdown.ts`
> Coverage target: 90%

## Purpose

Converts Clipio Markdown to HTML and plain text for snippet expansion.

## Scope

**In scope:** Markdown → HTML, Markdown → Plain Text.
**Out of scope:** Editor integration, placeholder processing (handled in content-helpers).

---

## `markdownToHtml(md: string): string`

Converts Clipio Markdown to HTML.

**Behavior:**

- Supports: bold, italic, code, links, images, headings, lists, blockquotes, code blocks.
- Sanitizes output (no script tags, no event handlers).
- Pure function.

---

## `markdownToPlainText(md: string): string`

Strips markdown formatting, returns plain text.

**Behavior:**

- Removes markdown syntax.
- Preserves text content.
- Pure function.

---

## Error Handling

- Does not throw for any input.
- Returns empty string for empty/null input.

---

## Dependencies

- None (self-contained parser)

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |