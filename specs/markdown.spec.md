# Module: Shared Markdown Utilities

> Source: `src/lib/markdown.ts`
> Coverage target: 90%

## Purpose

Provides the canonical implementations of Markdown ↔ HTML / plain-text
conversion functions that are shared between the editor serialization layer
(`src/components/editor/serialization.ts`) and the content script helpers
(`src/lib/content-helpers.ts`).

Extracting these into a single shared module eliminates the duplication that
existed between the two files and ensures that all consumers of these functions
are covered by a single test suite.

## Scope

**In scope:** Pure string-to-string conversion functions for Clipio's Markdown dialect.
**Out of scope:** Plate node serialization/deserialization (handled by `serialization.ts`),
DOM manipulation (handled by content script), storage or browser APIs.

---

## Public API

### `escapeHtml(text: string): string`

**Description:** Escapes HTML special characters in a plain text string to prevent
XSS when inserting into HTML contexts.

**Behavior:**

- MUST replace `&` with `&amp;`.
- MUST replace `<` with `&lt;`.
- MUST replace `>` with `&gt;`.
- MUST replace `"` with `&quot;`.
- MUST process replacements in the order above (`&` first to avoid double-escaping).
- MUST return the input unchanged if it contains no special characters.
- MUST return `""` for an empty string input.

**Invariants:**

- Pure function — same input always produces same output.
- Output never contains unescaped `&`, `<`, `>`, or `"` characters.

**Examples:**

```ts
escapeHtml('<script>alert("xss")</script>'); // → '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
escapeHtml("hello world"); // → "hello world"
escapeHtml(""); // → ""
escapeHtml("a & b"); // → "a &amp; b"
```

---

### `sanitizeUrl(url: string): string`

**Description:** Validates and sanitizes a URL to prevent XSS via dangerous URL schemes.

**Behavior:**

- MUST return the URL (trimmed) unchanged for `http://` scheme.
- MUST return the URL (trimmed) unchanged for `https://` scheme.
- MUST return the URL (trimmed) unchanged for `mailto:` scheme.
- MUST return `""` for `javascript:` scheme.
- MUST return `""` for `data:` scheme.
- MUST return `""` for `vbscript:` scheme.
- MUST return `""` for any other non-http/mailto scheme (e.g. `ftp:`, `blob:`).
- MUST prepend `https://` to bare domains or paths with no URL scheme (no `:`).
- MUST trim leading/trailing whitespace from the input before processing.

**Invariants:**

- Output is either `""` (blocked) or a string beginning with `http://`, `https://`, or `mailto:`.

**Examples:**

```ts
sanitizeUrl("https://example.com"); // → "https://example.com"
sanitizeUrl("http://example.com"); // → "http://example.com"
sanitizeUrl("mailto:user@example.com"); // → "mailto:user@example.com"
sanitizeUrl("javascript:alert(1)"); // → ""
sanitizeUrl("data:text/html,<b>hi</b>"); // → ""
sanitizeUrl("example.com"); // → "https://example.com"
sanitizeUrl("  https://trimmed.com  "); // → "https://trimmed.com"
```

---

### `markdownInlineToHtml(text: string): string`

**Description:** Converts a single line of Clipio Markdown inline formatting to HTML.
Does NOT handle multi-line content (no `<br>` joining — use `markdownToHtml` for that).

**Behavior:**

- MUST convert `[label](url)` links first (before italic, to avoid URL underscores
  triggering italic matching).
- MUST convert `**text**` → `<strong>text</strong>`.
- MUST convert `_text_` → `<em>text</em>`.
- MUST convert `~~text~~` → `<s>text</s>`.
- MUST convert `` `text` `` → `<code>text</code>`.
- MUST convert `<u>text</u>` → `<u>text</u>`.
- MUST escape plain text segments using `escapeHtml`.
- MUST sanitize link URLs using `sanitizeUrl`.
- MUST add `target="_blank" rel="noopener noreferrer"` to all generated `<a>` tags.
- MUST recurse for nested marks inside link labels (e.g. `[**bold**](url)` → `<a>...<strong>bold</strong>...</a>`).
- MUST fall back to escaped plain text for link labels when the URL is blocked by `sanitizeUrl`.
- MUST NOT infinite-loop on malformed input (consume at least one char per iteration).

---

### `markdownToHtml(content: string): string`

**Description:** Converts a full multi-line Clipio Markdown string to HTML by
splitting on `\n`, converting each line with `markdownInlineToHtml`, and joining
with `<br>`.

**Behavior:**

- MUST return `""` for empty/falsy input.
- MUST split on `\n` (not `\r\n`).
- MUST apply `markdownInlineToHtml` to each line.
- MUST join lines with `<br>` (not `<br/>`, not `<br />`).
- MUST handle single-line input (no `<br>` in output).

**Invariants:**

- Always returns a string (never throws).
- `<br>` count = number of `\n` characters in input.

---

### `markdownToPlainText(content: string): string`

**Description:** Converts a Clipio Markdown string to plain text by stripping all
inline formatting marks and converting links to their URL.

**Behavior:**

- MUST return `""` for empty/falsy input.
- MUST strip `**text**` → `text`.
- MUST strip `_text_` → `text`.
- MUST strip `~~text~~` → `text`.
- MUST strip `` `text` `` → `text`.
- MUST strip `<u>text</u>` → `text`.
- MUST convert `[label](url)` → `url`.
- MUST pass `{{...}}` placeholder syntax through unchanged.
- MUST process links before stripping marks (to avoid link URLs matching mark patterns).

**Invariants:**

- Output contains no `**`, `_text_`, `~~`, `` ` ``, `<u>` markdown syntax.
- Function is pure.

---

## Error Handling

All functions in this module MUST NOT throw for any string input. Edge cases
(empty string, malformed syntax) are handled gracefully by returning the safest
reasonable output.

## Dependencies

None. All functions are pure string transformations with no imports.

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |
