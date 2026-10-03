# 0003 — Preview uses a closed shadow root and `textContent`

**Status:** accepted · **Date:** 2026-09-27

## Context

The snippet preview renders snippet content — which came from an import, a paste,
or a synced device — inside the page's DOM.

The original `init()` created the shadow root with `mode: "open"`, commented
"for E2E test compatibility". An open root is reachable by page script:

```js
document.querySelector("#clipio-snippet-preview-host").shadowRoot.innerHTML
```

## Decision

1. The shadow root is **`mode: "closed"`**. Page script can reach the host element
   but not its contents.
2. Preview content is assigned via **`textContent`**, never `innerHTML`.

## Alternatives considered

**Sanitise the HTML.** The design assumed the preview would render HTML and would
therefore need to strip `data-clipio-*` attributes and cursor markers before
insertion. **It does not** — `createPreviewTooltip` returns a string assigned through
`textContent`, and the closed root means the markup is unreachable anyway. Adding a
sanitiser for a path that does not exist would be theatre.

**Keep the root open for tests.** The tests reach it through the content script's
own handle. A test convenience is not a reason to leave a hole in the page boundary.

## Consequences

Page CSS cannot style the preview, and page script cannot read or click it. E2E
tests must drive the preview the way a user would.

## Revisit when

Never, unless the preview needs to display rich formatting — in which case
`textContent` must be revisited *first*, and sanitisation becomes mandatory rather
than optional.