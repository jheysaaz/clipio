# Spec: Retire `ContentFormat`

> Source: `src/types/index.ts`, `src/components/editor/serialization.ts`, `src/lib/content-format-migration.ts`, `src/storage/backends/*.ts`
> Tests: `src/lib/content-format-migration.test.ts`, `src/components/editor/serialization.test.ts`
> Status: implemented

## Purpose

`ContentFormat` is a vestigial flag from before 1.x that is now an active data-corruption
vector rather than a compatibility feature. This spec retires it.

## Problem

`Snippet.contentFormat` is `"markdown" | "html"`. It is read on exactly one path and honoured
on no path at write time:

- **Read:** `RichTextEditor` deserialises with `deserializeContent(value, contentFormat)`
  (`RichTextEditor.tsx:175`).
- **Write:** the editor always serialises with `serializeToMarkdown` (`:184`), which emits
  markdown unconditionally. `SnippetDetailView.handleSave` spreads `...snippet`
  (`:117-122`), so the incoming `contentFormat` is carried forward onto a body that is now
  markdown.

The result is a reproducible corruption:

1. A snippet has `contentFormat: "html"` and an HTML body.
2. The user opens it. The editor correctly deserialises the HTML.
3. The user saves. The body is written as **markdown**, but the snippet is still labelled
   `contentFormat: "html"`.
4. The user opens it again. `deserializeFromHtml` now runs the **markdown** source through
   `DOMParser` as `text/html`. `<u>` survives as underline; everything else collapses into a
   single text blob and **every line break is destroyed**.

A second, related problem: the content script **ignores** `contentFormat` entirely and always
calls `markdownToHtml`. So an HTML-format snippet never rendered as HTML on insertion — it
appeared as visible escaped text. The flag was already a lie at the one place that mattered
most.

There is also no content schema version, so a v1.4 snippet cannot be migrated to v1.6 except
by guessing from the flag this spec retires.

## Solution

### Convert once, then drop the field

Legacy HTML snippets are converted to markdown **on read**, in `normalizeSnippet`, and the
`contentFormat` field is removed from the result.

### Why the conversion cannot reuse the editor pipeline

The obvious implementation is to reuse the pipeline the product already runs on every HTML
import — `deserializeFromHtml → Plate nodes → serializeToMarkdown`. It was the original plan
here, and it does not work:

**`DOMParser` does not exist in an MV3 service worker.** It is a `ReferenceError` there, and
there is no DOM to parse with. That matters because the background worker is the only context
that outlives a page, and it is the context that owns the content-script cache. A DOM-based
conversion would therefore succeed in the popup and the options page and fail in the
background — so whether a snippet was converted would depend on _which context happened to
read it first_, and the background's cache refresh would overwrite a converted cache with an
unconverted one. The user would see a snippet render correctly once and then insert as raw
markup. That is a worse outcome than a slightly lossy conversion, so it rules the option out
regardless of fidelity.

The migration instead uses one **DOM-free** converter, `htmlToMarkdownPortable`
(`src/lib/html-to-markdown.ts`), in _every_ context. One code path is what makes the result
deterministic; a second converter used only when `DOMParser` happens to be missing would
reintroduce exactly the context-dependent behaviour above.

The editor's `deserializeFromHtml` is unchanged and still used for its own job — opening HTML
in the editor, and the TextBlaze/Power Text importers, all of which run in a page.

The loss profile is therefore _not_ new. TextBlaze and Power Text imports have always been
lossy in exactly this way (`<h2>` → its text, `<ul><li>a</li></ul>` → list items,
table cells → separated by a space rather than concatenated). Applying the same conversion to a
handful of legacy snippets introduces no class of loss the product does not already accept.

Because the field is dropped from the normalised result, the conversion is naturally
idempotent and one-time per snippet: the next read sees no `contentFormat` and does no work.

### The one guard against silent loss

If the conversion yields **empty** content from **non-empty** HTML, the original is preserved
as a `{{raw_html:…}}` placeholder rather than blanked. Losing a user's entire snippet body to a
failed conversion is the one outcome not acceptable here; this is a narrow, principled guard,
not a general lossiness detector.

`{{raw_html:…}}` renders as **escaped literal text** on insertion, so the content is visible
and recoverable rather than being injected as markup.

### Everything else

- `ContentFormat` is removed from the `Snippet` type. `contentFormat` remains an _accepted
  input_ on the import wire, because a v1.x export still carries it.
- The editor always reads and writes markdown. `RichTextEditor`'s `contentFormat` prop is
  removed.
- Exporters stop writing the field.
- The three `normalizeSnippet` copies call the shared migration helper. Consolidating those
  three copies is tracked separately; this spec makes them behave identically.

## Acceptance Criteria

- [x] An HTML-format snippet is converted to markdown on read.
- [x] The converted snippet is re-openable and re-savable without corruption.
- [x] A round trip of a converted snippet is stable (idempotent).
- [x] A conversion that would blank a non-empty body preserves the original as
      `{{raw_html:…}}`.
- [x] `{{raw_html:…}}` renders as escaped text, never as markup.
- [x] The conversion runs in every extension context, including the MV3 service worker,
      so the result does not depend on which context read the snippet first.
- [x] The placeholder's own name survives rendering. This required fixing `_`
      emphasis in `markdownInlineToHtml`, which matched across word boundaries and
      so ate the underscore in `{{raw_html:` — and in any `snake_case` identifier
      the user typed.
- [x] A markdown snippet is untouched by the migration.
- [x] `ContentFormat` is no longer part of the `Snippet` type.
- [x] The editor no longer takes a `contentFormat` prop.
- [x] Exports no longer write `contentFormat`.
- [x] Imports still accept `contentFormat: "html"` on the wire, and convert it.
- [x] A snippet with no `contentFormat` (the normal case) passes through unchanged.

## Edge Cases

- **An empty HTML body** converts to empty markdown. Not a loss, so no placeholder: the guard
  only fires when the source was non-empty and the result is not.
- **A body that is already markdown but labelled `html`** (i.e. a snippet already corrupted by
  the bug above) — converting markdown-as-HTML is lossy. This is the one case the migration
  cannot distinguish from a genuine HTML body, and it is the pre-existing corruption. Such a
  snippet is best recovered from the IndexedDB shadow backup, which is why that backup exists.
  The migration does not make it worse.
- **`contentFormat: "html"` with plain text** (no tags): converts to the same plain text.
- **An `html` snippet with a `{{raw_html:…}}` placeholder already in it**: the placeholder
  survives as text; it is not re-converted.

- **Malformed or truncated markup** — a body ending in an unterminated tag (`<!`, `<?`,
  `<script>x<a`). The tag is discarded and the rest of the input is consumed, which is what a
  browser's parser does. This case is called out because it is the one that can break the
  _scanner_ rather than the output: the conversion runs on the read path, inside the service
  worker, on every read, so a converter that does not terminate hangs the worker and stops the
  cache refresh for every snippet, not just the malformed one. Two defects of exactly this shape
  occurred during implementation (a quadratic tag regex, then an infinite loop on an
  unterminated `<!`), so the scanner has regression tests for non-termination as well as for
  output.
- **A body that is a bare `<` or `>` or a stray `<` mid-prose** — treated as literal text.

## Non-Goals

- Recovering snippets already corrupted by this bug. That is a data-recovery task, not a
  migration one.
- Improving HTML-to-markdown fidelity generally. `htmlToMarkdownPortable` handles the
  constructs a legacy snippet body realistically contains and keeps the text of anything
  else; making it a general converter is a much larger piece of work and would need its own
  spec.
- A full markdown block grammar (nested lists, reference links, fenced code, headings as
  blocks). That is a separate Wave 10 item.
- Consolidating the three `normalizeSnippet` copies, which is a Wave 6 item.

## Change History

| Date       | Change                                                                                                                                                                                                                                        | Author |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2026-09-26 | Initial spec                                                                                                                                                                                                                                  | —      |
| 2026-09-27 | Implementation found the DOM-based editor pipeline unusable in the MV3 service worker; replaced with a DOM-free converter (see Solution). Also fixed `_` emphasis in `markdownInlineToHtml`, which was corrupting the placeholder's own name. | —      |
