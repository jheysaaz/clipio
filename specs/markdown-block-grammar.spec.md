# Spec: markdown block grammar (Wave 10)

spec: src/components/editor/serialization.ts
status: implemented (markdown path); HTML converter still lossy — see Non-Goals

## Problem

The editor's markdown layer has **no block grammar**. `deserializeFromMarkdown`
(`serialization.ts:155`) splits the source on `/\n/` and wraps every single line in
`{type:"p"}`, and `serializeNode` (`:41`) flattens every element to its children's text with no
block marker. So any block structure in a snippet is destroyed on the first open/save cycle.

The failures are not all equally bad, and the distinction matters for what gets fixed first:

### Corruption — the text itself changes meaning

- **Tables lose their cell separator entirely.** `<td>a</td><td>b</td>` serialises to `"ab"`.
  Two cells become one run of text. There is no way to recover the split.
- **Fenced code gets inline markdown applied to its interior.** A code block containing
  `**x**` or a `{{date:…}}` token is rewritten as if it were prose, so the stored snippet
  silently stops being the code the user pasted.
- **`{{image:id:0}}` loses its width.** `serialization.ts:91` and `:97` use `width ? … : …`, and
  `0` is falsy, so a zero width is dropped. `src/lib/media-placeholders.ts` already has
  `formatImagePlaceholder`, which distinguishes `undefined` from `0` correctly — Wave 6 built the
  right function and did not route this call site through it.
- **`&amp;` becomes `&amp;amp;` on every insertion**, compounding each cycle.
- **Nested link text duplicates its URL.** `[see [1]](http://x)` →
  `[see [1](http://x)](http://x)`, so the URL becomes visible text after one cycle.
- **Adjacent marks scramble.** `{bold, code}` → ``**`x`**`` → re-parsing destroys the code mark.
  `{bold, strikethrough}` → `~~**x~~**`, which re-parses as different marks.

### Formatting loss — structure is gone but the text survives

- Headings: `<h2>T</h2>` → `"T"`. The `##` is gone.
- Lists: `<ul><li>a</li><li>b</li></ul>` → `"a\nb"`, which is indistinguishable from two
  paragraphs and re-parses as two paragraphs.
- `<hr>` vanishes completely.

## Solution

A real block grammar on both directions.

**Deserialise** — a line-oriented block scanner that recognises, in this order: fenced code,
ATX headings, thematic breaks, block quotes, GFM tables, unordered and ordered lists (with
indentation for nesting), and paragraphs as the fallback. Inline parsing stays where it is and is
applied to the _content_ of each block, never to a fence interior.

**Serialise** — emit the matching marker for each block type, so a round trip is stable.

**Route the media placeholders** through the existing shared formatters, which fixes the `0` width.

## Acceptance Criteria

Round-trip: for each construct, `serialize(deserialize(md))` must equal `md` after normalising
trailing whitespace, and `deserialize(serialize(nodes))` must preserve the block structure.

- [ ] `# H1` … `###### H6` survive a round trip as headings, not paragraphs.
- [ ] `---`, `***` and `___` on their own line become a thematic-break block and survive.
- [ ] A fenced code block keeps its language and its interior **verbatim** — `**x**`,
      `{{date:iso}}` and `_y_` inside a fence must come back unchanged and unmarked.
- [ ] An unterminated fence is treated as running to end of input rather than being dropped.
- [ ] `- a` / `* a` / `+ a` become list items; `1. a` becomes an ordered item.
- [ ] Nested lists keep their nesting via indentation.
- [ ] A list item spanning a blank line (loose list) does not silently merge paragraphs.
- [ ] `> quoted` becomes a block quote and survives.
- [ ] A GFM table keeps its pipes **and** its delimiter row, so two cells never become one.
- [ ] A pipe character inside inline code in a table cell does not split the cell.
- [ ] Paragraph fallback is unchanged for text with no block markers.
- [ ] `{{image:id:0}}` keeps its `:0`; `{{image:id}}` gains no width.
- [ ] Placeholders inside a fence are **not** converted to placeholder elements.
- [ ] Empty and whitespace-only input still yields exactly one empty paragraph.
- [ ] A line that looks like a list marker mid-paragraph (`a - b`) is not a list.

## Edge Cases

- **Fence inside a list item** — the fence must win over the list, and its indentation must be
  stripped once.
- **A fence opened with more backticks than it is closed with** does not close, per CommonMark.
- **Table with fewer delimiter cells than header cells** — pad, do not drop cells.
- **A `|` with spaces around it inside a cell** (escaped `\|`) is literal, not a separator.
- **Setext headings** (`Title\n=====`) are recognised on the deserialise side; the serialiser emits
  ATX, and the spec says so rather than pretending both forms are preserved.
- **CRLF input** is normalised to LF before scanning.
- **A `#` with no space after it** (`#tag`) is not a heading — it is a paragraph. This one matters:
  snippets are full of `#channel` and `#1`.
- **Indentation of 4+ spaces** is a code block in CommonMark. Treated as a paragraph here, because
  snippet content is frequently indented by accident and silently becoming a code block would be
  worse. Documented as a deliberate divergence.
- **Very deeply nested lists** must not blow the stack; nesting is capped and the excess is
  flattened to the cap rather than recursing further.

## What this does NOT fix: the HTML converter

While building this, the constructs above were re-checked against `htmlToMarkdown`
(`serialization.ts:135`) — the _other_ direction, used by the content script and the legacy
`contentFormat` migration. That function has the same class of loss, and none of it is fixed here:

| Input HTML                                     | `htmlToMarkdown` produces       | Consequence                                                         |
| ---------------------------------------------- | ------------------------------- | ------------------------------------------------------------------- |
| `<ul><li>a</li><li>b</li></ul>`                | `"ab"`                          | two items become one word — **data corruption**                     |
| `<table><tr><td>a</td><td>b</td></tr></table>` | `"ab"`                          | no separator — **data corruption**                                  |
| `<h2>T</h2>`                                   | `"T"`                           | heading marker lost                                                 |
| `<hr>`                                         | `""`                            | disappears entirely                                                 |
| `<img src="…">`                                | `""`                            | dropped                                                             |
| `<pre><code>**x**</code></pre>`                | `` `**x**` ``                   | a code block becomes inline code, and its interior is reinterpreted |
| `<a href="http://x">see [1](http://x)</a>`     | `[see [1](http://x)](http://x)` | link text that looks like markdown becomes a real link on re-parse  |

Two claims in the original audit were checked and did **not** reproduce: `&amp;` does not compound
(it decodes correctly to `&`), and the markdown path round-trips `**\`x\`**`, `~~**x**~~`,
`<https://x.com>` and backslash escapes unchanged. Those bugs were described against the HTML path.

So: the markdown path is now lossless for the constructs above; the HTML path is not, and a
snippet pasted as rich text still loses its list and table structure. That is the next piece of
work, not something this change claims to have done.

## Non-Goals

- Full CommonMark compliance. This is a snippet editor, not a document renderer.
- Reference-style links, footnotes, definition lists, setext round-tripping, HTML blocks.
- Task-list checkboxes (`- [ ]`) as a distinct node type; the text is preserved, the checkbox is not
  modelled.
- Changing the stored format. Snippets stay markdown; this only makes that format lossless for the
  constructs above.
- Retro-fitting structure onto snippets already corrupted by a previous version. A table that
  already lost its separator is unrecoverable and no migration can invent the split.

## Change History

| Date       | Change                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-27 | Initial spec. Wave 10, previously held.                                                                                                |
| 2026-09-27 | Implemented for the markdown path. `htmlToMarkdown` verified as still lossy and the failures tabulated above rather than left implied. |
