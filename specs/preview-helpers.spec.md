# Module: Preview Helpers

> Source: `src/lib/preview-helpers.ts`
> Coverage target: 85%

## Purpose

The pure logic behind the snippet preview popup: fuzzy matching and ranking, trigger detection,
viewport-aware positioning, and building the tooltip's plain-text label.

> **Corrected 2026-09-27.** This spec previously described
> `computePreviewPrivacy(snippet)`, which **does not exist** — verified by grep. The stated
> purpose ("analyzes snippet content for privacy-sensitive data") was also wrong: none of these
> functions touch privacy. That concern is enforced structurally, by rendering the preview as
> plain text inside a closed shadow root; see `specs/preview-privacy.spec.md`.

## Scope

**In scope:** fuzzy matching, trigger detection, positioning, tooltip text.
**Out of scope:** rendering, the shadow root, and the content-script wiring.

---

## `fuzzyMatchSnippets(snippets, query): FilteredSnippet[]`

**Behavior:**

- Scores snippets against the query on both shortcut and label.
- Returns only matches, most relevant first, each with the character ranges to highlight.

## `detectPreviewTrigger(text, caretPos, settings): TriggerMatch | null`

**Behavior:**

- Returns the trigger token ending at the caret when the prefix and keyboard-shortcut settings
  are satisfied, or `null`.
- Uses the same `isShortcutBoundary` predicate as `findSnippetMatch`, so both paths share one
  definition of the boundary. (They test *different* characters — expansion the char before the
  shortcut, the preview the char before the trigger prefix — so a shortcut that does not begin
  with the prefix can still be accepted by one path and declined by the other.)
- The prefix must be preceded by whitespace or sentence punctuation — which is what makes it
  reachable at the end of existing prose in a pre-filled field — and must not be preceded by a
  character that occurs inside a URL, path or file name. See `specs/shortcut-boundary.spec.md`.

## `calculatePreviewPosition(targetElement, cursorPos?): PreviewPosition`

**Behavior:**

- Anchors to the caret: the caret is measured with the mirror-element technique for
  `<input>`/`<textarea>`, and read from the live Selection for `contenteditable`.
- Places the palette within the viewport, flipping or clamping so it is never rendered
  off-screen.
- With no `cursorPos`, or for an element that is neither a field nor contenteditable, falls
  back to the element's own bounds / `{ x: 10, y: 10, maxHeight: 300 }`.

> **Corrected 2026-10-02.** This signature was previously documented as
> `calculatePreviewPosition(anchorRect, tooltipSize, viewport)` — no such function exists.
> Full behaviour, including the caret-measurement details, is in
> `specs/preview-anchor.spec.md`.

## `createPreviewTooltip(content): string`

**Behavior:**

- Converts snippet content to **plain text** via `markdownToPlainText`, removes any remaining
  `{{…}}` token, normalises whitespace, and truncates at a word boundary near 100 characters.
- Returns `"(empty snippet)"` for empty or whitespace-only content.
- Because the result is plain text and is assigned with `textContent`, snippet content is never
  parsed as markup.

---

## Error Handling

- `createPreviewTooltip` catches anything thrown while building the label and returns
  `"(content preview unavailable)"` rather than propagating. Note that branch is defensive and
  not reachable from a test, since every input it depends on is a pure, total function over a
  string — see the note in `preview-helpers.test.ts`.
- The matching, positioning and trigger functions do not throw.

---

## Dependencies

- `src/lib/markdown.ts` — `markdownToPlainText`.
- `src/lib/media-placeholders.ts` — via the markdown layer, for `{{image:}}` / `{{gif:}}`.

---

## Change History

| Date       | Change                                                                                | Author |
| ---------- | ------------------------------------------------------------------------------------- | ------ |
| 2026-09-27 | Removed the phantom `computePreviewPrivacy`; documented the four functions that exist | —      |
| 2026-10-02 | Corrected the `calculatePreviewPosition` signature; details moved to `preview-anchor.spec.md` | — |
| 2026-03-11 | Initial spec                                                                          | —      |
