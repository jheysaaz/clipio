# Spec: Preview UI Encapsulation

> Source: `src/lib/snippet-preview-ui.ts`
> Tests: `src/lib/snippet-preview-ui.accessibility.test.ts`, `e2e/content-script.spec.ts`, `e2e/blocked-sites.spec.ts`
> Status: implemented

## Purpose

The snippet preview palette renders snippet labels, shortcuts and content previews into the
host page's DOM. It is the one part of the extension that a hostile page can read directly.
This spec closes that read surface.

## Problem

### 1. The shadow root is `mode: "open"`

`init()` created the root with `mode: "open"`, with the comment _"for E2E test
compatibility"_. An open root is reachable by page script:

```js
document.querySelector("#clipio-snippet-preview-host").shadowRoot.textContent; // every snippet label and shortcut
```

Combined with the untrusted-event work (`specs/content-script-trust.spec.md`), a page could
read every shortcut, force an expansion, and — for a `{{clipboard}}` snippet — obtain the
user's clipboard.

### 2. The hover tooltip renders _outside_ the shadow root entirely

This is the part that closing the root alone would **not** fix. `init()` did:

```ts
document.body.appendChild(this.shadowHost);
document.body.appendChild(this.tooltip);
```

`showTooltip` then wrote `createPreviewTooltip(snippet.snippet.content)` into
`this.tooltip.textContent` — real snippet content, in a plain `<div>` in `document.body`.
Page script could read it with a single `document.body.textContent` lookup, with no shadow
traversal at all. The `<all_urls>` content script and a `clipboardRead` permission make
that a genuine disclosure surface.

## Solution

### Closed root, tooltip inside it

- `attachShadow({ mode: "closed" })`. Page-world `host.shadowRoot` becomes `null`.
- The tooltip is appended to the **shadow root** rather than `document.body`, so snippet
  content is no longer in the light DOM at all.

**Stacking is preserved.** The host is `position: fixed` with `z-index: 2147483647`, and
it establishes a stacking context. Inside that context the container
(`z-index: 2147483647`) and the tooltip (`z-index: 2147483648`) compare against each other
normally, so the tooltip still paints above the list. The old code kept the tooltip in
`document.body` because `2147483648` clamps to `2147483647` in the _page's_ stacking
context, making DOM order decisive; that constraint disappears once both live inside the
host. `position: fixed` on the tooltip still resolves against the viewport, since neither
the host nor the root has a transform, filter or `contain`.

### Observable state for e2e

Playwright's CSS engine pierces **open** shadow roots only, so a closed root makes the
palette unassertable from the page world. Rather than weaken the encapsulation, the host mirrors
three attributes:

- `data-preview-visible="true" | "false"`
- `data-preview-rows="0" | "1" | "many"`
- `data-preview-selected="<index>"`

**Exactly what this discloses:** whether the palette is open, a _bucketed_ row count, and
which row index is highlighted. Never a label, a shortcut, or snippet content.

The count is a bucket rather than a number on purpose. The palette opens either on a `/`
query (a filter over the library) or on the manual shortcut, which lists _every_ snippet —
so an exact count would disclose the size of the user's whole library. Worse, it would be
an oracle: a page that owns a field can type prefixes and read the count after each genuine
keystroke to work out which shortcuts exist. `0`/`1`/`many` is sufficient for the e2e
assertions, which are about whether the palette opened and whether filtering narrowed the
result set.

### Internal accessor for the accessibility unit test

The a11y suite renders the real `SnippetPreviewUI` and asserts real ARIA on real nodes. It
runs in the _same_ JS world as the extension code, so it can use a documented `@internal`
accessor. This is safe: an isolated world cannot be reached from the page at all, so an
internal method on the class is not a page-facing surface. The closed root protects against
_page_ script; extension code and its tests are unaffected.

## Acceptance Criteria

- [x] `host.shadowRoot` is `null` from page-world script.
- [x] The snippet library is not present anywhere in the page DOM. Verified by asserting a
      known unique label and shortcut string appears nowhere in `document.body.textContent`.
- [x] The tooltip element is a descendant of the shadow root, not of `document.body`.
- [x] A hover tooltip's content is not readable from the page world.
- [x] `data-preview-visible` reflects show/hide, and is published by `init()` so a palette
      that has never been shown is distinguishable from one that never ran.
- [x] `data-preview-rows` is a bucket, not the exact library size.
- [x] `data-preview-selected` tracks arrow-key navigation and clamps at the last row.
- [x] The palette still renders and is still navigable with the keyboard, verified through
      the a11y unit suite (real ARIA: `role=listbox`, `aria-activedescendant`,
      `aria-selected`, `aria-live`).
- [x] The row-click `isTrusted` guard rejects a synthetic click. Reachable only as a unit
      test via the internal accessor, since the closed root means page script cannot reach
      a row; see Non-Goals.
- [x] Trusted `Enter` on a highlighted row still inserts a snippet.
- [x] Blocked hosts still render nothing.

## Edge Cases

- **`host.shadowRoot` is `null` in the page world but not in the extension world.** Any
  test or debug tooling that must introspect the palette has to run as extension code.
- **Closed roots cannot be re-opened.** Once closed, there is no supported way to recover
  the root, so the internal accessor is the only path and it is `@internal` by contract.
- **Existing e2e selectors that pierced the root** (`.clipio-preview-item`) no longer
  resolve from the page world. Those assertions are rewritten against
  `data-preview-visible`, which is sufficient for "did the palette open" and "did it stay
  closed" — the questions the security tests actually ask.
- **A page that dispatches events at the host** still cannot reach the rows: events
  retarget to the host, and the row handlers are inside a closed root.

## Non-Goals

- Removing the row-click `isTrusted` guard. It is retained as defence in depth, and it is
  covered by a unit test rather than an e2e one: the closed root means page script has no
  handle on a row at all, which is the intended outcome. The unit test pins the guard for
  the case where the root is ever reopened.
- Rendering the palette as a `chrome-extension://` iframe. That would be a larger
  architectural change and is not needed once the root is closed.

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-09-26 | Initial spec | —      |
