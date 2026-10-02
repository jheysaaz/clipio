# Module: Interface Font

> Source: `src/lib/ui-font.ts` (new), `src/hooks/FontContext.tsx` (new),
> `src/storage/items.ts`, `src/app.css`, `src/assets/styles/fonts.css`,
> `src/lib/snippet-preview-ui.ts`, `src/components/options/settings/registry.ts`
> Coverage target: 90%

## Purpose

One setting that chooses the typeface used by **every pixel of Clipio's own UI**, and one
mechanism that makes that true everywhere at once instead of per-surface.

---

## Problem

There is no font setting. Three surfaces each hardcode a family, and they disagree:

| Surface         | Mechanism                                                                      | Family                                                    |
| --------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Tailwind tokens | `--font-sans`, `--font-heading` in `app.css`                                   | `InterVariable, system-ui, …`                             |
| Base reset      | `@layer base { * { font-family } }` in `app.css`                               | `InterVariable, system-ui, …` (hardcoded, not a variable) |
| Preview palette | inline `font-family` on `.container` and `.tooltip` in `snippet-preview-ui.ts` | `system-ui, -apple-system, …`                             |

The palette also declares `@font-face { font-family: "Inter" }` and then never uses it — the
exact defect `specs/options-redesign.spec.md:206-211` records as fixed elsewhere.

Because the base reset hardcodes the family rather than reading a custom property, no amount
of theming can retarget it: the `*` rule is what actually paints every element, and changing
`--font-sans` moves nothing.

---

## Behavior

### `src/lib/ui-font.ts`

- `UI_FONT_OPTIONS` — the closed set: `inter`, `system`, `dyslexic`, in that display order.
  `inter` is the default.
- `DEFAULT_UI_FONT: UiFont = "inter"`.
- `isUiFont(value: unknown): value is UiFont` — membership in the set. Total, never throws.
- `normalizeUiFont(value: unknown): UiFont` — returns the value when it is a member, otherwise
  `DEFAULT_UI_FONT`. This is the migration path: the key is new, but storage is user-writable
  from another extension context, a sync peer, or a restored backup, so an unrecognised value
  must degrade to the default rather than paint a blank select or an unresolved family.
- `UI_FONT_STACKS: Record<UiFont, string>` — the CSS stack per option, for the places that
  cannot use a custom property (the preview palette's inline styles).

**Option semantics**

| Value      | Stack                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------- |
| `inter`    | `InterVariable, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` |
| `system`   | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`                |
| `dyslexic` | `OpenDyslexic, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`  |

`dyslexic` lists OpenDyslexic first but **falls through to the system stack**: the bundled
weight range is 400/700, so a synthesised 500 or 600 would look wrong, and a glyph the font
lacks must not render as tofu.

### Application — one attribute, one variable

`app.css`:

```css
:root {
  --font-ui: <inter stack>;
} /* default, no attribute needed */
:root[data-ui-font="system"] {
  --font-ui: <system stack>;
}
:root[data-ui-font="dyslexic"] {
  --font-ui: <dyslexic stack>;
}

--font-sans: var(--font-ui);
--font-heading: var(--font-ui);

@layer base {
  * {
    font-family: var(--font-ui);
  } /* was the hardcoded stack */
}
```

`FontProvider` sets `document.documentElement.dataset.uiFont = normalizeUiFont(saved)`.

**Why `data-ui-font` on `<html>` and not an inline style or a class.** The palette aside, the
options page and popup share one stylesheet, so a custom property switched by an attribute is
one write for both, needs no re-render, survives `wxt prepare`, and is assertable from e2e.
An inline `style` on `<html>` would work equally well but is invisible to `:root` selectors in
devtools and easy to clobber.

**Monospace is deliberately not affected.** `--font-mono`, the `code, pre` rule and every
`.font-mono` utility stay on JetBrains Mono. Choosing OpenDyslexic must not turn the debug log
into a proportional font, and the user asked for an interface font, not a global text font.

### Validation on read

`FontProvider` normalises before applying **and** before writing back, so a corrupt value
self-heals to the default on the next load instead of lingering forever.

### Preview palette (content script)

The palette is injected into arbitrary pages inside a closed shadow root, so it cannot read
the extension's CSS. It must:

- read `uiFontItem` and watch it, so changing the setting updates an already-open palette;
- inject `@font-face` for the chosen family — `InterVariable` from
  `chrome-extension://…/assets/InterVariable.woff2`, `OpenDyslexic` from `…/OpenDyslexic-Regular.woff2`
  and `-Bold.woff2` — and **only** for the chosen one, so picking OpenDyslexic does not also
  download 350 KB of Inter;
- apply `UI_FONT_STACKS[font]` to `.container`, `.tooltip` and the `empty`/`label`/`shortcut`
  rows, replacing the two hardcoded system stacks;
- fall back to the inter stack if storage is unreadable.

`wxt.config.ts` `web_accessible_resources` gains `assets/OpenDyslexic*.woff2`, or the
OpenDyslexic face silently fails to load in the page world.

### Migration

There is no earlier font key, so there is nothing to migrate from. `normalizeUiFont` is the
migration for values written by anything else (hand-edited storage, a restored backup, a
downgraded build).

### Bundled binary provenance

The `open-dyslexic` **npm** package (v1.0.3, the `ssbc` repackage) is licensed under the
Bitstream Vera / GNOME Free Documentation License, not the SIL OFL. It was rejected for that
reason. The binaries shipped here are the latin subset of **`@fontsource/opendyslexic`
v5.3.0** — the 2019 upstream release by Abbie Gonzalez, under **SIL OFL 1.1**, with
`Reserved Font Name OpenDyslexic`. Its `LICENSE` is vendored verbatim as
`src/assets/fonts/OpenDyslexic-OFL.txt`.

Upstream's CSS declares the bold face at `font-weight: 700` while its OS/2 table says 800.
We match upstream (700), because browsers match on the CSS declaration, not the OS/2 value.

---

## Acceptance Criteria

- [x] `normalizeUiFont` returns `"inter"` for unknown values, `null`, numbers, objects,
      symbols, proxies and empty string — and returns each member of the set unchanged.
- [x] `UI_FONT_OPTIONS` is exactly `["inter", "system", "dyslexic"]`, and every member has a
      stack in `UI_FONT_STACKS`.
- [x] `inter` is the stored default (`items.test.ts` key contract).
- [x] The base reset and `--font-sans` both read `var(--font-ui)`, and no font stack is
      hardcoded in `app.css`.
- [x] With `data-ui-font="dyslexic"`, computed `font-family` resolves to `OpenDyslexic` on the
      sidebar, on `#root`, and on a setting row.
- [x] With `data-ui-font="system"`, those same surfaces resolve to `system-ui`.
- [x] With `data-ui-font="inter"`, those same surfaces resolve to `InterVariable`.
- [x] The OpenDyslexic face is actually loaded (`document.fonts.check`), not merely requested.
- [x] The popup — a separate document — applies the same font.
- [x] The debug log stays `JetBrainsMono` under all three settings.
- [x] Changing the setting in Options repaints the options page with no reload, and persists
      to `chrome.storage.local`.
- [x] An unrecognised stored value falls back to Inter, still shows a selection in the
      control, and is rewritten to `"inter"` on load.
- [x] Each option's label is computed in its own face: the `OpenDyslexic` option reads back
      `OpenDyslexic` and the `Inter` option reads back `InterVariable`.
- [x] `theme` renders three icons in a `radiogroup`, exactly one of which is ever checked.
- [ ] The preview palette follows the setting. The code path is in place and covered by the
      unit suite for `paletteStack`, but there is no e2e for the palette's computed
      `font-family` — the palette lives in a closed shadow root that Playwright cannot query,
      and the only page-world signal is the host's data attributes, which deliberately
      disclose nothing about styling. See "Known Gaps".

## Edge Cases

- **Storage unavailable** (extension context invalidated): `FontProvider` leaves the default
  attribute in place; the palette falls back to the inter stack. Never throws.
- **`data-ui-font` set to a bogus value by devtools**: no `:root[data-ui-font="…"]` rule
  matches, so `--font-ui` keeps its default declaration and the page renders Inter.
- **OpenDyslexic italic**: bundled. A user selecting a non-italic font gets a synthesised
  oblique, which is acceptable and is what a two-weight bundle implies.
- **The popup closes on blur**, so it never renders a stale font — it re-reads on open.
- **Weight 500/600 is synthesised** from the 400 face. Documented, not worked around: the two
  missing weights would add ~230 KB to the bundle for a weight the UI uses in exactly one
  place (semibold labels). This is _weight_ synthesis on OpenDyslexic itself — the families
  after it in the stack are only consulted for a glyph OpenDyslexic lacks, never to
  interpolate a weight.

## Known Gaps

- **The preview palette has no e2e.** `paletteStack` is unit-testable, but the palette's
  _applied_ font is not observable from the page world: the shadow root is closed, and the
  host's data attributes deliberately expose palette state without exposing anything about
  styling. Verifying it would mean reopening the root, which
  `specs/preview-encapsulation.spec.md` exists to prevent.
- **Changing the font does not repaint an already-open palette.** `init()` builds the
  shadow root's `<style>` once and early-returns on a second call, so a user who changes the
  font in Options while a palette is open in another tab keeps the old family until they
  reload that tab. Opening a _new_ palette after the change still uses the new font, because
  `init()` reads `uiFontItem` on every page load.
- The Plate.js editor renders inside the options/popup document, so it inherits, but Plate's
  own placeholder and code-block styling is not separately audited for `font-family`.
- No test asserts glyph _coverage_ for OpenDyslexic; a missing glyph falls through to the
  system stack rather than to tofu.
