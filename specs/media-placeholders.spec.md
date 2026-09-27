# Wave 6 — one media-placeholder parser

## Problem

The `{{image:<id>[:<width>]}}` and `{{gif:<id>[:<width>]}}` placeholders are matched by **17
hand-retyped regular expressions across 9 modules**, in three genuinely incompatible flavours.

| Flavour                       | Where                                                                                                                                                    | Behaviour                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| strict id + optional width    | `serialization.ts:22-23`, `markdown.ts:66,80`, `ImagesSection.tsx:88`, `exporters/clipio.ts:73,84`, `copyMarkdownAsRichText.ts:26`, `content.ts:388-390` | correct                                                          |
| **no width support**          | `SnippetListItem.tsx:23-24`                                                                                                                              | **resized media renders as raw placeholder text in the sidebar** |
| loose `[^}]+`, no width group | `content-helpers.ts:259,265,280,284`                                                                                                                     | the "id" capture can include `:200`                              |

### The user-visible bug

`SnippetListItem` uses `/\{\{image:[a-f0-9-]+\}\}/g` — no `(?::\d+)?`. So a snippet containing
`{{image:abc-123:200}}`, which is what the editor writes the moment a user resizes an image, is
**not** recognised in the sidebar list and the raw placeholder is shown as literal text next to
the snippet label. The same applies to `{{gif:…:200}}`.

This is not cosmetic. A user resizes an image, and the snippet list starts displaying
`{{image:3f2a…:200}}` at them.

### The subtler one

`content-helpers.ts` matches `/\{\{image:[^}]+\}\}/g` and uses the whole capture as the media id.
For a resized reference that capture is `abc-123:200`, so a lookup by id **cannot match** — the
media is treated as absent. Whether that is currently harmless depends on the call site, which is
exactly the problem with four flavours: nobody can tell.

## Solution

One module, `src/lib/media-placeholders.ts`, owning:

- the two id charsets, named and commented once (image ids are `crypto.randomUUID()` → lowercase
  hex and dashes; GIF ids come from the Giphy API → alphanumeric);
- an **anchored** pattern per kind, for scanning at a position, and a **global** pattern per kind,
  for finding all of them. Making the distinction explicit removes the current situation where a
  caller has to know which of the 17 copies is which;
- a `parseMediaPlaceholder` returning `{ kind, id, width }`, with `width` a number or `null`, so
  no caller has to remember that group 2 exists;
- `formatImagePlaceholder` / `formatGifPlaceholder` for the two places that _build_ placeholders,
  which currently format them by hand;
- `hasMediaPlaceholder`, `stripMediaPlaceholders`, and `extractMediaRefs` for the three shapes
  that are re-derived at each call site.

Capture groups are then consistent everywhere: **group 1 is always the id**, so a width suffix can
never end up inside an id.

## Acceptance Criteria

- [x] Exactly one definition of each placeholder pattern exists. Fifteen of the 17 are gone;
      the two that remain are a different shape, recorded below.
- [x] `SnippetListItem` recognises width-suffixed references, so a resized image no longer shows
      as raw text in the sidebar. Pinned by 4 tests, verified sensitive by restoring the old
      hand-typed no-width regex.
- [x] `content-helpers` no longer captures `:200` as part of an id. Its four `[^}]+` regexes
      collapsed into one local `resolveMediaPlaceholders` helper built on the shared patterns.
- [x] Anchored vs global is explicit at every call site rather than accidental.
- [x] `width` is a number or `null` everywhere — no string widths.
- [x] Every new test is mutation-sensitive. Three mutations run against the module, each caught:
      removing the optional `:width` group (6 tests), letting the id capture swallow the width
      (3 tests), and — verified as a no-op first — a shared `g` regex carrying `lastIndex` between
      calls, which the module avoids by constructing fresh. Every migrated call site kept its
      existing tests green.
- [x] `pnpm compile`, `pnpm lint`, `pnpm test` (1418), the coverage gate, and both builds are
      green. `pnpm test:e2e` runs at wave end.
- [x] The suite's pass count does not drop: this is consolidation, not deletion.

## What deliberately remains duplicated

Two regexes survive, and they are **not** matchers:

- `serialization.ts:32` and `markdown.ts:170` are `nextSpecial` scanners — alternations of
  _prefixes_ (`\{\{image:`, `\{\{gif:`, …) used to skip ahead to the next position worth
  examining, as an O(n) optimisation. They cannot be derived from the full patterns without
  contorting them, and they are a different concern from matching.

  Worth recording though: **the two lists are not the same.** `serialization.ts` also scans for
  `{{clipboard}}`, `{{date:`, `{{cursor}}` and `{{datepicker:`, while `markdown.ts` scans only for
  `{{image:` and `{{gif:`. So the two scanners disagree about which placeholders are worth
  stopping for. Whether that is a live bug depends on the non-media placeholder handling in each,
  which belongs with the markdown block-grammar work (Wave 10) rather than here.

## Edge Cases

- **An id that is not a UUID.** The e2e suite seeds ids like `e2e-alt-test-123`, which the strict
  charset does not match. That is fine for images, whose ids are always `crypto.randomUUID()`, but
  it means the parser must not be widened casually: `{{image:whatever}}` becoming an `<img>` with
  a broken source is worse than it staying literal text. The charsets stay as they are, and the
  comment records why.
- **`{{image:}}` with an empty id** matches neither charset, so it stays literal. Correct: it is
  not a reference to anything.
- **Uppercase hex.** `crypto.randomUUID()` is lowercase, but an id round-tripped through a
  case-insensitive system could arrive uppercase. Both cases are accepted so a cosmetic difference
  cannot orphan a user's image.
- **A width of `0` or a huge number.** Parsed as a number, not validated against a maximum. The
  renderer already clamps with CSS, and adding a limit here would mean two places deciding what a
  valid width is.
- **Callers that only need a boolean** must use `hasMediaPlaceholder` rather than `.test()` on a
  raw regex, so the charset lives in one place.

## Non-Goals

- Media-ref _deduplication_ semantics, which differ per call site (the exporter dedupes, the
  clipboard path does not, the Images section builds a reverse map). Unifying the four
  extractions is a separate step; this wave unifies the _matching_.
- The three `markdownToPlainText`-style stripping variants, and the `normalizeSnippet` copies.
  Also separate steps in this wave.

## Change History

| Date       | Change       | Author |
| ---------- | ------------ | ------ |
| 2026-09-27 | Initial spec | —      |
