# Module: Copy Markdown as Rich Text

> Source: `src/lib/copyMarkdownAsRichText.ts`
> Coverage target: 85%

## Purpose

Copies markdown content as rich text (HTML) to clipboard.

## Scope

**In scope:** Markdown → HTML conversion, Clipboard API write.
**Out of scope:** Markdown parsing, editor integration.

---

## `copyMarkdownAsRichText(markdown: string): Promise<void>`

**Behavior:**

- Converts markdown to HTML.
- Uses Clipboard API to write as rich text.
- Falls back to plain text on failure.

---

## Error Handling

- Falls back to plain text on Clipboard API failure.
- Does not throw.

---

## Dependencies

- Markdown utilities.
- Clipboard API.

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |