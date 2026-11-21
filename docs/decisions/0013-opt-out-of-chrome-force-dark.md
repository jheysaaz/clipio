# 0013 — Opt Clipio's own pages out of Chrome's force dark

**Status:** accepted · **Date:** 2026-11-21

## Context

`chrome://flags/#enable-force-dark` ("Auto Dark Mode for Web Contents") applies
Blink's force-dark filter to pages it classifies as light. It does not stop at
pages without a dark theme; it painted over ours.

Measured on the built extension, with the only variable being the flag:

| Page / theme | Pixels changed by force dark |
|---|---|
| popup, light | 99.1% |
| popup, dark | 1.1% (e.g. a `39,39,42` border repainted `73,73,75`) |
| options, light | 99.8% |
| options, dark | 0.2% |

Two identical captures without the flag differed by 0.0%, so those numbers are
the browser, not capture noise.

`color-scheme: dark` — the obvious declaration for a page that has authored its
own dark theme — does **not** stop it. `color-scheme: only light` on `:root` is
the documented per-page opt-out and the only declaration that did; with it,
all four combinations measured 0.0%.

## Decision

`:root` in `src/app.css` declares `color-scheme: only light`, unconditionally.
The `.dark` class deliberately declares no colour scheme of its own: doing so
replaces `only light` in the cascade and brings the filter back.

The cost is accepted: UA-rendered surfaces (scrollbars, the native
`<input type="date">` picker) follow the light scheme even in Clipio's dark
theme. Every Clipio surface is painted from our own tokens, and the measured
difference across both pages and both themes was a single pixel.

## Alternatives considered

- **`color-scheme: dark` on `.dark`** — gives dark native widgets and re-enables
  force dark for the dark theme. Rejected; measured above.
- **A `<meta name="color-scheme" content="only light">` tag** — equivalent
  opt-out, but static. It cannot be paired with a theme-aware scheme, and the
  stylesheet is the thing that knows whether Clipio is opted out.
- **A Playwright force-dark pixel comparison** — proved the behavior locally but
  added a hand-rolled PNG decoder, five tests and ten browser launches for a
  browser flag, not app behaviour. Rejected under [0006](0006-e2e-only-what-needs-a-browser.md);
  `src/app.css.test.ts` pins the declaration instead.

## Consequences

Changing the spelling or location of the declaration — or adding one to `.dark`
— fails `pnpm verify`. The test cannot paint, so the browser experiment above
is the evidence that the declaration is the right one; the test only stops it
being silently undone.

## Revisit when

Clipio starts depending on UA-rendered colour in the dark theme (a native
picker, a non-overlay scrollbar that must be dark), or Chrome changes how force
dark honours `color-scheme`. Re-measure before changing the declaration.
