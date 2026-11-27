# Sample import files

Fixtures for trying Clipio's importer by hand.

Load one through **Options → Library → Import / Export → Import**, or by deep
link — the import panel is now addressable:

```
chrome-extension://<extension-id>/options.html#/library/import
```

Or, from the popup's empty state, the **Import** button goes straight there.

Each file is a different source format, because the importer's interesting
behaviour is how it *translates* — not just that it reads JSON.

| File | Format detected as | What it exercises |
|---|---|---|
| `clipio-export.json` | `clipio` | Clipio's own v1 envelope. Markdown, `{{cursor}}`, `{{clipboard}}`, `{{date:iso}}`, tags. |
| `clipio-520-export.json` | `clipio` | 520 generated snippets for windowing, search and the oversized-sync import choice. |
| `textblaze-export.json` | `textblaze` | `{version, folders}`. Folder names become tags; `{cursor}`/`{clipboard}` are translated. |
| `powertext-export.json` | `powertext` | A flat `{shortcut: text}` object. `%clip%` → `{{clipboard}}`, `%d(YYYY-MM-DD)` → `{{date:iso}}`. |

## What to look for

**Format detection.** The wizard should name the format without you picking it.
If it says "unknown format", the file's top-level shape is wrong — that is the
first thing detection looks at.

**Placeholder translation.** The conflict/review step shows each snippet's body
*after* translation. Check that:

- `;so` in `clipio-export.json` contains `{{cursor}}`
- `;tso` in `textblaze-export.json` contains `{{cursor}}`, not `{cursor}`
- `;date` in `powertext-export.json` reads `Date: {{date:iso}}` with no stray
  character left over

**Unsupported placeholders.** `;tup` in the TextBlaze file uses
`{accountNumber}`, which has no Clipio equivalent. It should be *flagged* so you
can choose what happens to it, rather than silently dropped. This is the step
worth reading rather than clicking through.

**Tags.** `;tcm` in the TextBlaze file lands with `development` (from its folder)
alongside `text_blaze` (from the source format). Folder names are slugified and
lowercased, so `Development` becomes `development`.

**Then insert one.** Import, open the popup, and expand a snippet on a real page.
A snippet that imports cleanly but inserts the wrong thing is a translation bug
the wizard's review step would not have shown.

## Notes on the formats

- **`clipio-520-export.json` is deliberately over sync's 512-item limit.** The
  wizard must ask for an explicit storage target rather than silently switching
  to local. It is the hand-testable counterpart of `e2e/performance.spec.ts`.
- **The 5,000-snippet case is not a sample file.** Imports cap at 2,000 snippets;
  the performance spec generates 5,000 records and seeds storage directly.
- **Power Text labels are their shortcuts.** The format has no separate name
  field, so the object key becomes both the shortcut and the label. That is why
  those snippets are labelled `;pw` rather than "Sign-off".
- **`%d(...)` takes no trailing `%`.** Unlike `%clip%`, the date placeholder's
  regex consumes the whole token, so `%d(YYYY-MM-DD)%` would leave a stray `%` in
  the inserted text. The samples use the correct form.
- **Recognised date formats** are `YYYY-MM-DD`, `MM/DD/YYYY`, `DD/MM/YYYY`, and the
  long/short month forms. Anything else is reported as unsupported.

## These files are tested

`samples.test.ts` runs every file through the real `detectFormat` → `parse` →
`validateImportedSnippet` path that the wizard uses, and asserts the translations
above. If a parser or the schema changes shape, that test fails rather than the
files quietly going stale — a sample that no longer imports is worse than no
sample, because it reads as a broken importer.

It also asserts every registered format has a sample, so adding a parser without
one is caught.

Run it with:

```bash
npx vitest run samples/
```