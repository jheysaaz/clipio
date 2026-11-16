# 0012 — Own icons stay in `public/`, third-party marks are bundled

Date: 2026-10-04
Status: Accepted

## Context

`public/icon/` held seven PNGs with two completely different jobs:

- `16/32/48/96/128.png` — Clipio's own extension icons.
- `powertext.png`, `textblaze.png` — brand marks for *other people's* products,
  shown only in the options page's "supported formats" row and the import
  wizard's format picker.

WXT treats `public/` as *copied verbatim, never processed*. So every brand mark
shipped as a stable, unhashed URL whether or not anything referenced it, and
adding a format meant hand-writing the path in `LibraryPanel.tsx`.

The options page and the import wizard also each kept their own list of
formats. `ImportWizard` held a `PARSERS` map; `LibraryPanel` held a separate
hand-written `{ label, icon }` array with the paths spelled out as literals.
Nothing tied them together, so adding a format meant editing two files and
forgetting the second produced a wizard that could import a format the options
page claimed was unsupported.

## Decision

**Two rules, not one.**

1. **Anything that must keep a stable, unhashed URL stays in `public/`.**
   That is Clipio's own `icon/<size>.png` set, because WXT auto-discovers
   `manifest.icons` from `public/icon/<size>.png` — moving them breaks the
   manifest — and because `16.png` is a `web_accessible_resources` entry so the
   content-script preview header can load it from a web page. Bundled assets are
   not web-accessible, so a bundled icon could never serve that role.

2. **Everything else is bundled from `src/assets/` and imported as a module.**
   `powertext.png` and `textblaze.png` live in `src/assets/brands/` and are
   imported by the parsers that own them, so a renamed or deleted file becomes a
   build error instead of a runtime 404.

   In practice both are small enough — 918 B and 2285 B, against Vite's 4096 B
   `assetsInlineLimit` — that the bundler **inlines them as base64 data URLs**
   rather than emitting hashed files. That is the right outcome for 14 px
   decorative marks: no second request, no file to go missing. Worth stating
   plainly, though, because it means the bytes are in the JS chunk
   unconditionally — "bundled" buys correctness here, not laziness. A future mark
   large enough to clear the inline limit is emitted as a hashed file with no
   code change; `FormatParser.iconUrl` stays an opaque `string` either way.

**One list of formats, owned by the parsers.** `src/lib/importers/registry.ts`
exports `IMPORT_PARSERS` and `getParser`. The wizard and the options page both
read it, and `LibraryPanel` renders `parser.displayName` / `parser.iconUrl`
instead of its own literals. Format presentation order lives next to the
parsers rather than in either consumer.

## Consequences

- `LibraryPanel` renders `parser.displayName`, which is a brand or format name
  and is deliberately not translated — same class as `en.yml`'s
  `options.font.inter`. It is unchanged in English and Spanish.
- The three `iconUrl` values are now a mix of URL kinds: a base64 data URL for
  the two third-party marks, a `/icon/128.png` public path for Clipio's own.
  That is intended. `FormatParser.iconUrl` is typed as an opaque `string` and
  both consumers pass it straight to `<img src>`, so nothing needs to know
  which.
- `ClipioParser.iconUrl` deliberately stays `/icon/128.png` even though it could
  be bundled. It is asserted by test, because a future "move everything to
  assets" cleanup would silently break `manifest.icons`.
- **Both call sites render these marks with `alt=""`**, because the adjacent
  text already names the format. Correct for a screen reader, and exactly why a
  broken image is invisible: no alt text to surface, no layout shift, and the
  options page's axe scan has nothing to complain about. So `registry.test.ts`
  asserts the icons are not `/icon/…` paths, which would now dangle, and
  `e2e/options.spec.ts` asserts every mark actually decodes via `naturalWidth`.
  Without the latter the failure mode is a blank space.

## Alternatives rejected

- **Move all seven to `src/assets/`.** Breaks manifest icon discovery, and
  leaves the preview logo unreachable from a web page.
- **Duplicate `16.png` into `src/assets/`** so the preview header could use a
  bundled copy and drop the `web_accessible_resources` entry. Trades one
  declared resource for two copies of the same file that must stay in sync.
- **Keep `LibraryPanel`'s literals** and only move the image files. The drift
  between the two format lists would survive; it is the more likely bug.