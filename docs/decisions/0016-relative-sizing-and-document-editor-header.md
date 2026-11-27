# 0016 — Relative sizing, one type scale, and a document-style editor header

**Status:** accepted · **Date:** 2026-11-26 · **Revised:** 2026-11-27

## Context

The popup was laid out in a mix of Tailwind's absolute pixel steps and literal
px values: `text-[10px]`, `text-[18px]`, a 680×460 `body`, `4px` radii in
`.kbd-badge`, and a cluster of 10–13px values in the onboarding popover. Those
values read as "the design" but were really screenshots frozen at the browser's
default 16px root. A user who raises the root font size gets larger type beside
unchanged boxes, and the popup has no cap-aware sizing of its own.

The selected sidebar row was only a faint `bg-muted` fill over a `bg-muted/50`
background, with the same name weight as every other row. It relied on a second
cue (which row the editor showed) to say what was selected. The editor header
was a tinted `h-11` band with a bordered shortcut input, so the name and
shortcut read as chrome around the document instead of as the document's own
heading.

ADR [0011](0011-router-in-the-popup-is-replace-only.md) fixes the popup's
replace-on-blur lifecycle and records its original size; ADR
[0013](0013-opt-out-of-chrome-force-dark.md) requires `color-scheme: only light`
to stay on `:root`. Neither is changed here.

## Decision

### One type scale, in rem

`src/app.css` owns the scale: 11/12/13/14/18px at a 16px root as
`--text-ui-micro`, `--text-ui-xs`, `--text-ui-sm`, `--text-ui-base` and
`--text-ui-lg`, plus unitless `--leading-ui` / `--leading-editor`. UI names are
13px/500, muted secondary text 12px, metadata 11px, shortcuts 12px mono, editor
body 14px/1.6, and the editor name 16px/500 via Tailwind's own `text-base` and
`font-medium` utilities — no parallel title token.
Components consume the tokens; they do not restate the px values. Utilities are written with Tailwind's
important suffix (`text-ui-lg!`): the shared Input primitive carries
`md:text-sm`, which is emitted later in the cascade and otherwise wins at the
800px cap, silently shrinking the document title back to 14px.

Radii are derived from `--radius` with rem increments. Icons keep their typed
`ICON_SIZE` scale; popup chrome opts into `lg` (16px) where a specific size
matters. Hit targets are rem-based: sidebar rows ≥3rem, search and Add Snippet
2.25rem, the toolbar 2.5rem, and its buttons 2rem.

### The popup box is rem-first and cap-aware

`--popup-width: min(42.5rem, 800px)` and `--popup-height: min(28.75rem, 600px)`
preserve 680×460 at a 16px root, grow with the root font, and stop at Chrome's
800×600 popup cap. The popup body carries a `popup-shell` class and is the only
`overflow: hidden` body — `app.css` also ships to Options, which must keep
scrolling. The sidebar list and editor own their scrolling, so a large root
font cannot push content outside the capped box.

### Selection is one neutral fill

`--selected` is a stronger neutral than the hover fill in both themes: because
`--muted` is painted at 50% in the sidebar, the effective hover fill is near
white in light (0.98) and near 0.21 in dark. Selection is therefore darker than
`--muted` in light and lighter than `--muted` in dark. An early value of 0.22 in
dark measured only 1.02:1 against the sidebar — effectively invisible — and was
rejected on that evidence. The selected row uses only `bg-selected` plus
`font-semibold` on its name. There is no accent
bar, ring or extra marker, and the existing focus ring is untouched.
`aria-selected` remains the accessible state; no second ARIA attribute is
added where one already tells the truth.

### The editor header is a glass island within the document

The tinted full-width band and the bordered shortcut pill are gone. The name and
shortcut sit together on a translucent, rounded island that floats over the
same `bg-background` surface as the body. `backdrop-blur` and a hairline ring
make it read as a single control island rather than chrome; a short scale/fade
transition on hover and focus says it is interactive without moving the fields;
there is no hover shadow. The island is deliberately tight: a 0.25rem bottom
margin, 0.375rem horizontal padding and 0.125rem vertical padding keep it a
surface around the fields rather than a padded card. The title stays a real
input at 16px/500 with Tailwind's `text-base`/`font-medium`; the Newsreader trial
and the custom title tokens were both removed after visual review. The shortcut keeps
its monospace treatment but shares the island's padding and baseline with the
name instead of being a centred pill with an underline. Typed spaces become
dashes immediately; other unsupported characters stay visible so validation can
name them. The browser's native `title` carries the hint or the error — there is
no custom tooltip and no error border to repaint the field. Its configured
trigger prefix is protected by input handling: deleting or replacing it restores
it. Both inputs keep their i18n accessible names, the stored shortcut string and
the duplicate-shortcut status in the title. Tab order is name → shortcut → content; Enter
in the name focuses the editor. The change applies to both the new and saved
views.

### A gate keeps px out of the chrome

`scripts/check-no-px.mjs` scans shipped `src` files and fails on any px literal
outside its explicit, reasoned allowlist. Allowed uses are 1px hairlines and
outline offsets, 2px focus rings and outlines, the 0.5px subpixel shadow, the
800px/600px Chrome cap paired with a rem value, shadow offsets/blur, and the
content script's offscreen `-9999px` textarea. Test fixtures and
`src/lib/snippet-preview-ui.ts` are excluded: the latter injects CSS into
arbitrary host pages and must follow the host page's CSS pixel, not Clipio's
root font. The gate runs from `pnpm verify`, and its unit tests drive the real
script with positive and negative fixtures.

## Alternatives considered

- **Keep px and scale through a transform.** It would add a build step and a
  second source of truth; rem in the source is the value the browser uses.
- **Clamp with viewport units.** A popup is not a viewport-sized page; the
  clamp must express Chrome's cap, not the window.
- **Use an accent bar or ring for selection.** That adds a second indicator to
  a row that already has `aria-selected`, and competes with the focus ring.
- **Keep the tinted header but remove its border.** The tint still reads as
  chrome rather than as the document heading.
- **Remove the fixed name/shortcut row entirely.** Moving the fields into the
  footer would put them behind the tag bar and make renaming a long snippet a
  two-scroll operation in a 460px popup.
- **Convert the injected preview CSS too.** Its px values are deliberately
  host-page CSS pixels; changing them would change what users see in pages
  Clipio does not own.
- **Allow px wherever a shadow appears.** A whole-line shadow exemption let a
  `ring-[3px]` hide behind `transition-[color,box-shadow]`; the checker now
  distinguishes an actual shadow from a ring on the same line.

## Consequences

- AGENTS.md now records the relative-units convention beside the other
  code-style rules.
- A new px in shipped UI source fails `pnpm verify` with file and line. Adding
  a genuinely px-correct value means changing the allowlist in the same change.
- The popup keeps the same stored data, autosave path and i18n keys. Shortcut
  validation gains two copy keys for whitespace/unsupported characters. No
  storage key or route changes.
- The 11px minimum is a floor for metadata, not a licence to shrink body copy:
  secondary text is 12px and the editor body is 14px.

## Revisit when

Chrome raises or removes the popup size cap, the design introduces a real
accent colour for selection, or a component needs a px value that is neither a
hairline, focus ring, shadow offset nor browser cap. Each case needs a new
decision and a deliberate allowlist entry, not a local exception.
