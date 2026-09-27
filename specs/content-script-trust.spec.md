# Spec: Untrusted Event Rejection in the Content Script

> Source: `src/entrypoints/content.ts`, `src/lib/snippet-preview-ui.ts`
> Tests: `e2e/content-script.spec.ts` (describe: "Untrusted event rejection")
> Coverage target: N/A — covered end-to-end; see "Why e2e" below
> Status: implemented

## Problem

The content script's `input` and `keydown` listeners are registered on `document` in the
**capture** phase. They accept any event that reaches them, and they never inspect
`Event.isTrusted`. `isTrusted` appears zero times in `src/` and zero times in `e2e/`.

A Chrome isolated world shares the DOM event graph with the page. The page's JS cannot
construct a trusted event, but it can dispatch a synthetic one, and that event **is**
delivered to isolated-world listeners with `isTrusted === false`.

The result is that the page can drive the extension's own legitimate code paths:

1. `registerRuntimeListeners` (``registerRuntimeListeners``) registers the capture-phase listeners.
2. `handleKeyDown` (``handleKeyDown``) matches a shortcut on `Space`/`Tab` and calls
   `expandSnippet` with no check on event provenance.
3. `expandSnippet` → `processSnippetContent` (`content-helpers.ts:181`) → when the snippet
   contains `{{clipboard}}`, `readClipboardText()` (``readClipboardText``) runs
   `document.execCommand("paste")` into a hidden textarea in the shared DOM.
4. `expandSnippet` writes the result into the event target, which the page owns.

Clipboard read is gated on transient user activation. The page obtains that activation
from _any_ prior genuine interaction with the site — a click, an ad click, a scroll
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

Guards are applied at the **two capture-phase listener registrations** in
`registerRuntimeListeners` rather than inside each handler. Those two registrations are the
single trust boundary between the page and every handler beneath them, so one guard each
covers `handleInput`, `handleContentEditableInput`, `handleKeyDown`,
`handlePreviewKeyboard`, and the manual preview-shortcut branch.

A **third** guard is required and lives in `SnippetPreviewUI.updateList`: the per-row
`click` handler. The shadow root is `mode: "open"` and the host element is in the page
DOM, so once the user legitimately opens the preview, page script can
`querySelector(".clipio-preview-item").click()` and reach `onSelect` →
`handlePreviewSnippetSelection` → `insertSnippetIn*`. Without that guard, opening the
preview re-opens the exact exfiltration path this spec exists to close.

`focusout` is deliberately **not** guarded: it only clears a pending debounce timer and
hides the preview. A page suppressing it can at worst cancel its own expansion.

## Acceptance Criteria

- [x] A synthetic (untrusted) `input` event on an `input`/`textarea` does **not** expand a
      snippet, does **not** render any preview row, and does **not** arm the expansion timer.
- [x] A synthetic `keydown` with `key: " "` on a field whose text ends in a valid shortcut
      does **not** expand a snippet and does **not** call `preventDefault()`.
- [x] A synthetic `keydown` matching the configured preview shortcut (`Ctrl+Shift+Space`)
      does **not** open the preview palette, does **not** render any row, and does **not**
      call `preventDefault()`.
- [x] A synthetic `input` event on a `contenteditable` does **not** expand a snippet.
- [x] A synthetic `keydown` on a `contenteditable` does **not** expand a snippet.
- [x] A synthetic `click` on a preview row does **not** insert a snippet, **even when the
      user has legitimately opened the preview with trusted input**.
- [x] A **trusted** event of the same shape still behaves exactly as before. This is the
      regression guard: the fix must not disable the extension.
- [x] `preventDefault()` is called only for trusted events, so a page dispatching a
      synthetic `Space` in a form cannot swallow the page's own default action.

## Why these are e2e tests and not unit tests

Cross-context event delivery is the thing under test. Chrome's isolated world shares the
DOM event graph with the page, and that behaviour only exists in a real browser —
happy-dom does not model isolated worlds, so a unit test would exercise the handler
function in isolation and would not prove the boundary holds. Playwright's
`keyboard.type` / `keyboard.press` produce trusted events; `page.evaluate` +
`dispatchEvent` produce untrusted ones, which is exactly the distinction under test.

Consequently there is no `src/lib/content-script-trust.test.ts`, and the `isUserGesture`
branch in `content.ts` is not unit-covered. That is a deliberate trade, not an oversight:
`content.ts` is a side-effectful WXT entrypoint excluded from unit coverage, and the
behaviour is only observable across the context boundary.

## Edge Cases

- **A page that dispatches a synthetic `focusout` before the debounce fires** cancels the
  expansion. Accepted: it degrades the extension, it does not escalate it, and guarding
  it would break legitimate blur handling.
- **Playwright's `page.keyboard.press` and `page.type` produce trusted events.** The
  pre-existing e2e suite therefore needed no change, and all 115 tests that existed before
  this work still pass.
- **The extension dispatches its own synthetic `input`/`change` events after a successful
  insertion** (to notify the host app). Those are untrusted and are now rejected by the
  guard, which is correct — but it means the `justExpanded` flag is no longer consumed by
  the listener round-trip. It is therefore cleared explicitly immediately after each
  `dispatchEvent` in `expandSnippet` and `expandSnippetInContentEditable`.
  `insertSnippetInInput` sets the flag **without** dispatching, and there the flag is
  deliberately left set so the next genuine input consumes it, preventing the freshly
  inserted content from immediately re-triggering expansion.
- **Negative tests wait a bounded time (600 ms) before asserting nothing happened.** That
  margin is tied to `TIMING.TYPING_TIMEOUT` (300 ms); if that constant changes, these waits
  must be revisited.

## Non-Goals

None outstanding. Both items originally listed here are done:
`specs/blocked-sites.spec.md` (the `isBlocked` gap on the preview-shortcut path) and
`specs/preview-encapsulation.spec.md` (the closed shadow root and the tooltip move).

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-09-26 | Initial spec | —      |
