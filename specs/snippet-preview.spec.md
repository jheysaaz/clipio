# Module: Snippet Preview

> Source: `src/lib/preview-helpers.ts` + `src/entrypoints/content.ts` (preview UI)
> Coverage target: 90%

## Purpose

Provides a minimal, autocomplete-style UI in the content script that allows users to browse, filter, and select snippets while typing. The preview appears near the cursor position and shows snippet names, shortcuts, with content preview on hover. This feature improves discoverability and reduces the need to memorize all snippet shortcuts.

## Scope

**In scope:** Fuzzy filtering logic, keyboard navigation state management, cursor positioning calculations, preview UI rendering, trigger detection (prefix + keyboard shortcut), settings integration.

**Out of scope:** Actual snippet expansion (uses existing logic), DOM event handling for host page inputs (remains in content script), React components (uses Shadow DOM with vanilla JS).

---

## Types

```ts
interface PreviewSettings {
  enabled: boolean;
  triggerPrefix: string;
  keyboardShortcut: string;
}

interface FilteredSnippet {
  snippet: ContentSnippet;
  relevanceScore: number;
  highlightRanges: Array<{
    start: number;
    end: number;
    field: "shortcut" | "label";
  }>;
}

interface PreviewPosition {
  x: number;
  y: number;
  maxHeight: number;
}

interface PreviewState {
  isVisible: boolean;
  selectedIndex: number;
  filteredSnippets: FilteredSnippet[];
  triggerText: string;
  triggerStartPos: number;
}

interface HoverTooltip {
  isVisible: boolean;
  content: string;
  position: { x: number; y: number };
}
```

---

## Public API

### `fuzzyMatchSnippets(query: string, snippets: ContentSnippet[]): FilteredSnippet[]`

**Description:** Performs fuzzy matching on snippet shortcut and label, returning scored and highlighted results.

**Behavior:**

- MUST return empty array when `query` is empty or `snippets` is empty.
- MUST search both `shortcut` and `label` fields for matches.
- MUST prioritize exact prefix matches over fuzzy matches.
- MUST assign higher scores to shorter snippets with matches (more relevant).
- MUST return results sorted by relevance score (descending).
- MUST include highlight ranges for matched characters in both fields.
- MUST be case-insensitive for matching.
- MUST handle special regex characters in query without throwing.

**Scoring algorithm:**

- Exact prefix match on shortcut: 1000 points
- Exact prefix match on label: 800 points
- Fuzzy match on shortcut: 500 + (query.length / shortcut.length) \* 100
- Fuzzy match on label: 300 + (query.length / label.length) \* 100
- Consecutive character bonus: +50 per consecutive match
- Early match bonus: +20 per character from start

**Edge Cases:**

- Empty query → returns empty array (not all snippets)
- Query longer than any snippet field → returns empty array
- Special characters in query → treated as literal characters
- Identical scores → maintain original snippet order

**Examples:**

```ts
const snippets = [
  { id: "1", shortcut: "/hello", label: "Hello World", content: "Hi there!" },
  { id: "2", shortcut: "/hi", label: "Quick Hi", content: "Hello!" },
];

fuzzyMatchSnippets("hel", snippets);
// → [
//   { snippet: snippets[0], relevanceScore: 1000, highlightRanges: [{ start: 1, end: 4, field: 'shortcut' }] },
//   { snippet: snippets[1], relevanceScore: 320, highlightRanges: [{ start: 0, end: 2, field: 'label' }] },
// ]

fuzzyMatchSnippets("", snippets); // → []
fuzzyMatchSnippets("xyz", snippets); // → []
```

---

### `calculatePreviewPosition(targetElement: HTMLElement, cursorPos?: number): PreviewPosition`

**Description:** Calculates optimal position for the preview popup relative to cursor or target element.

**Behavior:**

- MUST position preview below cursor when space available (minimum 200px).
- MUST position preview above cursor when insufficient space below.
- MUST clamp horizontal position to viewport bounds (with 10px margin).
- MUST return `maxHeight` based on available vertical space.
- MUST handle both input/textarea (with `cursorPos`) and contenteditable elements.
- MUST account for page scroll offset and element positioning.
- MUST prefer cursor position over element bounds when cursor position is available.

**Positioning logic:**

1. Get cursor coordinates (via mirror element for inputs, Selection API for contenteditable)
2. Calculate available space below/above cursor
3. Choose vertical position (below preferred, above if needed)
4. Clamp horizontal position to viewport with margins
5. Calculate maxHeight from available space minus 20px padding

**Edge Cases:**

- Cursor at very bottom of page → positions above
- Cursor near right edge → shifts left to stay in viewport
- Very narrow viewport → preview takes full width minus margins
- Element not in DOM → returns safe fallback position (10, 10, 300)

**Examples:**

```ts
// Cursor at (100, 200) with 400px space below
calculatePreviewPosition(inputEl, 10);
// → { x: 100, y: 220, maxHeight: 380 }

// Cursor at (100, 700) with only 50px space below, 600px above
calculatePreviewPosition(inputEl, 10);
// → { x: 100, y: 480, maxHeight: 200 }
```

---

### `detectPreviewTrigger(text: string, cursorPos: number, settings: PreviewSettings): TriggerMatch | null`

**Description:** Detects if the text before cursor should trigger the preview (prefix-based triggering).

**Behavior:**

- MUST return `null` when preview is disabled (`settings.enabled === false`).
- MUST detect when cursor is immediately after the trigger prefix.
- MUST require word boundary before prefix (space, newline, or start of text).
- MUST return trigger position and extracted query text.
- MUST handle empty trigger prefix (always triggers when enabled).
- MUST ignore prefix inside words (e.g., "email" should not trigger with prefix "m").

**Word boundary definition:** Character matches `/[\s\n]/` or position is start of text.

**Return type:**

```ts
interface TriggerMatch {
  startPos: number; // Position of prefix in text
  endPos: number; // Current cursor position
  query: string; // Text after prefix (for filtering)
}
```

**Edge Cases:**

- Cursor at position 0 → `null` (no text before cursor)
- Prefix at start of text → matches (no preceding word boundary required)
- Multiple prefixes in text → returns rightmost before cursor
- Cursor before prefix → `null`

**Examples:**

```ts
const settings = {
  enabled: true,
  triggerPrefix: "/",
  keyboardShortcut: "Ctrl+Shift+Space",
};

detectPreviewTrigger("Hello /wor", 9, settings);
// → { startPos: 6, endPos: 9, query: "wor" }

detectPreviewTrigger("email/test", 10, settings);
// → null (no word boundary before "/")

detectPreviewTrigger("/hello", 6, settings);
// → { startPos: 0, endPos: 6, query: "hello" }
```

---

### `createPreviewTooltip(content: string): string`

**Description:** Formats snippet content for hover tooltip display (first ~100 characters).

**Behavior:**

- MUST truncate content to approximately 100 characters at word boundary.
- MUST strip Markdown formatting to plain text.
- MUST replace multiple whitespace sequences with single spaces.
- MUST add "..." ellipsis when content is truncated.
- MUST handle empty or whitespace-only content gracefully.
- MUST remove placeholder tokens ({{clipboard}}, {{date:*}}, etc.) from display.

**Processing steps:**

1. Convert markdown to plain text
2. Remove placeholder tokens with regex
3. Normalize whitespace
4. Truncate at word boundary near 100 chars
5. Add ellipsis if truncated

**Edge Cases:**

- Empty content → returns "(empty snippet)"
- Only whitespace → returns "(empty snippet)"
- Content under 100 chars → returns as-is (no ellipsis)
- Very long first word → truncates at character boundary

**Examples:**

```ts
createPreviewTooltip(
  "Hello **world**! This is a long snippet content that should be truncated properly."
);
// → "Hello world! This is a long snippet content that should be truncated..."

createPreviewTooltip("{{clipboard}} - {{date:iso}}");
// → "(empty snippet)"

createPreviewTooltip("");
// → "(empty snippet)"
```

---

## Error Handling

- All functions MUST NOT throw for any valid input.
- Invalid DOM elements → safe fallback behavior (return default positions/empty arrays).
- Malformed settings → treat as disabled/use defaults.
- Browser API failures (getSelection, etc.) → graceful degradation.

## Dependencies

- `markdownToPlainText` from `src/lib/markdown.ts` for content processing.
- Browser Selection API and DOM measurements for positioning.
- Storage items from `src/storage/items.ts` for settings.
- No React dependencies (Shadow DOM with vanilla JS).

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-03-29 | Initial spec | —      |
