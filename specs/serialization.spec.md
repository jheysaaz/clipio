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

## `deserializeContent(content: string): TElement[]`

Converts HTML string to Plate/Slate editor value.

**Behavior:**

- Parses HTML via `DOMParser`, so it needs a DOM and **cannot run in the MV3 service
  worker**, where `DOMParser` is a `ReferenceError`.
- Converts standard elements to Slate nodes: paragraphs, headings, lists, links, blockquotes,
  and inline emphasis/strong/strike/code/underline.
- **Does not handle `<img>`.** The HTML-to-node walker has no image branch, so an `<img>` in an
  imported HTML body is dropped. The earlier "Handles images" claim was wrong. Images do reach
  the editor, but by a different route: a `{{image:<id>}}` _placeholder_ is converted to an image
  node from the placeholder, not from HTML markup. That distinction matters — it is why the
  legacy `contentFormat` migration cannot reuse this function, and uses the DOM-free converter in
  `src/lib/html-to-markdown.ts` instead. See `specs/content-format-migration.spec.md`.
- Returns an empty editor value on empty/invalid input.

---

## `serializeToMarkdown(value: SlateValue): string`

Converts editor value to Clipio Markdown.

**Behavior:**

- Serializes nodes to markdown with placeholders preserved.
- Handles text, headings, lists, links, images, and code blocks. Note that heading, list and
  code-block _block_ serialisation is partial; a full block grammar is deferred (Wave 10).
- Pure function.

---

## Dependencies

- Plate.js / Slate types

---

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |
