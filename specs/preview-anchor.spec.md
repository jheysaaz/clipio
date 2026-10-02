# Module: Preview Anchor (caret positioning)

> Source: `src/lib/preview-helpers.ts` (`calculatePreviewPosition`, `getCursorCoordsInInput`),
> `src/entrypoints/content.ts` (`showPreview`), `src/lib/snippet-preview-ui.ts` (`show`).
> Coverage target: 85%

## Purpose

The snippet palette is anchored to the **caret**, not to the element. Whatever the user is
typing next to is where the palette should appear.

---

## Problem

`showPreview()` called `calculatePreviewPosition(element)` and never forwarded the caret offset.
`cursorPos` was therefore `undefined`, and inside `calculatePreviewPosition` the
`typeof cursorPos === "number"` guard failed, so every `<input>` / `<textarea>` took the
**element-bounds fallback**:

```ts
const rect = targetElement.getBoundingClientRect();
cursorCoords = { x: rect.left, y: rect.bottom };
```

Result: in a multi-line textarea with the caret on line 1, the palette rendered at
`(field left, field bottom)` — pinned under the whole field, detached from the caret. The
mirror-element measurement code (`getCursorCoordsInInput`) existed, was unit-tested in
isolation, and was never reached in production. Only `contenteditable` was unaffected,
because that path reads the live Selection.

## Solution

Thread the caret offset through to the measurement, and make the measurement itself honest
about the things that were silently wrong in it.

---

## Behavior

### `calculatePreviewPosition(targetElement, cursorPos?)`

- For `<input>` / `<textarea>` **with** a numeric `cursorPos`: anchor to the caret measured
  via the mirror-element technique.
- For `<input>` / `<textarea>` **without** `cursorPos`: fall back to element bounds (this
  remains a supported degraded mode, not a crash).
- For `contenteditable`: anchor to the live Selection range rect; `cursorPos` is ignored.
- For anything else, or if any step throws: `{ x: 10, y: 10, maxHeight: 300 }`.

### `getCursorCoordsInInput(element, cursorPos)`

- The mirror must reproduce the control's **content box**, not its border box:
  `box-sizing: border-box` + `width: element.offsetWidth` (the border-box width), with the
  control's padding and border copied too. Both other pairings are wrong: the computed
  `style.width` is a content-box value and double-counts padding and border (mirror wider
  than the field), and `clientWidth` excludes the border, leaving the mirror `2 x border`
  too narrow.
- Copy the font/text styles that change glyph advance or wrapping: `fontStyle`,
  `fontWeight`, `fontVariant`, `letterSpacing`, `lineHeight`, `textIndent`, `textTransform`,
  `tabSize`. Omitting `letterSpacing` alone is enough to drift several pixels per line.
- The mirror itself is `position: absolute`, `visibility: hidden`, pinned to the viewport
  origin, and `white-space: pre-wrap` — the wrap mode is what makes it break on the same
  columns a textarea does. (`pre` would never wrap.)
- Only the text **up to the caret** is laid out.
- The cursor marker is a zero-width space, so a caret sitting exactly at the wrap column
  cannot push itself onto the next line and report a whole line too low.
- Subtract `element.scrollTop` / `element.scrollLeft` from the measured point. A caret on a
  scrolled line of a long textarea was previously placed at the _unscrolled_ line's offset.
- The mirror is removed in `finally`, including on throw.

### `showPreview(element, filteredSnippets, cursorPos)`

- Must pass `cursorPos` to `calculatePreviewPosition`. This is the regression that caused the
  bug; the unit tests below pin the helper, the e2e test pins the wiring.

---

## Acceptance Criteria

- [x] `calculatePreviewPosition(textarea, caretOffset)` returns a `y` derived from the caret's
      measured offset, **not** `element.getBoundingClientRect().bottom`.
- [x] With `cursorPos` omitted, the element-bounds fallback still applies.
- [x] A scrolled textarea (`scrollTop > 0`) reports a caret `y` reduced by `scrollTop`.
- [x] The mirror is given the control's font/text metrics, its border-box width together with
      `box-sizing: border-box`, `white-space: pre-wrap`, and only the text up to the caret,
      followed by a zero-width marker.
- [x] e2e: typing `/` into a tall textarea puts the palette near the caret's line, well above
      `textarea.bottom`.

Each criterion is mutation-verified: reverting the corresponding line in
`src/lib/preview-helpers.ts` (or dropping the `cursorPos` argument in `content.ts`) fails the
suite.

## Edge Cases

- Caret at offset 0 with empty value.
- Contenteditable with a collapsed range at a line boundary (`rect.height === 0`): the
  Selection rect is trusted as-is; the flip/clamp logic handles the degenerate box.
- `document.body` absent (early document) — falls back to an approximate offset off the
  element's bottom-right. See "Known gaps".

## Known Gaps

- **Long values in a single-line `<input>` mis-measure.** The mirror wraps at a fixed width
  with `pre-wrap`, while a real `<input>` scrolls horizontally instead of wrapping, so for a
  value long enough to overflow, the mirror's marker lands on a later line and `x` can go
  negative (clamped to the 10px margin). Pre-existing, not introduced here, and not covered by
  a test — happy-dom performs no layout, so it cannot be reproduced in unit tests.
- **A `display: none` / detached control has `offsetWidth === 0`**, collapsing the mirror to
  zero width. Such a control has no on-screen caret, so the result is unused.
- **The mirror is appended, laid out and removed on every keystroke** — two forced layouts per
  keystroke. Pre-existing design; this path was dead before the wiring fix.
- **The `!document.body` fallback is untested** — it cannot be reached from the content script
  (which runs after `DOMContentLoaded`) and `document.body` is not redefinable in happy-dom
  without invasive stubbing. Its return value is unchanged from before this fix.

---

## Dependencies

- `window.getComputedStyle`, `Element.getBoundingClientRect`, `element.offsetWidth`,
  `element.scrollTop` / `scrollLeft`.

## Change History

| Date       | Change                                                     | Author |
| ---------- | ---------------------------------------------------------- | ------ |
| 2026-10-02 | Initial spec — caret anchoring for input/textarea palettes | —      |
