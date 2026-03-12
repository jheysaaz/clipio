# Module: Content Script Helpers

> Source: `src/lib/content-helpers.ts`
> Coverage target: 85%

## Purpose

Contains the pure, testable logic extracted from the content script
(`src/entrypoints/content.ts`). These functions handle snippet shortcut
matching, shortcut index management, date formatting for placeholders, and
snippet content processing (placeholder substitution).

Isolating this logic from the content script's DOM/browser API dependencies
makes it unit-testable without a browser environment.

## Scope

**In scope:** Shortcut matching algorithm, index building, date formatting,
placeholder processing (clipboard, date, datepicker, cursor).
**Out of scope:** DOM manipulation, event handling, confetti, Sentry integration,
browser storage access (those remain in `content.ts` and are tested via mocks).

---

## Types

```ts
interface Snippet {
  id: string;
  shortcut: string;
  content: string;
  label: string;
}

interface SnippetMatch {
  snippet: Snippet;
  startPos: number;
  endPos: number;
}

interface ProcessedContent {
  content: string;
  cursorOffset: number | null;
}

interface ShortcutIndex {
  map: Map<string, Snippet>;
  lengths: number[]; // sorted descending
}
```

---

## Public API

### `buildShortcutIndex(snippets: Snippet[]): ShortcutIndex`

**Description:** Builds an optimized lookup index from an array of snippets.

**Behavior:**

- MUST return a `Map` keyed by shortcut string, valued by `Snippet`.
- MUST return a `lengths` array of all unique shortcut lengths, sorted descending.
- MUST handle an empty snippets array → empty map and empty lengths array.
- MUST overwrite duplicate shortcuts with the last occurrence (last-write-wins).
- MUST sort lengths descending so longer/more-specific shortcuts match first.

**Invariants:**

- `index.lengths.length ≤ index.map.size` (fewer unique lengths than entries).
- `index.lengths` is sorted in descending order.
- For every length `L` in `index.lengths`, at least one shortcut of that length exists in `index.map`.

**Examples:**

```ts
const index = buildShortcutIndex([
  { id: "1", shortcut: "hi", content: "Hello", label: "Hi" },
  { id: "2", shortcut: "bye", content: "Goodbye", label: "Bye" },
]);
index.map.get("hi"); // → Snippet { id: "1", ... }
index.lengths; // → [3, 2]  (sorted descending)
```

---

### `findSnippetMatch(text: string, cursorPosition: number, index: ShortcutIndex): SnippetMatch | null`

**Description:** Checks whether the text immediately before the cursor ends with
a known shortcut that is preceded by a word boundary (or start of text).

**Behavior:**

- MUST return `null` when `text` is empty or `index.map` is empty.
- MUST check shortcuts from longest to shortest (using `index.lengths` order).
- MUST skip shortcuts longer than `cursorPosition`.
- MUST extract the candidate string as `text.substring(cursorPosition - len, cursorPosition)`.
- MUST return `null` if the candidate is not in `index.map`.
- MUST return `null` if `startPos > 0` and the character at `startPos - 1` is not a word boundary (space or newline).
- MUST return `{ snippet, startPos, endPos: cursorPosition }` when a match is found.
- MUST return the first (longest) matching shortcut when multiple shortcuts could match.

**Word boundary definition:** A character is a word boundary if it matches `/[\s\n]/`.

**Edge Cases:**

- `cursorPosition === 0` → `null` (no text before cursor).
- Shortcut at the very start of text (no preceding character) → MUST match (word boundary not required at position 0).
- Shortcut that is a suffix of another word (e.g. `"hi"` in `"ohhi"`) → MUST NOT match (no word boundary before `"hi"`).

**Examples:**

```ts
const index = buildShortcutIndex([
  { id: "1", shortcut: "hi", content: "Hello", label: "Hi" },
]);

findSnippetMatch("hi", 2, index);
// → { snippet: ..., startPos: 0, endPos: 2 }

findSnippetMatch("say hi", 6, index);
// → { snippet: ..., startPos: 4, endPos: 6 }

findSnippetMatch("ohhi", 4, index);
// → null  (no word boundary before "hi")

findSnippetMatch("", 0, index);
// → null
```

---

### `formatDate(format: string, dateStr?: string): string`

**Description:** Formats a date according to the specified Clipio date format ID.
When `dateStr` is omitted, uses today's date.

**Behavior:**

- MUST support format `"iso"` → `"YYYY-MM-DD"`.
- MUST support format `"us"` → `"MM/DD/YYYY"`.
- MUST support format `"eu"` → `"DD/MM/YYYY"`.
- MUST support format `"long"` → full locale date e.g. `"January 1, 2025"`.
- MUST support format `"short"` → abbreviated locale date e.g. `"Jan 1, 25"`.
- MUST default to `"iso"` format for unrecognised format strings.
- MUST use the provided `dateStr` when given (parsed as `new Date(dateStr + "T00:00:00")`).
- MUST use today's date when `dateStr` is omitted.
- MUST zero-pad month and day in `"iso"`, `"us"`, and `"eu"` formats.

**Examples:**

```ts
formatDate("iso", "2025-06-15"); // → "2025-06-15"
formatDate("us", "2025-06-15"); // → "06/15/2025"
formatDate("eu", "2025-06-15"); // → "15/06/2025"
formatDate("long", "2025-01-01"); // → "January 1, 2025"
formatDate("short", "2025-01-01"); // → "Jan 1, 25" (locale-dependent)
formatDate("unknown", "2025-06-15"); // → "2025-06-15" (iso default)
```

---

### `processSnippetContent(content: string, asHtml: boolean, readClipboard: () => string): ProcessedContent`

**Description:** Processes a raw Clipio Markdown snippet string by substituting
all dynamic placeholders and optionally converting to HTML.

The `readClipboard` function is injected as a dependency to keep this function
pure and testable without DOM access.

**Behavior (placeholder processing — happens before format conversion):**

- MUST replace all `{{clipboard}}` occurrences with the result of `readClipboard()`.
- MUST replace all `{{date:format}}` occurrences with `formatDate(format)`.
- MUST replace all `{{datepicker:YYYY-MM-DD}}` occurrences with `formatDate("long", dateStr)`.
- MUST reset regex `lastIndex` to 0 after each date placeholder replacement to avoid skipping matches.

**Behavior when `asHtml === true`:**

- MUST convert the processed Markdown to HTML using `markdownToHtml`.
- MUST replace the first `{{cursor}}` with `<span id="clipio-cursor-marker" data-clipio-cursor="true"></span>`.
- MUST remove any remaining `{{cursor}}` occurrences after the first.
- MUST return `cursorOffset: null`.

**Behavior when `asHtml === false` (plain text mode):**

- MUST strip all Markdown formatting using `markdownToPlainText`.
- MUST detect `{{cursor}}` before stripping and compute `cursorOffset`.
- `cursorOffset` MUST be the plain-text length of the content before the cursor position.
- MUST return `cursorOffset: null` when no `{{cursor}}` is present.

**Edge Cases:**

- Clipboard read failure → caller should catch and substitute `"(clipboard unavailable)"` (handled in content script, not here).
- Multiple `{{cursor}}` → only the first is used; rest are removed.
- Empty content → `{ content: "", cursorOffset: null }`.

---

## Error Handling

- `buildShortcutIndex` and `findSnippetMatch` MUST NOT throw for any input.
- `formatDate` MUST NOT throw for any format string or date string.
- `processSnippetContent` MUST NOT throw for any content string.

## Dependencies

- `markdownToHtml` and `markdownToPlainText` from `src/lib/markdown.ts`.
- `formatDate` is a pure function within this module.
- `readClipboard` is injected by the caller (content script) — not a dependency of this module itself.
- No browser APIs, no storage access, no DOM.

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-11 | Initial spec | —      |
