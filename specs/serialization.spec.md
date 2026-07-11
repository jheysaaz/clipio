# Module: Editor Serialization

> Source: `src/components/editor/serialization.ts`
> Coverage target: 90%

## Purpose

Converts between HTML strings and Plate/Slate editor values, and serializes
editor values to Clipio Markdown for storage.

## Scope

**In scope:** HTML → Slate value, Slate value → Markdown.
**Out of scope:** Editor UI, Plate configuration, content manipulation.

---

## `deserializeContent(html: string): SlateValue`

Converts HTML string to Plate/Slate editor value.

**Behavior:**

- Parses HTML via `DOMParser`.
- Converts standard elements to Slate nodes.
- Handles images, links, formatting.
- Returns empty editor value on empty/invalid input.

---

## `serializeToMarkdown(value: SlateValue): string`

Converts editor value to Clipio Markdown.

**Behavior:**

- Serializes nodes to markdown with placeholders preserved.
- Handles text, headings, lists, links, images, code blocks.
- Pure function.

---

## Dependencies

- Plate.js / Slate types

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |