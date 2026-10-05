# Plan: Messaging, Routing, State, Search & Assets

> Created: 2026-10-04
> Status: **Awaiting approval**

---

## Overview

Five changes, deliberately sequenced so each lands as one reviewable PR with
`pnpm verify:full` green:

| # | Change | Deps | Blast radius |
|---|--------|------|--------------|
| 0 | Firefox smoke harness (geckodriver, 4 assertions) | — | new script + CI job |
| 1 | Move non-Clipio brand icons into `src/assets/` | — | tiny |
| 2 | `@webext-core/messaging` typed protocol | 0 | background + content + diagnostics |
| 3 | Real settings search index (copy, not key names) | — | options page |
| 4 | TanStack Store, full sweep (4a–4d) | 2 | pages, components, content script |
| 5 | TanStack Router with hash routes | 4 | pages, context menu, e2e |

The ordering is not arbitrary. Router is last because routes read state from
stores; stores are before Router because migrating 25 `useState` slices and
then re-plumbing every component through route params in one PR is unreviewable.

---

## Phase 0 — Firefox smoke harness — DROPPED

**Decision (2026-10-04): not doing it. Chromium e2e stays the only browser gate.**

Two reasons, and the second is the one that decides it:

1. Playwright cannot load extensions into Firefox. Its docs guide is titled
   "Chrome extensions"; extension loading is a Chromium launch flag
   (`--load-extension`) reachable only through
   `chromium.launchPersistentContext()`. `playwright.config.ts` has one project
   hardcoded to `.output/chrome-mv3` for exactly this reason. There is no Firefox
   project to add.
2. The only route would be geckodriver's `moz/addon/install` driven over raw HTTP
   by a hand-written script — a new harness, in a language this repo does not
   otherwise use, that cannot be run or debugged on the development machine.
   **Shipping a gate that has never been executed is worse than having no gate**,
   because it reads as coverage that does not exist. `docs/decisions/0007` is
   explicit that the tests are the specification, and an unrun script is not a
   test.

CI still builds and zips the Firefox target (`.github/workflows/ci.yml`,
`build-validation`), so a Gecko-only *compile* breakage is caught. What is not
caught is Gecko-only *runtime* behaviour in the messaging layer. Recorded here so
it is a known hole rather than a surprise.

**Consequence for Phase 2:** `@webext-core/messaging` reads `chrome.runtime`
through the callback form, which Firefox implements identically, so the risk is
low but not zero.

---

## Findings that shape the plan

These were verified against the source, not assumed.

### 1. Settings search currently matches i18n *key names*, not user-visible copy

`src/components/options/settings/registry.ts:551`

```ts
const title = normalizeQuery(entry.titleKey.split(".").pop() ?? "");
```

For `titleKey: "options.setting.previewEnabled.title"` this indexes
`"previewenabled"`. So typing **"show a preview before inserting"** — the words
actually on screen — returns nothing. The `descKey` is not indexed at all. The
`keywords` field exists and is wired, but it is the only hand-maintained
synonym list, and there are 11 settings.

This is the highest-value, lowest-risk fix in the set.

### 2. `@webext-core/messaging@4.0.0` details

Read from the published bundle:

- Uses **`chrome.*` with the callback form**, not `browser.*`. Firefox-safe by
  construction (Firefox exposes `chrome.*` with callbacks) and identical to what
  WXT gives us. No `webextension-polyfill` needed.
- Wire format is `{ id, type, data, timestamp }`. Every existing raw message in
  the repo (`{ type: MEDIA_GET_DATA_URL, mediaId }`) must migrate on **both**
  ends at once.
- `sendMessage(type, data, tabId)` is supported — this directly replaces the
  hand-rolled `tabs.sendMessage` in `DiagnosticsPanel`.
- `addRootListener` spreads **`sender` into the received message**. That is a
  free upgrade for decision `0001-reject-untrusted-events`, but the library does
  **not** enforce it. We still must check `sender.id === runtime.id` in every
  handler ourselves.
- Rejects unknown-format messages silently unless `throwOnUnknownMessageFormat`
  is set. We keep it off — a hostile page must not be able to crash us.
- Handler throws are serialised and re-thrown on the caller side via
  `@aklinker1/zero-serialize-error`. A genuine improvement: today a background
  failure surfaces as `{ dataUrl: null }` and the content script cannot tell
  "not found" from "broken".
- **One listener per type per JS context — a second `onMessage` for the same
  type throws.** The content script's two listeners (ping + dev Sentry test) use
  different types, so this is safe, but it constrains future refactors.
- Peer dep `@types/chrome` is `*`. WXT already supplies the `browser` global;
  we add `@types/chrome` as a devDependency only for the import to typecheck.

### 3. TanStack hash history: bare hashes still parse, but search params do not

Read from `@tanstack/history`:

```js
createHref: (href) => `${win.location.pathname}${win.location.search}#${href}`
parseLocation: () => { ... parseHref(pathPart + win.location.search + ...) }
```

Two consequences:

- `#blocked-sites` parses to pathname `/blocked-sites` (`normalizeHref` prepends
  the slash). **Existing deep links keep working.** New navigations will emit
  `#/blocked-sites`. Both forms are accepted, so `#feedback` from the context
  menu and `#import-export` from the popup empty state need no redirect shim.
- **Search params are read from `window.location.search`, i.e. before the hash.**
  A validated search must be written `options.html?focus=giphy#diagnostics`, not
  `#diagnostics?focus=giphy`. Any `validateSearch` design has to accept this, and
  it is a real constraint on what we put in the URL.

### 4. Bundle budget is already the tightest constraint

`wxt.config.ts` sets `chunkSizeWarningLimit: 600` and documents a ~512 KB popup
chunk (Slate/Plate + Radix). Router + Store add real weight. Options page can be
lazy-loaded per route; the popup is already one big bundle and cannot be split
much further.

### 5. The coverage ratchet applies to everything we add

`vitest.config.ts` has `thresholds.perFile: true` at a flat 80 on all four
metrics. New `src/state/**`, `src/routes/**`, `src/lib/setting-index.ts` are
all **in** the denominator. Only `src/hooks/**`, `src/pages/**`,
`src/components/options/**` and `src/entrypoints/**` are excluded today. So the
new stores and route modules need real unit tests, and route files — which are
mostly declarative — will need either tests or a written exclusion reason.

---

## Phase 1 — Assets

`public/` is for files that must keep a stable, unhashed URL. Brand icons for
third-party import formats are neither manifest icons nor content-script assets;
they are bundled modules.

**Moves**

```
public/icon/powertext.png   →  src/assets/brands/powertext.png
public/icon/textblaze.png   →  src/assets/brands/textblaze.png
```

**Stays in `public/icon/`** (deliberately, and this needs saying in the PR):

- `16/32/48/96/128.png` — WXT auto-discovers `manifest.icons` from
  `public/icon/<size>.png`. Moving them breaks the manifest.
- `16.png` additionally is a `web_accessible_resources` entry because the
  content-script preview header loads it from a web page. Bundled assets are
  not web-accessible by default and never would be here.

**Changes**

- `src/lib/importers/{powertext,textblaze}.ts` — `iconUrl` becomes
  `import powertextUrl from "~/assets/brands/powertext.png"`.
- `src/components/options/settings/panels/LibraryPanel.tsx:183-185` — drop the
  `/icon/*.png` string literals; `iconUrl` from the parser is already threaded
  through.
- `wxt.config.ts` — no WAR change (brand icons were never web-accessible).

**Tests** — a negative test asserting the imported value is a non-empty string
and that `iconUrl` is not a `/icon/` path. The existing importer suites already
cover parsing; this covers the wiring.

**Risks** — the importers become modules that import binary assets, so their
existing unit tests now pull a PNG through Vite. Vitest resolves those to a URL
string; verified by running the importer suites in this phase, not assumed.

---

## Phase 2 — `@webext-core/messaging`

New `src/lib/protocol/` (the existing `src/lib/messages.ts` moves here):

```
src/lib/protocol/index.ts   defineExtensionMessaging<...>() + typed re-exports
src/lib/protocol/types.ts   every message + request/response pair
```

`defineExtensionMessaging` is typed via a declaration-merged `MessagesMap`, so
`sendMessage("media:get-data-url", { mediaId })` is checked end to end and a
renamed type is a compile error. This is the real win over `src/lib/messages.ts`,
which types exactly one message by hand.

**Migrated messages**

| Constant | From → To | Direction |
|---|---|---|
| `MEDIA_GET_DATA_URL` | `media-get-data-url` → `"media:get"` | content → background |
| `CONTENT_SCRIPT_PING_MESSAGE_TYPE` | `clipio-ping` → `"content:ping"` | options → content |
| `SENTRY_TEST_MESSAGE_TYPE` | `clipio-test-sentry` → `"dev:sentry-test"` | dev only |
| `SENTRY_RELAY_MESSAGE_TYPE` | kept as `"sentry:relay"` | content → background |
| **new** | `"snippets:changed"` | background → content |

**Preserved on purpose — decision 0001**

Every handler starts with:

```ts
if (sender.id !== browser.runtime.id) return undefined;
```

The library hands us `sender` for free now, so the check is *cheaper* than
today's inline version. It is not optional. A `docs/decisions/0009-*` records
that the library does not enforce this and we do.

**Serialization change, stated up front**

`MediaGetDataUrlResponse` becomes `string | null` instead of
`{ dataUrl: string | null; alt: string | null }`. The not-found case becomes a
typed error the caller can branch on, instead of a null the caller must
remember to check. `content.ts` already has a `try/catch` around the call and
already logs a warning on the missing-blob path, so the branch exists.

**Bonus — push instead of pull for the snippet cache**

Today the content script reads `local:cachedSnippets` once at `document_idle` and
the background writes it from a debounced `storage.onChanged`. With the protocol
in place the background can *push* `"snippets:changed"` to the open tab, and the
content script updates its index without re-reading storage. This makes sync
from another device land in an already-open tab, which it currently does not.

That is a behaviour change, so it is its own commit inside this phase with its
own e2e assertion — not folded in silently.

**E2E** — `e2e/messaging.spec.ts` covers "Cross-Context Communication" today
and is updated in the same change. A new negative case: a message from a
foreign `sender.id` is ignored.

---

## Phase 3 — Real settings search index

### The concrete failure

Search `options.html` for **`opendyslexic`**. Today: no results.

`font-family` carries `keywords: [..., "dyslexic", ...]`, so `dyslexic` matches
— but the string the user actually **sees** in the select is `OpenDyslexic`
(`en.yml:240`, `options.font.dyslexic`), and `searchSettings` never indexes
option labels. So `opendyslexic`, `open dyslexic`, `segoe`, `intervariable` and
`system-ui` all find nothing, even though every one of them is rendered on
screen.

### The rule

**Every character a setting renders must be searchable**, not just the
hand-authored synonym list. Per `SettingEntry` that is:

| Source | Example | Indexed today |
|---|---|---|
| `i18n.t(titleKey)` | `Interface font` | no — only the key name `fontfamily` |
| `i18n.t(descKey)` | `The typeface Clipio uses everywhere…` | no |
| `options[].labelKey` | **`OpenDyslexic`**, `Sync`, `Local` | **no** |
| `optionFonts` family names | `OpenDyslexic`, `Segoe UI`, `system-ui` | no |
| `id` split on `-` | `font`, `family`, `blocked`, `sites` | partially |
| section label | `Appearance` | no |
| `control` | `select`, `slider`, `switch` | no |
| `keywords` | `dyslexia`, `typography` | yes |

`keywords` survives as the escape hatch for words only we would think of
(`quota`, `giphy`, `confetti`). The rest is derived, so it cannot drift.

### Implementation

New `src/lib/setting-index.ts`. `registry.ts` stays declarative and
React-free; the index is a **derived, pure** artefact built from it.

```ts
export type SettingIndexEntry = {
  id: string;
  section: SectionId;
  /** Every rendered string, folded: lowercase + NFD + diacritics stripped. */
  fields: Array<{ kind: FieldKind; text: string }>;
};

export function buildSettingIndex(locale?: string): SettingIndexEntry[]
export function searchSettingIndex(
  index: SettingIndexEntry[],
  query: string
): Array<{ entry: SettingIndexEntry; score: number; ranges: MatchRange[] }>
```

`fields` is a list rather than named columns so scoring can rank *by field
kind* — an option-label hit should not outrank a title hit — without the type
growing a column per source.

**Behaviour changes**

1. Resolves real copy through `#i18n`, so what is searchable is what is drawn.
2. **Multi-token AND.** `open dyslexic` matches a single option label. Today
   only whole-query substrings match.
3. **Match ranges** come back so results can highlight the hit, like the snippet
   list already does.
4. Ranking, documented: id exact 100 → id prefix 90 → title prefix 80 → title
   word 70 → option label word 60 → keyword prefix 55 → keyword word 50 →
   desc word 30 → section label 20. Word-level beats substring, so a desc
   mention cannot outrank a title hit.

**Locale** — the index is rebuilt when the UI locale changes. `#i18n` in tests
resolves real `en.yml`, so tests assert on real copy per the existing rule.

**UI**

- Finish the half-built keyboard nav. `OptionsPage.tsx:218` already says
  "Focusable so ArrowDown from the search field can land here" and nothing
  listens. Add `role="listbox"` / `aria-activedescendant`, ↑/↓/Enter, and Enter
  navigating to the owning section.
- Highlight matched ranges in result titles.
- `⌘K` to focus the search field, mirroring the popup.

**Tests** — pure functions, so the whole thing is unit-testable with no
renderer. Negative cases: empty query returns `[]`; a query matching only a desc
word still ranks below a title hit; diacritics fold; a multi-token query where
one token is absent returns nothing.

---

## Phase 4 — TanStack Store

New deps: `@tanstack/store` + `@tanstack/react-store`.

**Full sweep — every `useState` cluster in the app moves.** In rough order of
blast radius:

| Cluster | Slices | Destination |
|---|---|---|
| `Dashboard.tsx` | 25 | `src/state/snippets.ts` |
| `RichTextEditor.tsx` | 28 | `src/state/editor.ts` |
| `ImportWizard.tsx` | 20 | `src/state/import.ts` |
| `SnippetDetailView.tsx` | 13 | `src/state/snippets.ts` |
| `ImagesSection.tsx` | 11 | `src/state/media.ts` |
| `NewSnippetView.tsx`, `ImagePicker`, `GifPicker`, `BlockedSitesPanel`, `DebugLogPanel`, `AboutPanel` | 4–9 each | per-feature stores |
| `ThemeContext` / `FontContext` | 2 providers | `src/state/settings.ts` |

This is the largest phase by a wide margin. It gets split into **four PRs**, one
per cluster group, so review stays tractable and a regression is bisectable:

- **4a** `settings.ts` — absorbs `ThemeContext` and `FontContext`. Smallest, and
  it proves the storage-bridge pattern. `src/hooks/**` is already
  coverage-excluded, so this one is nearly free on the gate.
- **4b** `snippets.ts` + `search.ts` — the Dashboard sweep, plus the derived
  `filteredSnippets` replacing the `useMemo` at `Dashboard.tsx:405`. **Done.**
- **4c** `media.ts` + `import.ts` — images and the import wizard. **Done.**
- **4d** `editor-selection.ts` + `editor-media.ts` — the Plate editor, split in two
  as decided below. **Done.** See the coverage warning.

**Phase 4 is complete.** Nine store modules in `src/state/`, every one above the
flat-80 ratchet on all four metrics. `ImagesSection.tsx` and `RichTextEditor.tsx`
hold no `useState` at all; `Dashboard.tsx` holds two and `ImportWizard.tsx` two,
all four deliberately local (see "Deliberately left as component state").

### The coverage trap in 4d

This is the one thing in the plan I want a decision on before starting.

`RichTextEditor.tsx` is on the explicit exclusion list in `vitest.config.ts:54`
— it is excluded *as a file*. Lifting its 28 slices into a new
`src/state/editor.ts` moves that code **into the denominator**, because
`src/state/**` is not excluded and the ratchet is `perFile: true` at a flat 80.

So the sweep does not just relocate excluded code — it **promotes** it to
measured, and Plate/Slate editor state is branch-heavy and awkward to test
without a renderer. Two honest options, and both need your sign-off because
AGENTS.md puts coverage thresholds under "Ask first":

- **(a)** Write the tests. `editor.ts` split into `editor-selection.ts` (pure,
  easy) and `editor-media.ts` (holds the picker state) makes most of it
  testable in plain Node. The genuinely DOM-bound remainder is small.
- **(b)** Put `editor.ts` on the exclusion list with a written reason, matching
  the existing treatment of the file it came out of. Honest and visible, but it
  is an exclusion, so it must say exactly what is lost.

My recommendation is (a), structured as two files, with (b) as the fallback if
the tests turn out to need a renderer. **I will not lower a threshold to make
this pass.**

### The rest of the shape

```
src/state/settings.ts         theme, uiFont (replaces both contexts)
src/state/sidebar.ts          popup sidebar width, persisted and clamped
src/state/snippets.ts         library, selection, CRUD, quota + sync warnings,
                              create form, recovery, live cross-context sync
src/state/search.ts           popup query and the visible list
src/state/media.ts            media library, alt text, delete confirmation
src/state/import.ts           the wizard's step machine and its decisions
src/state/editor-selection.ts overlay state, caret context, slash-menu handoff
src/state/editor-media.ts     picker ranges and the upload error
src/state/effect.ts           the effect primitive the above are built on
```

No `index.ts`: the wiring proved unnecessary. Each store loads its own dependencies,
and a barrel would have made importing one store pull in all of them.

### Deliberately left as component state

Four slices, none of which is wizard or library meaning:

- `Dashboard`: `sidebarOpen` — a collapsed sidebar is not worth remembering.
- `Dashboard`: `updateRelease` / `showUpdateBanner` — an update-check concern with
  no other state, and it needs its own module rather than a home in `snippets.ts`.
- `ImportWizard`: the two bulk-resolution radio selections — which button is
  pressed, and what is typed into a rename field. Neither survives a step change
  and neither is read by a decision.

### The coverage trap, resolved

`RichTextEditor.tsx` is on the exclusion list, so lifting its state out promoted it
into the denominator. It happened: `editor-selection.ts` first came in at 66% on
branches. **The threshold was not lowered** — the missing branches were the
`useOverlayFlag` adapter's, and they now have tests. `editor-media.ts`,
`search.ts` and `sidebar.ts` are at 100% across all four metrics.

**Where Store earns its keep beyond tidiness**

- **Derived state.** `filteredSnippets`, `quotaWarning`, `isEmpty` become
  `Derived`, so there is no `useMemo` dependency array to get wrong and they
  recompute once for every consumer rather than once per subscribing component.
- **Effects replace persistence glue.** `Effect` for "write sidebar width",
  "write theme", "rebuild the shortcut index", "refresh cache on storage
  change" — all currently hand-rolled `useEffect`s, several with subtle
  teardown timing.
- **Live cross-context sync.** Today the popup and options page each load
  snippets once on mount and never re-read. A store subscribed to
  `storage.onChanged` means an edit in the options page shows up in an open
  options tab immediately, and a snippet deleted on another device disappears
  live.
- **Content script holds a store too.** `content.ts` calls
  `buildShortcutIndex(snippets)` and keeps it in a plain variable. A vanilla
  `@tanstack/store` Store holds `ShortcutIndex` as state; the `"snippets:changed"`
  push from Phase 2 becomes a store update. No DOM, no React, fully testable in
  Node. This is the strongest argument for Store in the repo and I would do it
  even if nothing else used the library.

### What does not move, even in a full sweep

- **`isSaving`, `createError`, a drag-in-progress flag, a slider's live value.**
  Per-instance interaction state. Centralising it is the classic Store
  anti-pattern and would make both the code and the coverage worse. The line is:
  *state that outlives the component, or that a second component needs* goes in
  a store; *state that only this component's current interaction needs* stays
  local.
- **Slate's own editor instance.** `RichTextEditor` holds a `PlateEditor` object
  that Plate manages. That stays a `useState` ref. Only Clipio's state *around*
  Plate moves.
- **One store per domain, not one store per component.** Two components reading
  the same store is the entire point; a `ImportWizardStepState` store that only
  the wizard reads is just `useState` with extra ceremony.

**Coverage** — every `src/state/**` file is in the denominator at 80 per-file.
They are thin, and Derived/Effect logic is testable in plain Node without a
renderer, so this should be comfortable rather than a fight.

---

## Phase 5 — TanStack Router

New dep: `@tanstack/react-router`. `history: createHashHistory()` for both
`popup.html` and `options.html`.

**Options page — the real win**

Current routing is ~15 lines of `hashchange` + `useState<SectionId>` in
`OptionsPage.tsx`. Replaced by a typed route tree:

```
/                        → redirect to /library
/library
/images
/expansion
/blocked-sites
/appearance
/storage
/diagnostics
/about
```

Typed `SectionId` becomes the router's own route param type, so the
`SECTIONS` array stops being a second source of truth for "what sections
exist" — it becomes a projection of the route tree.

Features we actually use, not decoration:

- **`useBlocker`** replaces the `detailHasChanges` ref +
  `pendingSnippet` dance. Navigating away from a dirty editor raises the
  `ConfirmDialog` through the router's own blocking mechanism, so back/forward
  buttons and sidebar clicks are guarded by one code path instead of one.
- **`notFoundComponent`** — a real 404 section instead of silently landing on
  `library`. Bonus: a bad deep link is now a bug report we can see.
- **Lazy route components** — replaces `lazy(() => import(...))` in the popup
  and gives the options page per-section code splitting, which offsets the
  bundle cost in Finding 4.
- **`Link` with `activeOptions={{ exact: true }}`** replaces
  `activeSection={section}` threading.
- **Preloading** — hovering a sidebar item preloads its chunk.
- **Search params as state** — the options search query becomes
  `validateSearch`d URL state. Shareable, back-button-correct. Per Finding 3 it
  serialises as `options.html?q=preview#appearance`.

**Snippet selection lives in the URL — and so do sub-sections**

**Decision (2026-10-04): yes, `/#/snippet/$id` is the selection route, and the
options page gets sub-routes as well as section routes.**

The deciding argument is forward-looking: if Clipio grows "open this specific
snippet" — a context-menu entry, a notification, a keyboard shortcut, a link
from elsewhere — a selection held in component state has no address. The caller
would have to invent a side channel, and every such feature would invent its own.
A route is the address; the feature then just builds a location.

The same reasoning applies to the options page, and it is the larger half:

- `#/library/import` — the import/export panel, not merely the Library section
  that happens to contain it.
- `#/appearance` — Appearance, as today.

**Why a path segment rather than a query parameter.** Finding 3, and it is
load-bearing here. With hash history TanStack reads search params from
`window.location.search` — *before* the hash — so `?modal=import` would have to
be written `options.html?modal=import#library`: unreadable, and it puts state
somewhere unrelated to the thing it describes. A path segment keeps it in one
place: `#/library/import`.

**Consequence for the registry.** `SectionId` stops being the only routing
vocabulary. `SECTIONS` remains the source of truth for the *nav*; the router
gains sub-routes beneath those sections. `sectionFromHash` and its
`SECTIONS.some(...)` validation disappear — the route tree does that now, with
`notFoundComponent` for a bad id.

**Popup — replace-only, but genuinely addressed**

The popup is 680×460 and dies on blur, so history entries there are a liability:
the user presses Back and the popup is already gone. But the selection route is
still worth having, because it is an *address*, not a history entry.

- `#/list` — the default.
- `#/snippet/$id` — a specific snippet selected.
- `#/new` — the create form.

The context menu's "save selection" draft keeps travelling as it does today,
through `contextMenuDraftItem`; the route only decides *which view* to boot into.
So the popup navigates to `#/new` on open when it finds a draft, rather than
discovering it in a mount effect and flipping a boolean.

`replace` only, so `history.length` never grows while the popup is open.

**Context menu / deep links**

`background.ts` stops concatenating strings, and the two existing hand-built
links become real routes rather than query params:

- `options.html#feedback` → `#/about/feedback`
- `options.html#import-export` (Dashboard empty state) → `#/library/import`

Both keep working as bare hashes (Finding 3), and each gets an explicit route so
the old string is not a redirect nobody remembers to maintain.

**Devtools** — `@tanstack/react-router-devtools`, gated behind
`import.meta.env.DEV`. Not shipped.

**e2e impact** — `e2e/options.spec.ts` and `e2e/popup.spec.ts` select by
`data-testid` (`options-nav-library`, `add-snippet`, `snippet-list`, …). Per
AGENTS rule 10, every `data-testid` the router changes ownership of gets updated
in the same PR. None are renamed — only their position in the DOM moves.

New e2e, and these are the ones that matter:

- deep-linking `#/library/import` lands on the import panel
- deep-linking an unknown section renders the 404 rather than silently landing on
  Library — the behaviour change most likely to bite an existing link
- deep-linking `#/snippet/<id>` selects that snippet

---

## Gate impact

Per PR, in order: `pnpm verify`, then `pnpm verify:full` for anything touching
visible copy or component DOM. AGENTS rule 10 applies to Phases 2, 3 and 5
outright.

New decision records needed:

- `0009-messaging-validate-sender.md` — the library hands us `sender` but does
  not enforce the origin check; we do, per 0001.
- `0010-search-indexes-resolved-copy.md` — why the index is a derived artefact
  and not fields on the registry.
- `0011-router-in-the-popup-is-replace-only.md` — why the popup has an address
  for its selection but no history entries.
- `0012-assets-own-vs-bundled.md` — the `public/icon/` vs `src/assets/` rule.

---

## Open questions

Numbered so they can be answered out of order. **Resolved** entries are kept so
the reasoning survives.

1. **Assets scope — RESOLVED.** Only `powertext` + `textblaze` move, PNG kept.
   `icon/16–128.png` stays in `public/`: WXT auto-discovers manifest icons from
   there, and `16.png` is a `web_accessible_resources` entry for the
   content-script preview header.
2. **Assets format — RESOLVED.** Keep PNG.
3. **Search scope — RESOLVED.** Settings registry only. The motivating case is
   `opendyslexic` → the Appearance font setting. Snippet content/tag search is
   explicitly **out of scope**; `fuzzyMatchSnippets` is untouched.
4. **Messaging scope — RESOLVED.** Protocol layer only. `src/storage/items.ts`
   stays on WXT's `@wxt-dev/storage`.
5. **Store depth — RESOLVED.** Full sweep, split into 4a–4d.
6. **Router depth — RESOLVED.** Full: typed route tree, `useBlocker`, lazy
   routes, `notFoundComponent`.
7. **Firefox — RESOLVED (dropped).** Chromium e2e is the only browser gate; see
   "Resolved during implementation" below for why.
8. **Coverage for `editor.ts` — RESOLVED.** Option (a): write the tests, split
   into `editor-selection.ts` and `editor-media.ts`. Relevant to 4d, and the
   reason it is tractable.
9. **Router depth — RESOLVED.** Full: typed route tree, `useBlocker`, lazy
   routes, `notFoundComponent`.
10. **Popup URL surface — RESOLVED.** Snippet selection *does* live in the URL,
    as `#/snippet/$id`, so a future "open this specific snippet" feature has an
    address to build. That generalises: the options page gets sub-routes too, so
    `#/library/import` reaches the import/export panel rather than the Library
    section that happens to contain it. Path segments, not query params — see
    Finding 3.
11. **Command palette — OPEN.** Optional extra: one `⌘K` palette across
    snippets, settings and navigation, built on Router + Store. It falls out of
    Phases 4+5 almost for free, but it is new product surface, not a migration.
12. **Settings search: panel-owned content — OPEN.** The index covers registry
    entries. Panel *prose* (the import/export card text in Library, the
    diagnostics card headings) is not indexed today either. Include it, or keep
    the index to settings rows?

## Resolved during implementation

Recorded because each contradicts something this plan asserted.

- **`@tanstack/store@0.11.2` ships no `Effect` and no `Derived`.** Both were
  assumed above. The real surface is `Store` (`setState` / `get` / `subscribe`),
  `createAtom`, and the React bindings. `src/state/effect.ts` implements the
  run-once-then-on-change contract on `subscribe` — the primitive `Effect` was
  built on — with the same signature, so swapping the real one in later is a
  one-line change. Derived values need `createAtom`.
- **`setState` takes the full next state, not a patch.** Every call site spreads
  `prev`.
- **Errors lose their prototype across a context boundary** under
  `@webext-core/messaging`. `name` and `message` survive, the prototype does
  not, so `instanceof` is silently false in the receiving context. See
  `docs/decisions/0009`.

## Bugs found and fixed on the way

- **The legacy-theme migration had never run.** `themeModeItem` is declared with
  `defaultValue: "system"`, so an absent key resolves to `"system"` rather than
  to anything the guard rejected — making the fallback dead code. A user
  upgrading from a build that only wrote `local:theme` silently lost their saved
  dark preference. Fixed with a raw storage presence check, because a typed item
  cannot distinguish absent from default.
- **The settings test harness could not observe a watcher.**
  `wxt/utils/storage`'s `watch` was `() => () => {}`, registering nothing, so
  cross-context font adoption was untestable — and a test asserting it failed as
  though the store were at fault. Watchers now fire on write.