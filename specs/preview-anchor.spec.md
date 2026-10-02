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

- Clamps `cursorPos` into `[0, element.value.length]`. A stale offset must not throw.
- The mirror must reproduce the control's **content box**, not its border box:
  `boxSizing: border-box` + `width: element.clientWidth`, so wrapped text breaks at the same
  columns the control does. Copying `border` on top of a content-box `width` (the previous
  behaviour, via `style.width`) made the mirror wider than the field and shifted the caret
  measurement horizontally on narrow fields.
- Copy the font/text styles that change glyph advance or wrapping: `fontStyle`,
  `fontVariant`, `letterSpacing`, `textTransform`, `textIndent`, `tabSize`. Omitting
  `letterSpacing` alone is enough to drift by several pixels per line.
- Subtract `element.scrollTop` / `element.scrollLeft` from the measured point. A caret on a
  scrolled line of a long textarea was previously placed at the *unscrolled* line's offset.
- The cursor marker is a zero-width space, so a caret sitting exactly at the wrap column
  cannot push itself onto the next line and report a whole line too low.
- The mirror is removed in `finally`, including on throw.

### `showPreview(element, filteredSnippets, cursorPos)`

- Must pass `cursorPos` to `calculatePreviewPosition`. This is the regression that caused the
  bug; the unit tests below pin the helper, the e2e test pins the wiring.

---

## Acceptance Criteria

- [ ] `calculatePreviewPosition(textarea, caretOffset)` returns a `y` derived from the caret's
      measured offset, **not** `element.getBoundingClientRect().bottom`.
- [ ] With `cursorPos` omitted, the element-bounds fallback still applies.
- [ ] `cursorPos` beyond `value.length` (stale offset) does not throw and still anchors.
- [ ] A scrolled textarea (`scrollTop > 0`) reports a caret `y` reduced by `scrollTop`.
- [ ] The caret-marker span itself does not change the measured x (zero-width marker).
- [ ] e2e: typing `/` into a tall textarea puts the palette near the caret's line, within a
      few px of `textarea.top`, and far above `textarea.bottom`.

## Edge Cases

- Caret at offset 0 with empty value.
- Single-line `<input>` (no wrapping) — must behave like the textarea case.
- Contenteditable with a collapsed range at a line boundary (`rect.height === 0`): the Selection
  rect is trusted as-is; positioning/flip logic handles the degenerate box.
- `document.body` absent (tests / early document) — falls back to an approximate offset.

---

## Dependencies

- `window.getComputedStyle`, `Element.getBoundingClientRect`, `element.clientWidth`,
  `element.scrollTop` / `scrollLeft`.

## Change History

| Date       | Change                                                          | Author |
| ---------- | --------------------------------------------------------------- | ------ |
| 2026-10-02 | Initial spec — caret anchoring for input/textarea palettes      | —      |