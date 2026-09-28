# Module: Icon System

> Source: `src/lib/icons.ts`, `src/components/ui/icon.tsx`
> Coverage target: 100% for `src/lib/icons.ts`; `src/components/ui/**` is coverage-excluded

## Problem

35 files import from `lucide-react` via two competing patterns (direct inline
rendering vs. the `<Icon>` wrapper), sizing is decided in three places at once
(wrapper tokens, raw Tailwind classes at call sites, and shadcn's
`[&_svg:not([class*='size-'])]:size-4` CSS fallback), and stroke widths appear
in four ad hoc values (1, 1.5, 2, 2.5). Unused `data-icon="inline-start/end"`
padding hooks exist in `button.tsx`/`badge.tsx` with zero consumers.

## Solution

One wrapper (`<Icon>`) as the only way to render an inline icon; one shared
constants module (`src/lib/icons.ts`) as the only source of size/stroke values;
`LucideIcon`-typed props remain the one sanctioned way to pass icons around;
shadcn's CSS size rules become a pure fallback (never consulted for wrapper
icons, because the wrapper always emits a `size-*` class that trips the
`[class*='size-']` guard).

## API

### `src/lib/icons.ts`

```ts
export const ICON_SIZE = {
  xs: "size-2.5", // 10px
  sm: "size-3", // 12px
  md: "size-3.5", // 14px
  lg: "size-4", // 16px
  xl: "size-5", // 20px
  "2xl": "size-6", // 24px
  "3xl": "size-8", // 32px
} as const;

export const ICON_STROKE = {
  default: 1.5, // chrome / nav / info / actions
  emphasis: 2, // explicit emphasized state: close / formatting / hover-active overlays
  micro: 2.5, // EXCEPTION: 10px micro-icons only (editor placeholders + 10px status checks). Do NOT generalize.
} as const;
```

No icon re-export barrel: icon components stay as direct
`import { X } from "lucide-react"` imports so tree-shaking keeps working.

### `<Icon>` wrapper (`src/components/ui/icon.tsx`)

```tsx
<Icon icon={Settings} />                                  // size="md", stroke default (1.5)
<Icon icon={Loader2} size="xl" className="animate-spin" />
<Icon icon={X} size="lg" stroke="emphasis" />             // strokeWidth 2
<Icon icon={Film} size="xs" strokeWidth={ICON_STROKE.micro} /> // 10px exception
```

| Prop          | Type                      | Default     | Notes                                                                                                                      |
| ------------- | ------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `icon`        | `LucideIcon`              | —           | Also composes with the icon-as-prop pattern                                                                                |
| `size`        | `keyof typeof ICON_SIZE`  | `"md"`      | Sole sizing mechanism; maps to `ICON_SIZE` class                                                                           |
| `stroke`      | `"default" \| "emphasis"` | `"default"` | Maps to `ICON_STROKE`; the ONLY sanctioned way to get stroke 2                                                             |
| `strokeWidth` | `number`                  | —           | Escape hatch, **only** valid with `ICON_STROKE.micro` (2.5) on 10px micro-icons; any other value must be flagged, not used |
| `className`   | `string`                  | —           | Merged via `cn()`; may add color/spin/margins, or override size **only** for documented non-square exceptions              |

Guaranteed on every render: `aria-hidden="true"`, `shrink-0`, one
`ICON_SIZE`-derived class, one stroke value derived from the constants.

### Sanctioned patterns (exactly two)

1. **Render:** `<Icon icon={X} … />` — the only way to render an inline icon.
2. **Pass around:** `import type { LucideIcon }` + `icon: LucideIcon` prop in
   data arrays (nav items, slash-menu commands, theme options), rendered
   through `<Icon>` at the call site.

Direct `<X className=… strokeWidth={…} />` rendering is forbidden.

## Stroke mapping rules

| Current                                              | Maps to                           | Rationale                                                        |
| ---------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| `strokeWidth={1}`                                    | `default` (1.5)                   | Two-value collapse (user-approved; slight weight change flagged) |
| `strokeWidth={1.5}` or omitted-in-chrome-context     | `default`                         | Unchanged                                                        |
| `strokeWidth={2}` on close/formatting/active-overlay | `emphasis`                        | Unchanged; explicit variant replaces ad hoc number               |
| `strokeWidth={2}` on plain actions/nav               | `default`                         | Step 2: actions move to 1.5 (flagged weight change)              |
| omitted (lucide default 2) on close                  | `emphasis`                        | Preserves rendered weight                                        |
| omitted (lucide default 2) on chrome/actions         | `default`                         | Directed normalization                                           |
| `strokeWidth={2.5}` at 10px                          | `strokeWidth={ICON_STROKE.micro}` | Documented exception                                             |
| `strokeWidth={2.5}` at 12px                          | `emphasis`                        | Outside exception scope (user-approved normalization)            |

## Size mapping rules (based on RENDERED size, not declared class)

Verified empirically against the built CSS (`.output/chrome-mv3/assets/*.css`)
and a live-popup baseline: inside a shadcn `Button`, an svg **without** a
`size-*` class renders at the button's fallback size. Note `cn()`/
tailwind-merge **drops the base `[&_svg:not([class*='size-'])]:size-4`** when
the size variant carries its own override, so the effective fallback per
button size is: `default`/`icon`/`lg` → 16px, `sm` → 14px, `xs` → 12px.
(The base rule outranks `h-*`/`w-*` utilities, so declared `h-3.5` inside a
default Button is dead code today.) Tokens are chosen to preserve the
**rendered** size:

| Context / declared class                                                 | Rendered today | Token                                                                                  |
| ------------------------------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------- |
| inside shadcn `Button` size `default`/`icon`/`lg`, any declared class    | 16px           | `lg`                                                                                   |
| inside shadcn `Button` size `sm`                                         | 14px           | `md`                                                                                   |
| inside shadcn `Button` size `xs`/`icon-xs`                               | 12px           | `sm`                                                                                   |
| inside `Select` trigger/item/scroll arrows without `size-*`              | 16px           | `lg`                                                                                   |
| inside `Alert` (`*:[svg:not([class*='size-'])]:size-4`) without `size-*` | 16px           | `lg`                                                                                   |
| direct child of `sidebar.tsx` `[&>svg]:size-4` (unguarded)               | 16px           | `lg` (token is overridden anyway; keep intent explicit)                                |
| inside `Badge` (`[&>svg]:size-3!`)                                       | 12px           | `sm` (matches forced size)                                                             |
| raw `<button>` / standalone, `h-2.5 w-2.5`                               | 10px           | `xs`                                                                                   |
| raw `<button>` / standalone, `h-3 w-3` / `size-3`                        | 12px           | `sm`                                                                                   |
| raw `<button>` / standalone, `h-3.5 w-3.5` / `size-3.5`                  | 14px           | `md`                                                                                   |
| raw `<button>` / standalone, `h-4 w-4` / `size-4`                        | 16px           | `lg`                                                                                   |
| raw `<button>` / standalone, `h-5 w-5`                                   | 20px           | `xl`                                                                                   |
| raw `<button>` / standalone, `h-6 w-6`                                   | 24px           | `2xl`                                                                                  |
| raw `<button>` / standalone, `h-8 w-8` (icon)                            | 32px           | `3xl`                                                                                  |
| non-square `w-3 h-8` (GripVertical drag handle)                          | 12×32          | `size="sm"` + documented `className="h-8 w-3"` override — the one non-square exception |

Baseline reference for before/after comparison:
`/var/folders/sb/vzq_85v102924mx3z5q18f2r0000gn/T/opencode/baseline-icons.json`
(measured sizes/strokes/aria from the real popup + options pages).

## shadcn CSS rules (fallback, not a parallel system)

`button.tsx`, `select.tsx`, `alert.tsx`, `alert-dialog.tsx`, `sidebar.tsx`,
`badge.tsx` keep their `[&_svg:not([class*='size-'])]` rules as the fallback
for any svg with **no** `size-*` class. After migration every wrapper icon has
a `size-*` class, so the guard always skips wrapper icons → no fighting.
`badge.tsx`'s `[&>svg]:size-3!` remains (forces 12px in badges regardless of
token — existing visual behavior, preserved).

## Dead hooks

`has-data-[icon=inline-end]:pr-*` / `has-data-[icon=inline-start]:pl-*` in
`button.tsx` (4 occurrences) and `badge.tsx` (2 occurrences) are removed:
grep confirms zero `data-icon` attributes are set anywhere in `src/`, and no
planned usage in this refactor needs icon-adjacent padding (buttons use `gap-*`).

## Accessibility (per https://lucide.dev/how-to/accessibility)

- Wrapper always sets `aria-hidden="true"` (decorative-by-default; icons are
  never the accessible name).
- Accessible names live on the interactive **wrapper** (button + `aria-label`
  or `sr-only` text) — never on the icon itself.
- `InfoTooltip` is restructured: the `<Info>` svg currently carries
  `role="button" tabIndex={0} aria-label` itself. Becomes a semantic
  `<button type="button" aria-label={text} aria-describedby={id}>` wrapping
  `<Icon icon={Info} … />`, with focus/blur/keydown handlers moved to the
  button. Icon renders `aria-hidden`. (Known pre-existing deviation: target
  size < 44×44 px — out of scope for a consistency refactor, noted for
  follow-up.)
- Interactive icons elsewhere already label their parent button
  (`FloatingToolbar`, `ImagesSection` view toggles, `sidebar.tsx` `sr-only`)
  — verified, no change needed.

## Acceptance criteria

- [x] `src/lib/icons.ts` exports `ICON_SIZE` (7 tokens) and `ICON_STROKE`
      (3 values) with the documented `micro` exception comment; no barrel of
      icon components.
- [x] `<Icon>` consumes constants only (no hardcoded sizes/strokes), defaults
      `size="md"`, `stroke="default"`, always `aria-hidden` + `shrink-0`.
- [x] Every lucide icon render site (35 files) uses `<Icon>` or the
      `LucideIcon`-prop → `<Icon>` composition; zero direct
      `<LucideComponent className strokeWidth />` renders remain.
      (Verified by AST-ish scan: only remaining `<…>` render of an imported
      lucide component is the wrapper itself at `icon.tsx:48`.)
- [x] All stroke values in rendered output ∈ {1.5, 2, 2.5}; every 2.5 is at a
      10px micro-icon site with the exception comment; every 2 comes from
      `stroke="emphasis"` or `strokeWidth={ICON_STROKE.micro}`.
      (No raw numeric `strokeWidth` remains outside `icons.ts` / tests /
      `icon.tsx`.)
- [x] No raw size classes (`h-*`/`w-*`/`size-*`) remain on icon call sites,
      except the single documented non-square GripVertical override.
- [x] `data-icon` hooks and their CSS removed from `button.tsx` + `badge.tsx`.
- [x] Flagged rendered-output changes (approved by user): stroke 1→1.5 (×3),
      stroke 2→1.5 on plain actions/nav, stroke 2.5→2 outside the 10px
      exception (×3: ImagesSection list check, ImagesSection grid check —
      identical sites, list+grid views —, ResizableMediaWrapper close X).
      Live re-measurement vs `baseline-icons.json`: 29 unchanged;
      10× stroke 2→1.5 (directed chrome/action normalization, incl. old
      wrapper's blanket stroke-2 default); 2× `aria-hidden` gained
      (InfoTooltip a11y). **Zero size changes.**
- [ ] `pnpm test:coverage`, `pnpm compile`, `pnpm lint` pass. - `pnpm compile` ✅ and `pnpm build` ✅. - `pnpm test` ✅ 915/917 (2 pre-existing failures in
      `textblaze.test.ts` / `powertext.test.ts`, unrelated to icons). - `pnpm lint` reports 15 errors — **all verified identical at HEAD**
      (unused imports/vars, useless escapes, empty blocks in
      AdvancedSection/DashboardSection/ImagesSection/SnippetsSection);
      zero new issues from this change. - `pnpm test:coverage` blocked by the 2 pre-existing test failures;
      `src/lib/icons.ts` measured 2/2 statements (100%) directly.
- [x] Independent review agent approves (report:
      `/var/folders/sb/vzq_85v102924mx3z5q18f2r0000gn/T/opencode/icon-review-report.md`).

### Post-migration measurement

Helper (kept outside the repo): copy
`/var/folders/sb/vzq_85v102924mx3z5q18f2r0000gn/T/opencode/baseline-icons.mjs`
to the project root, run `node baseline-icons.mjs` against the built
extension, then diff the JSON against `baseline-icons.json` (screens: popup,
popupWithSnippet, options, optionsAppearance; `popupDetail` never captures in
either run — the row-click locator doesn't match).

## Edge cases

- Icons inside `Badge` → badge's `size-3!` still wins (existing behavior).
- Icons inside `Button`/`Select` → wrapper token wins over CSS fallback
  (guard trips); token chosen to match previously-rendered fallback size.
- `SelectPrimitive.Icon render={…}` / `ItemIndicator` receive an `<Icon>`
  element — wrapper composes fine as a render prop child.
- Spinner (`Loader2` + `animate-spin`), color classes, margins pass through
  `className` via `cn()` merge.
- `AppearanceSection` theme options switch from pre-built JSX
  (`icon: <Sun …/>`) to `icon: LucideIcon` components rendered via `<Icon>`.

## Change History

| Date       | Change                                   | Author |
| ---------- | ---------------------------------------- | ------ |
| 2026-09-22 | Initial spec (icon system consolidation) | —      |
