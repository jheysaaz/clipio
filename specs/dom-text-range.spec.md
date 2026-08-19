# Module: DOM Text Range

> Source: `src/lib/dom-text-range.ts`
> Coverage target: 85%

## Purpose

Resolves the caret position inside editable DOM elements to a *global* text
offset so trigger detection works in fields with multiple text nodes.

## Scope

**In scope:** Caret-offset and text-range resolution in `contenteditable` /
`textarea` / `input` elements.
**Out of scope:** Trigger detection, preview rendering, snippet matching.

---

## `getCaretTextOffset(element): number`

**Behavior:**

- Returns the number of text characters in `element.textContent` that precede
  the caret (a global offset, not `Selection.focusOffset`, which is *local* to
  the focused text node).
- Uses `Range.selectNodeContents(element)` + `Range.setEnd(focusNode,
  focusOffset)` and measures `cloneContents().textContent.length`.

**Edge cases:**

- No selection / out-of-element focus node: returns `0`.
- DOM mutation during range operations: returns `element.textContent?.length`.

---

## Known Limitations (persisting bug)

The automated suite passes for plain contenteditable fields (see
`e2e/contenteditable-multinode.spec.ts`), but the original user-facing bug
persists in **real rich-text editors** (e.g. Gmail, Notion, editors that
manage their own selection):

- **Caret placed at the start of the inserted snippet**: after the fragment is
  inserted and the content script places the caret at its end via
  `Selection.addRange()`, the host editor's own selection-management code
  re-aligns the caret to the start of the new block on the next render/input
  cycle, overriding the placement.
- **Confetti not visible**: the celebration canvas is appended to
  `document.documentElement` at `z-index: 314159`. Host editors/sites that
  render fixed/sticky chrome above that stacking context can occlude the
  particles even though the canvas itself is created and painted.
- **Preview not opening with existing text**: resolved for the plain
  contenteditable path (`getCaretTextOffset` replaces the node-local
  `focusOffset`; the Ctrl+Shift+Space shortcut now always opens the list).
  It may still fail in editors that intercept keydown/input before the
  document-level capture listeners run.

**Diagnosis:** these are environment-specific interactions rather than bugs in
`dom-text-range` itself; the module's offset math is verified correct by its
unit tests and the E2E suite. Reproducing the remaining behavior requires a
fixture host editor that re-implements browser selection management (or a
reproduction Gmail/Notion session).

---

## Error Handling

- Wraps `Range` construction in `try/catch`; never throws.
- Invalid input: returns `0`.

---

## Dependencies

- None (browser DOM APIs only).

---

## Change History

| Date       | Change                                              | Author    |
| ---------- | --------------------------------------------------- | --------- |
| 2026-08-19 | Initial spec (fixes multi-node preview trigger bug) | —         |