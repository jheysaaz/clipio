# Module: Preview Privacy

> **Rewritten 2026-09-27.** This spec previously described
> `src/lib/preview-privacy.ts` and a `sanitizeForPreview(html)` function.
> **Neither exists** — verified by grep. The spec had drifted to the point of
> describing a module that was never in the tree, and a test file that named it
> (`preview-privacy.test.ts`, five of six tests decorative) was deleted in the
> same wave that corrected this document.
>
> The concern it described is real, but it is enforced elsewhere, in two places.

## Where preview privacy actually lives

### 1. The preview renders text, never HTML

`src/lib/snippet-preview-ui.ts` builds every visible string with `textContent`, and the row
content comes from `createPreviewTooltip(content)`
(`src/lib/preview-helpers.ts`), which returns **plain text** after
`markdownToPlainText` plus a strip of every remaining `{{…}}` token.

So there is nothing to sanitise: no HTML is ever constructed from snippet content, which is a
stronger guarantee than sanitising HTML would be. A snippet body containing
`<img src=x onerror=alert(1)>` renders as that literal text.

### 2. The host element mirrors only non-content attributes

The preview lives in a **closed** shadow root (`mode: "closed"`), so page script cannot read it
at all. For the e2e suite — which shares a JS world with the extension — the host mirrors three
attributes and nothing else:

| Attribute               | Discloses                   |
| ----------------------- | --------------------------- |
| `data-preview-visible`  | whether the preview is open |
| `data-preview-rows`     | how many rows there are     |
| `data-preview-selected` | which row is highlighted    |

Never a label, shortcut, or content. `specs/preview-encapsulation.spec.md` covers the
encapsulation itself and includes a test asserting the host's `outerHTML` contains no snippet
label or shortcut.

## Why there is no `sanitizeForPreview`

The original design assumed the preview would render snippet content as HTML, which would have
required stripping `data-clipio-*` attributes and cursor markers before insertion. It does not:
`createPreviewTooltip` returns a string that is assigned via `textContent`, and a closed shadow
root means the markup is not reachable. Adding a sanitiser for a path that does not exist would be
theatre.

## Related

- `specs/preview-encapsulation.spec.md` — closed shadow root, mirrored attributes, a11y.
- `specs/snippet-preview.spec.md` — preview behaviour and triggering.
- `specs/content-security.spec.md` — `isTrusted` checks and the clipboard read surface.

## Change History

| Date       | Change                                                                                   | Author |
| ---------- | ---------------------------------------------------------------------------------------- | ------ |
| 2026-09-26 | Initial spec — described a module and function that never existed                        | —      |
| 2026-09-27 | Rewritten to describe the text-only rendering and closed root that actually enforce this | —      |
