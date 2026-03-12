# Module: Editor Serialization

> Source: `src/components/editor/serialization.ts`
> Coverage target: 90%

## Purpose

Provides bidirectional conversion between three representations of snippet content:

1. **Plate nodes** (internal editor state — `TElement[]` / `Descendant[]`)
2. **Clipio Markdown** (storage format — a small Markdown dialect with `{{placeholder}}` syntax)
3. **HTML** (insertion format for `contenteditable` elements and legacy import)

This module is the single most critical pure-logic module in the codebase. Any
bug here directly corrupts stored snippet content.

## Scope

**In scope:** Plate ↔ Markdown serialization, Markdown ↔ HTML conversion,
legacy HTML → Plate deserialization.
**Out of scope:** DOM manipulation, React rendering, editor plugin configuration.

---

## Supported Inline Marks

| Mark          | Markdown syntax | HTML output                                                         |
| ------------- | --------------- | ------------------------------------------------------------------- |
| Bold          | `**text**`      | `<strong>text</strong>`                                             |
| Italic        | `_text_`        | `<em>text</em>`                                                     |
| Strikethrough | `~~text~~`      | `<s>text</s>`                                                       |
| Code          | `` `text` ``    | `<code>text</code>`                                                 |
| Underline     | `<u>text</u>`   | `<u>text</u>`                                                       |
| Link          | `[label](url)`  | `<a href="url" target="_blank" rel="noopener noreferrer">label</a>` |

## Supported Placeholders

| Placeholder | Markdown syntax                     | Plate element type                        |
| ----------- | ----------------------------------- | ----------------------------------------- |
| Clipboard   | `{{clipboard}}`                     | `CLIPBOARD_PLACEHOLDER`                   |
| Date        | `{{date:iso\|us\|eu\|long\|short}}` | `DATE_PLACEHOLDER` with `format` prop     |
| Cursor      | `{{cursor}}`                        | `CURSOR_PLACEHOLDER`                      |
| Datepicker  | `{{datepicker:YYYY-MM-DD}}`         | `DATEPICKER_PLACEHOLDER` with `date` prop |

---

## Public API

### `serializeToMarkdown(nodes: Descendant[]): string`

**Description:** Converts an array of Plate `Descendant` nodes to a Clipio
Markdown string. Paragraphs are separated by `\n`.

**Behavior:**

- MUST convert plain text nodes to their text content.
- MUST wrap bold text in `**...**`.
- MUST wrap italic text in `_..._`.
- MUST wrap underline text in `<u>...</u>`.
- MUST wrap strikethrough text in `~~...~~`.
- MUST wrap code text in `` `...` ``.
- MUST convert `CLIPBOARD_PLACEHOLDER` nodes to `{{clipboard}}`.
- MUST convert `DATE_PLACEHOLDER` nodes to `{{date:<format>}}` using the node's `format` prop (defaults to `"iso"`).
- MUST convert `CURSOR_PLACEHOLDER` nodes to `{{cursor}}`.
- MUST convert `DATEPICKER_PLACEHOLDER` nodes to `{{datepicker:<date>}}` using the node's `date` prop.
- MUST convert `LINK_ELEMENT` nodes to `[<children>](<url>)`.
- MUST join multiple paragraphs with `\n`.
- MUST return an empty string `""` for an empty node or text node with empty text.

**Invariants:**

- Output is a valid Clipio Markdown string.
- Round-trip: `serializeToMarkdown(deserializeFromMarkdown(md)) ≈ md` for all supported syntax.

---

### `deserializeContent(content: string): TElement[]`

**Description:** Smart deserializer that auto-detects whether the input is HTML
(legacy format) or Markdown (current format) and delegates accordingly.

**Behavior:**

- MUST return `[{ type: "p", children: [{ text: "" }] }]` for empty or whitespace-only input.
- MUST delegate to `deserializeFromHtml` when the content contains HTML tags (matches `/<[a-z][\s\S]*>/i`).
- MUST delegate to `deserializeFromMarkdown` otherwise.

**Invariants:**

- Always returns a non-empty array (at least one paragraph node).

---

### `markdownToHtml(markdown: string): string`

**Description:** Converts a Clipio Markdown string to an HTML string suitable
for insertion into `contenteditable` elements. Paragraphs are joined with `<br>`.

**Behavior:**

- MUST return `""` for empty/falsy input.
- MUST convert `**text**` → `<strong>text</strong>`.
- MUST convert `_text_` → `<em>text</em>`.
- MUST convert `~~text~~` → `<s>text</s>`.
- MUST convert `` `text` `` → `<code>text</code>`.
- MUST convert `<u>text</u>` → `<u>text</u>` (pass through).
- MUST convert `[label](url)` → `<a href="url" target="_blank" rel="noopener noreferrer">label</a>`.
- MUST escape HTML special characters (`&`, `<`, `>`, `"`) in plain text segments.
- MUST escape HTML special characters in link URLs and code content.
- MUST join multiple lines with `<br>` (not `<p>`).
- MUST sanitize link URLs: block `javascript:` and `data:` schemes by returning `""` for the href and falling back to the plain label text.
- MUST allow `http://`, `https://`, and `mailto:` URLs unchanged.
- MUST prepend `https://` to bare domain URLs (no scheme).
- MUST support nested marks (e.g. bold inside a link label).

**Edge Cases:**

- `[label](javascript:alert(1))` → label rendered as escaped plain text, no `<a>` tag.
- `[label](example.com)` → `<a href="https://example.com">label</a>`.
- Empty string → `""`.
- Multiple newlines → multiple `<br>` separators.

---

### `markdownToPlainText(markdown: string): string`

**Description:** Converts a Clipio Markdown string to plain text by stripping all
formatting marks and converting links to their URL only.

**Behavior:**

- MUST return `""` for empty/falsy input.
- MUST strip `**text**` → `text`.
- MUST strip `_text_` → `text`.
- MUST strip `~~text~~` → `text`.
- MUST strip `` `text` `` → `text`.
- MUST strip `<u>text</u>` → `text`.
- MUST convert `[label](url)` → `url` (URL replaces the entire link).
- MUST NOT process placeholder syntax (`{{...}}`) — those pass through unchanged.

**Invariants:**

- Function is pure: same input always produces same output.
- Output contains no markdown formatting characters from supported marks.

---

## Deserialization: Markdown → Plate Nodes

### `deserializeFromMarkdown(markdown: string)`

**Behavior:**

- MUST split on `\n` to produce one Plate paragraph per line.
- MUST parse inline Markdown within each paragraph into Plate nodes.
- MUST create `CLIPBOARD_PLACEHOLDER` element for `{{clipboard}}`.
- MUST create `DATE_PLACEHOLDER` element with `format` prop for `{{date:X}}`.
- MUST create `CURSOR_PLACEHOLDER` element for `{{cursor}}`.
- MUST create `DATEPICKER_PLACEHOLDER` element with `date` prop for `{{datepicker:YYYY-MM-DD}}`.
- MUST create `LINK_ELEMENT` with `url` prop for `[label](url)`.
- MUST create bold text node `{ text: "...", bold: true }` for `**...**`.
- MUST create italic text node for `_..._`.
- MUST create strikethrough text node for `~~...~~`.
- MUST create code text node for `` `...` ``.
- MUST create underline text node for `<u>...</u>`.
- MUST return empty paragraph for empty/whitespace-only input.

---

## Deserialization: HTML → Plate Nodes (Legacy)

### `deserializeFromHtml(html: string)`

**Behavior:**

- MUST handle `<p>` and `<div>` as paragraph nodes.
- MUST handle `<strong>` / `<b>` → bold mark.
- MUST handle `<em>` / `<i>` → italic mark.
- MUST handle `<u>` → underline mark.
- MUST handle `<s>` / `<del>` / `<strike>` → strikethrough mark.
- MUST handle `<code>` → code mark.
- MUST handle `<a href="...">` → `LINK_ELEMENT` with `url` prop.
- MUST handle `<br>` → newline text node.
- MUST handle `<span>` → transparent (pass through children).
- MUST detect clipboard placeholder via `.clipboard-placeholder` class or `{{clipboard}}` text content.
- MUST wrap orphaned text nodes (not inside `<p>`) in paragraph elements.

---

## URL Sanitization

### `sanitizeUrl(url: string): string` (internal)

- MUST return the URL unchanged for `http://`, `https://`, and `mailto:` schemes.
- MUST return `""` for `javascript:`, `data:`, `vbscript:`, and other non-http schemes.
- MUST prepend `https://` to bare domains or paths with no scheme.

---

## Error Handling

- `deserializeContent` MUST NOT throw for any string input.
- `markdownToHtml` MUST NOT throw for any string input.
- `markdownToPlainText` MUST NOT throw for any string input.

## Dependencies

- `platejs` types (`TText`, `TElement`, `Descendant`) — imported as types only.
- `DOMParser` — used only in `deserializeFromHtml` (legacy path). Requires DOM environment
  (`happy-dom` in tests).
- Element type constants from `./types.ts`.

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |
