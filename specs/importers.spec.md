# Module: Import Parsers

> Source: `src/lib/importers/`
> Coverage target: 90%

## Purpose

Parses snippet data exported from third-party tools (TextBlaze, Power Text) and
from Clipio's own export format into a unified `ParsedSnippet` structure that the
import wizard can review, conflict-check, and apply.

## Scope

**In scope:** Format detection, parsing of all three supported formats, placeholder
conversion, unsupported-placeholder tracking.
**Out of scope:** Conflict detection (handled by the UI/wizard), final persistence
(handled by `StorageManager`), HTML rendering.

---

## `detectFormat(raw: unknown): FormatId | null`

> Source: `src/lib/importers/detect.ts`

**Description:** Inspects a parsed JSON value and returns which import format it
most likely represents, or `null` if unrecognised.

**Detection order (priority):**

1. **Clipio versioned envelope:** object (not array) with `format === "clipio"`.
2. **Clipio legacy bare array:** array whose first element has string fields `id`, `shortcut`, `content`.
3. **TextBlaze:** object with `version` (number) AND `folders` (array).
4. **Power Text:** non-array object with no structural keys (`format`, `version`, `folders`, `snippets`) where every value is a string and the object has at least one entry.

**Behavior:**

- MUST return `"clipio"` for `{ format: "clipio", version: 1, snippets: [] }`.
- MUST return `"clipio"` for `[]` (empty array is still a valid Clipio export).
- MUST return `"clipio"` for `[{ id: "x", shortcut: "s", content: "c", label: "l" }]`.
- MUST return `"textblaze"` for `{ version: 1, folders: [] }`.
- MUST return `"textblaze"` for `{ version: 2, folders: [{ snippets: [] }] }`.
- MUST return `"powertext"` for `{ hello: "world", bye: "goodbye" }`.
- MUST return `null` for `null`.
- MUST return `null` for a bare string, number, or boolean.
- MUST return `null` for an array whose first element does not match the Clipio snippet shape.
- MUST return `null` for `{}` (empty object — PowerText requires at least one entry).
- MUST return `null` for an object with mixed value types (not all strings).

**Invariants:**

- Function is pure (no side effects).
- Returns one of: `"clipio"`, `"textblaze"`, `"powertext"`, or `null`.

---

## `ClipioParser`

> Source: `src/lib/importers/clipio.ts`

### `ClipioParser.canParse(raw: unknown): boolean`

**Behavior:**

- MUST return `true` for versioned envelope (`{ format: "clipio", ... }`).
- MUST return `true` for empty array `[]`.
- MUST return `true` for array whose first element is a valid snippet object.
- MUST return `false` for `null`, non-objects, and non-Clipio arrays.
- MUST return `false` for array whose first element is missing `id`, `shortcut`, or `content`.

### `ClipioParser.parse(raw: unknown): ParsedSnippet[]`

**Behavior:**

- MUST parse versioned envelope by reading `envelope.snippets`.
- MUST parse legacy bare array by filtering items with `isValidSnippet`.
- MUST skip items in the array that fail `isValidSnippet` validation.
- MUST map each valid snippet to a `ParsedSnippet` with `suggestedId === snippet.id`.
- MUST preserve `label`, `shortcut`, `content`, and `tags` from the source.
- MUST always set `unsupportedPlaceholders: []` (Clipio format has no unsupported placeholders).
- MUST return `[]` for an empty array input.
- MUST return `[]` for an envelope with an empty `snippets` array.

---

## `TextBlazeParser`

> Source: `src/lib/importers/textblaze.ts`

### `TextBlazeParser.canParse(raw: unknown): boolean`

**Behavior:**

- MUST return `true` for `{ version: <number>, folders: [...] }`.
- MUST return `false` for arrays, null, non-objects.
- MUST return `false` for objects missing `version` or `folders`.
- MUST return `false` when `folders` is present but `version` is not a number.

### `TextBlazeParser.parse(raw: unknown): ParsedSnippet[]`

**Behavior:**

- MUST iterate all folders and their snippets.
- MUST skip snippets with an empty `shortcut` or empty `name`.
- MUST tag each snippet with `"text_blaze"` and the lowercased folder name (when present).
- MUST convert `{cursor}` → `{{cursor}}` in snippet text.
- MUST convert `{clipboard}` → `{{clipboard}}` in snippet text.
- MUST record unrecognised `{token}` placeholders in `unsupportedPlaceholders`.
- MUST process `type: "html"` snippets by stripping `data-mce-*` attributes and converting HTML → Clipio markdown.
- MUST fall back to the `text` field when HTML conversion fails.
- MUST process `type: "text"` snippets using the `text` field verbatim (after placeholder substitution).
- MUST return `[]` for an export with no folders or all-empty folders.

**Edge Cases:**

- Folder with no `name` → tags = `["text_blaze"]` only.
- Snippet with `type: "html"` but empty `html` field → use `text` field.
- HTML containing `data-mce-style` attributes → stripped before conversion.

---

## `PowerTextParser`

> Source: `src/lib/importers/powertext.ts`

### `PowerTextParser.canParse(raw: unknown): boolean`

**Behavior:**

- MUST return `true` for `{ shortcut: "expansion", ... }` (all string values, no structural keys).
- MUST return `false` for arrays, null, non-objects.
- MUST return `false` for empty objects `{}`.
- MUST return `false` for objects that contain `format`, `version`, `folders`, or `snippets` keys.
- MUST return `false` when any value is non-string.

### `PowerTextParser.parse(raw: unknown): ParsedSnippet[]`

**Behavior:**

- MUST create one `ParsedSnippet` per key-value pair.
- MUST set `label` and `shortcut` both to the key (Power Text has no separate label field).
- MUST skip entries with empty keys or empty values.
- MUST convert `%clip%` and `%clipboard%` (case-insensitive) → `{{clipboard}}`.
- MUST convert `%d(YYYY-MM-DD)` → `{{date:iso}}`.
- MUST convert `%d(MM/DD/YYYY)` → `{{date:us}}`.
- MUST convert `%d(DD/MM/YYYY)` → `{{date:eu}}`.
- MUST convert `%d(MMMM Do, YYYY)` → `{{date:long}}`.
- MUST convert `%d(MMM Do)` → `{{date:short}}`.
- MUST flag unrecognised `%d(...)` format strings in `unsupportedPlaceholders`.
- MUST detect HTML values (containing `<tag>`) and convert via HTML → markdown pipeline.
- MUST always tag each snippet with `"power_text"`.
- MUST deduplicate `unsupportedPlaceholders` (no duplicate entries).

**Edge Cases:**

- `%CLIP%` (uppercase) → `{{clipboard}}` (case-insensitive match).
- `%d(X)` with unknown format → kept as literal text, added to `unsupportedPlaceholders`.
- HTML value conversion failure → uses raw text fallback.

---

## Error Handling

- All parsers MUST NOT throw on malformed input — they degrade gracefully
  (skip invalid snippets, return `[]`, etc.).
- `detectFormat` MUST return `null` (not throw) on any input type.

## Dependencies

- `TextBlazeParser` and `PowerTextParser` depend on `deserializeContent` and
  `serializeToMarkdown` from `src/components/editor/serialization.ts` for HTML→MD conversion.
  In tests, these are exercised via real calls (integration-style) unless mocked.
- `crypto.randomUUID()` is called for `suggestedId` in TextBlaze and PowerText parsers.
  Tests should not assert on the exact UUID value.

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |
