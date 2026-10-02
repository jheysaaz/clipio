# Module: Options Page Redesign

> Replaces the card-based options page with a search-first, hairline-row settings
> surface modelled on the Claude Desktop settings shell.

## Purpose

The options page is the extension's only configuration surface and is currently
a stack of five `rounded-xl border p-5` cards reached through a sidebar whose
labels do not describe their contents. This module specifies a ground-up
replacement: a declarative settings registry, a grouped search-first shell, one
row primitive, and real keyboard-shortcut recording.

## Problem

1. **The nav lies.** `Snippets` contains no snippet management — it holds
   preview settings, blocked sites, typing timeout and import/export. Snippet
   CRUD lives in the popup.
2. **`Advanced` is a junk drawer.** Behind a yellow "experimental" banner it
   holds content-script health, storage-backend switching (a genuine user
   decision) and a destructive IDB wipe, next to a Giphy API key field.
3. **Every statistic renders twice.** `section-cards.tsx` and
   `DashboardSection.tsx` both render snippet count, sync KB, local KB and
   storage mode in the same scroll view.
4. **Three implementations for one boolean.** Preview enabled is a `Button` with
   an "Enabled"/"Disabled" label; confetti is a hand-rolled `role="switch"` div;
   debug mode is a hidden checkbox behind a `peer-checked:` div.
5. **Shortcuts are typed by hand** into a text input.
6. **The preview shortcut setting is decorative (bug).**
   `content.ts:1256-1268` reads only `ctrl`/`shift`/`alt` substrings out of the
   stored string and hardcodes `keyMatch = event.key === " " ||
   event.code === "Space"`. A shortcut of `Cmd+K` **never fires**, while the UI
   hint advertises `"Use format: Ctrl+Shift+Space, Cmd+K, etc."`.
7. **No search.** Ten preferences and six management surfaces, no findability.
8. **No deep links.** `activeSection` is React state only; `#feedback` renders the
   shell and is ignored.
9. **Destructive actions are inline two-step buttons**, not dialogs.
10. **Hardcoded English** survives in `"Saved"`, `"Version: "`, `"uses"`,
    `"estimated"`, `"of 102400 KB"` and
    `Example: Type "/hello" to filter snippets`.

## Solution

- A declarative **settings registry** so settings can be searched, listed and
  rendered (including their live control) from one source of truth.
- A **grouped, searchable shell** with hairline rows instead of cards.
- A **real shortcut grammar** (`src/lib/shortcuts.ts`) plus a key-capturing
  recorder, and content-script matching that honours every part of the chord.
- A **Danger Zone** of real dialogs, and `chrome.commands` for the two
  browser-level shortcuts that cannot be content-script scoped.

## Information architecture

Eight sections. Images began folded into Library and was split back out: the
media list has its own storage meter and per-row delete/alt actions, and
burying it under import/export made both harder to find.

```
⌕  Search settings…                          ⌘K
──────────────────────────────────────────────────
LIBRARY
    Library       import, export, library stats, top usage
    Images        media library
BEHAVIOUR
    Expansion     typing timeout, preview, prefix, shortcut
    Blocked sites per-site disable
APPEARANCE
    Appearance    theme, confetti
SYSTEM
    Storage       backend, quota meters, danger zone
    Diagnostics   health check, debug switch, Giphy key, log
    About         version, updates, feedback
```

Within a section, `SectionContent` renders above the registry rows and
`SectionFooter` below them. The debug log is a footer because it must appear
*after* the switch that enables it — an empty log box above its own toggle asks
the user to interpret a panel they have not switched on yet.

## Storage display

Not two progress bars. The previous pair had three problems:

1. **The colours implied a severity that does not exist.** An amber bar against
   a 100 KB quota that holds ~100 short text snippets reads as "you are in
   trouble". A 90 KB warning on a text-only library fires almost immediately and
   then cries wolf forever.
2. **The two bars were not comparable.** One was a hard browser limit, the other
   an estimate against a fictional 5 MB. Identical chrome invited reading them
   as the same kind of number.
3. **Neither answered the user's question**, which is "is my library safe, and
   is it on all my devices?" — a mode question, not a bytes question.

So the panel leads with the mode as a sentence, then reports bytes as quiet
right-aligned figures with room-left. Colour is spent only on genuinely running
out of sync room. The bar is `aria-hidden` (the number is stated beside it) and
is not rendered at 0%, so an empty library shows no empty track.

## Sidebar

- Grouped nav, search-first, `⌘K` to focus, `/` as a secondary shortcut.
- `select-none` on the whole rail: it is navigation chrome, and letting a drag
  select label text makes it feel like broken document content.
- **Resizable**, via a `role="separator"` grip that straddles the rail's right
  edge. Drag with a pointer, or Arrow keys (Shift = coarse, Home/End = limits),
  or double-click to reset. The width is persisted to `localStorage` and read
  **synchronously** on first paint, because reading it in an effect made the
  rail visibly jump on every reload.
- The search field is `type="search"`, so the UA clear button is suppressed with
  `appearance-none`. Chrome renders it as a blue pill that ignores the theme,
  which put a bright blue X in the dark-mode page. Clear remains on Escape.

## About

Version and update state, then feedback, then **Support Clipio** (GitHub
Sponsors) and **Leave a review**.

The review action is gated on `isChromiumBrowser()`. Firefox installs from AMO,
so the Chrome Web Store listing is the wrong destination — the action is hidden
there rather than shown and broken. Both open a new tab rather than navigating
the options page away.

Every setting renders through one `SettingRow` primitive:

- Hairline `border-b` divider. **No card chrome.**
- Title: `text-sm font-medium text-foreground`
- Description: `text-xs text-muted-foreground`, clamped to one line
- Control: right-aligned, fixed `220px` column so labels never reflow
- Minimum row height 44px
- Optional inline `reset to default` affordance
- `data-testid` supplied by the registry entry, never hardcoded in the row

## Shortcut grammar

`src/lib/shortcuts.ts` owns the whole grammar:

| Function | Purpose |
| --- | --- |
| `parseShortcut(s): ParsedShortcut \| null` | Tokenize `Mod+Shift+Space`. Returns `null` on garbage. |
| `formatShortcut(p, platform)` | Render `⌘⇧Space` on macOS, `Ctrl+Shift+Space` elsewhere. |
| `shortcutSegments(p, platform)` | Split a chord into per-part segments for display. |
| `matchesShortcut(p, event)` | Compare a parsed chord to a `KeyboardEvent`. |
| `isValidShortcut(p)` | Reject bare unmodified letters; require a non-modifier key. |

- `Mod` means ⌘ on macOS, Ctrl elsewhere.
- Stored form is platform-neutral (`Mod+Shift+Space`) so a sync payload is
  portable across devices.
- Recorder: click to arm → capture `keydown` → `Escape` cancels, blur cancels,
  a bare letter without a modifier is refused with inline feedback.

`matchesShortcut` replaces the hardcoded `keyMatch` in `content.ts`, so
`Cmd+K` works.

### How a chord is drawn

`shortcutSegments` returns one segment per part. The recorder renders
**modifiers as Lucide icons** (`Command`, `Keyboard` for Control, `Option`,
and an up arrow for Shift — this Lucide build ships no `Shift` glyph) and the
**trigger key as text**.

Icons for the trigger key were tried and rejected: at 12px Lucide's `Space`
glyph reads as a plain dash, so `Mod+Shift+Space` looked like it had been set
to `Mod+Shift+-`. A keycap is named by its name.

The recorder stays `role="button"` while armed. It never becomes a text field —
no characters are typed into it — so flipping to `role="textbox"` would tell a
screen reader the wrong thing about the control.

## Browser commands

Two `chrome.commands` entries, chosen because they are unambiguous and do not
need the focused element:

| Command | Manifest key |
| --- | --- |
| Open the popup | `_execute_action` |
| Toggle Clipio on this site | `clipio-toggle-site` |

Content-script chords (trigger preview, insert) deliberately stay in the
content script: `chrome.commands` cannot see the focused element and cannot be
suppressed on blocked sites.

## Danger Zone

One red-bordered group inside Storage. Each action is an `AlertDialog` naming
exactly what is lost:

- Clear IndexedDB backup — names the snippet and media stores affected
- Reset all settings — leaves snippets and images untouched, lists the keys
  cleared, offers undo via toast
- Storage backend switch — explains sync vs local and the quota consequence

## Component fixes required by this redesign

Two pre-existing defects surfaced while building it. Both are silent — nothing
fails, the UI is simply wrong.

1. **`ui/switch.tsx` never showed a checked state.** It was styled with
   `data-[state=checked]:`, which is Radix's convention. Base UI's Switch emits
   a bare `data-checked` attribute, so the rule never matched and the control
   stayed in its "off" colours at all times. Correcting it to `data-[checked]:`
   still did not paint — the generated rule matched the live element and the
   computed background stayed `var(--input)`. **The appearance is now derived
   from the `checked` prop in JS**, which removes the dependency on variant
   generation and is verifiable without a browser.
2. **Inter was downloaded but never applied.** `--font-heading` asked for
   `"Inter"`, a family no `@font-face` declared, and both the Tailwind font
   utility and the base `*` rule named `system-ui`. Same for `--font-mono`,
   which asked for `"Fira Code"` — also undeclared and unbundled, so every
   monospace surface silently fell back to the system monospace. Both now name
   families that exist, and JetBrains Mono ships in two weights with its OFL.

## Acceptance Criteria

- [x] `matchesShortcut` returns `true` for a chord stored as `Mod+K` and for
      `Mod+Shift+Space`; `false` for a chord that differs in any part.
- [x] `parseShortcut("garbage")` returns `null`; `parseShortcut("K")` returns
      `null` (modifier required).
- [x] `formatShortcut` emits `⌘` on macOS and `Ctrl` on other platforms.
- [x] Searching "confetti" lists the confetti setting and renders a live switch
      whose click persists to `confettiEnabled`.
- [x] Navigating to `#appearance` on a cold load renders the Appearance section.
- [x] Every boolean setting renders through `ui/switch.tsx`; no bespoke toggle
      markup remains in `src/components/options/`.
- [x] Snippet count, sync KB, local KB and storage mode each render **once**.
- [ ] Clear IDB, Reset all settings and storage switch each open a dialog.
      *(deferred to the danger-zone phase)*
- [x] No hardcoded English remains in `src/components/options/` (enforced by the
      existing unused-key check plus `pnpm check:locales`).
- [x] No critical/serious axe violation in **any** section, not just the default
      one — the per-section scan is what caught a 4.39:1 keycap on Expansion.
- [x] The debug log renders below its switch, and not at all while logging is off.
- [x] A failed write surfaces in its row and rolls the control back to what
      storage actually holds.
- [x] `pnpm test`, `pnpm test:coverage`, `pnpm compile`, `pnpm lint`,
      `pnpm check:locales`, `pnpm test:e2e` pass.

## Edge Cases

- **Mac/Windows divergence.** A chord synced from macOS must not double-apply
  ⌘ on Windows — hence the platform-neutral `Mod` token.
- **Platform detection.** `navigator.platform` is deprecated and returns `""`
  in the Chromium build the e2e suite uses, which silently downgraded every
  macOS chord to the `Ctrl` spelling. `currentPlatform()` checks
  `userAgentData.platform`, then `navigator.platform`, then the UA string.
- **Recorder arming is global.** While armed, the page must not scroll on
  Space/arrow keys (`preventDefault`), and a stray `/` must not jump focus to
  search. The listener is registered in the capture phase so the page's own
  handlers do not see the keystroke first.
- **Blocked sites.** Content-script chords must stay inert there; the
  `matchesShortcut` refactor must not drop the existing `isBlocked` guards.
- **Chrome's 4-suggested-key cap.** Two commands leave headroom; do not add a
  third without removing one.
- **Legacy `Ctrl+Shift+Space` values.** Already in users' storage. `parseShortcut`
  accepts the literal `Ctrl+` form. Such a value differs from the
  `Mod+Shift+Space` default, so those users see a reset button on the row — which
  is accurate, not a defect.
- **Reset button focus.** The reset affordance is `disabled:hidden`, not
  `opacity-0`, so it never takes a tab stop while invisible.
- **Storage figures.** Sizes drop a trailing `.0`, so the 100 KB sync ceiling
  reads as a limit rather than a measurement, and an empty local estimate reads
  `0 KB` rather than `~0.0 KB`.
- **Testids.** `options-nav-*` values change under the new taxonomy; the e2e
  suite was migrated in the same change rather than aliased.
- **Firefox.** `browser_specific_settings.gecko` is pinned to FF 142+; verify
  `commands` parity there before shipping the browser shortcuts.

## Change History

| Date       | Change                       | Author |
| ---------- | ---------------------------- | ------ |
| 2026-10-01 | Initial spec (options redesign) | —  |