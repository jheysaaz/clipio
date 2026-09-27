# Spec: Untrusted Event Rejection in the Content Script

> Source: `src/entrypoints/content.ts`
> Regression tests: `src/lib/content-script-trust.test.ts`
> E2E: `e2e/content-script.spec.ts`
> Status: implemented

## Problem

The content script's `input` and `keydown` listeners are registered on `document` in the
**capture** phase. They accept any event that reaches them, and they never inspect
`Event.isTrusted`. `isTrusted` appears zero times in `src/` and zero times in `e2e/`.

A Chrome isolated world shares the DOM event graph with the page. The page's JS cannot
construct a trusted event, but it can dispatch a synthetic one, and that event **is**
delivered to isolated-world listeners with `isTrusted === false`.

The result is that the page can drive the extension's own legitimate code paths:

1. `registerRuntimeListeners` (`content.ts:1192`) registers the capture-phase listeners.
2. `handleKeyDown` (`content.ts:731`) matches a shortcut on `Space`/`Tab` and calls
   `expandSnippet` with no check on event provenance.
3. `expandSnippet` → `processSnippetContent` (`content-helpers.ts:181`) → when the snippet
   contains `{{clipboard}}`, `readClipboardText()` (`content.ts:356-366`) runs
   `document.execCommand("paste")` into a hidden textarea in the shared DOM.
4. `expandSnippet` writes the result into the event target, which the page owns.

Clipboard read is gated on transient user activation. The page obtains that activation
from *any* prior genuine interaction with the site — a click, an ad click, a scroll
gesture. Once the user has touched the page, the paste succeeds and clipboard contents
land in an attacker-controlled field.

Without the clipboard placeholder the page can still force arbitrary snippet content into
any `input`, `textarea`, or `contenteditable` on the page, and can force the preview
palette to open and auto-insert on a synthetic `Enter`.

## Solution

Reject any event that was not produced by the user agent, at the point where
page-controlled events enter the extension.

`Event.isTrusted` is a read-only UA-set property and cannot be forged by page script:
constructing a synthetic event always yields `isTrusted === false`.

Guards are applied at the **two capture-phase listener registrations** rather than inside
each handler. Those two registrations are the single trust boundary between the page and
every handler beneath them, so one guard each covers `handleInput`,
`handleContentEditableInput`, `handleKeyDown`, `handlePreviewKeyboard`, and the manual
preview-shortcut branch, including the preview `onSelect` insertion path.

`focusout` is deliberately **not** guarded: it only clears a pending debounce timer and
hides the preview. A page suppressing it can at worst cancel its own expansion.

## Acceptance Criteria

- [x] A synthetic (untrusted) `input` event on an `input`/`textarea` does **not** expand a
      snippet, does **not** update the preview, and does **not** arm the expansion timer.
- [x] A synthetic `keydown` with `key: " "` on a field whose text ends in a valid shortcut
      does **not** expand a snippet and does **not** call `preventDefault()`.
- [x] A synthetic `keydown` matching the configured preview shortcut (`Ctrl+Shift+Space`)
      does **not** open the preview palette and does **not** call `preventDefault()`.
- [x] A synthetic `input` event on a `contenteditable` does **not** expand a snippet.
- [x] A **trusted** event of the same shape still behaves exactly as before. This is the
      regression guard: the fix must not disable the extension.
- [x] `preventDefault()` is called only for trusted events, so a page dispatching a
      synthetic `Space` in a form cannot swallow the page's own default action.

## Edge Cases

- **A page that dispatches a synthetic `focusout` before the debounce fires** cancels the
  expansion. Accepted: it degrades the extension, it does not escalate it, and guarding
  it would break legitimate blur handling.
- **Playwright's `page.keyboard.press` and `page.type` produce trusted events.** The
  existing e2e suite therefore needs no change. Verified: `dispatchEvent` appears zero
  times in `e2e/`.
- **Genuinely trusted programmatic events.** No production code path calls
  `dispatchEvent` on `document`, so nothing inside the extension is affected.
- **`event.isTrusted` is `false` in happy-dom for all synthetic events and is not
  modelled for dispatched-but-trusted cases.** The unit tests drive the real listener
  function with an explicit `isTrusted` value so both branches are covered.

## Non-Goals

- Closing the preview shadow root so page JS cannot read the snippet library. Tracked
  separately; `mode: "open"` is currently a deliberate test affordance.
- Enforcing `blockedSites` on the preview-shortcut path. Tracked separately — that path
  genuinely lacks the `isBlocked` check its siblings have.

## Change History

| Date       | Change                          | Author |
| ---------- | ------------------------------- | ------ |
| 2026-09-26 | Initial spec                    | —      |
