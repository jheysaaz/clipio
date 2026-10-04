# 0011 — The popup and the options page get addresses, not just a hash

Date: 2026-10-04
Status: Accepted

## Context

Options routing was hand-rolled: a `hashchange` listener plus
`useState<SectionId>` in `OptionsPage.tsx`, with `sectionFromHash` validating the
hash against `SECTIONS.some(...)`.

Three things were wrong with it, and none of them were visible from the UI:

1. **A broken link looked like a working one.** An unrecognised hash was
   rejected and silently replaced with Library. `#feedback` — which
   `background.ts` has produced since the context menu shipped — was never a
   section id, so that link had always landed somewhere other than where it
   pointed. A user following it got a working page and no signal that they had
   been sent somewhere else.
2. **The section list existed twice.** The registry declared it, and
   `sectionFromHash` validated against it. Adding a section meant editing the
   registry and hoping the validator agreed.
3. **A section was the only addressable thing.** Linking to *the import panel*
   or *the feedback form* was not expressible, so those links were built as
   hashes that happened to fall through to Library.

## Decision

**Hash routing with a real route tree, generated from the registry, with
sub-routes.**

- One route per entry in `SECTIONS`, so the nav and the router cannot disagree
  about what exists.
- Sub-routes beneath the sections that have an addressable part:
  `#/library/import`, `#/about/feedback`.
- `notFoundComponent` for an unknown path, replacing the silent fallback.
- The two shipped hashes that name no section — `#feedback` and
  `#import-export` — are rewritten to their routes on load, by
  `legacyHashRedirect`.

### Path segments, not search params

With hash history, TanStack reads search params from `window.location.search` —
*before* the hash. So `?panel=import` would have to be written
`options.html?panel=import#library`: unreadable, and it puts the state nowhere
near the thing it describes. A path segment keeps it in one place.

### The rewrite uses `location.replace`, not assignment

Assigning `location.hash` pushes a history entry, so Back would step from
`#feedback` to `#feedback` and appear to do nothing. The rewrite also puts the
address bar and the router back in agreement — a bookmark left reading
`#feedback` while the app believed it sat at `#/about/feedback` would make the
back button and any copied link disagree with what the user can see.

### The popup: an address, but still no history

The popup is 680×460 and dies on blur, so history entries there are a liability.
But `#/snippet/$id` is still the selection route, because it is an *address*,
not a history entry: if Clipio grows "open this specific snippet" — a context-menu
entry, a notification, a keyboard shortcut — the caller builds a location rather
than inventing a side channel. Navigation there is `replace` only, so
`history.length` never grows while the popup is open.

The context-menu draft keeps travelling through `contextMenuDraftItem` as before.
The route decides only which *view* boots.

## Consequences

- **An unknown hash now shows a not-found page.** Deliberate, and the behaviour
  change most likely to surprise an old bookmark — which is why it has an e2e
  test asserting the 404 rather than a section.
- **`sectionFromHash` is gone**, along with its second copy of the section list.
- **The context menu and the popup's empty state now build routes**, so they stop
  producing hashes that name no section. The legacy rewrite exists for links
  already in the wild, not for new ones.
- **`src/routes/options.tsx` is measured at the usual 80, with no exclusion.**
  Most of it is declarative, but two things in it are real logic and are tested:
  `legacyHashRedirect` and `sectionIdFromPath`. The route assembly is tested by
  building a router from the tree, which is the only thing that forces TanStack
  to call every `getParentRoute`.

## Alternatives rejected

- **Leave `sectionFromHash` and add the sub-routes around it.** Keeps two
  sources of truth and keeps the silent fallback, which is the actual bug.
- **Search params for the sub-route.** Unusable — see above.
- **Rewrite legacy hashes inside the router** rather than before it mounts. Then
  the address bar keeps showing `#feedback` while the app runs at
  `#/about/feedback`, and any copied link is wrong.

## A bug this caught

`addChildren` *mutates* its parent. Listing `libraryRoute` in the flat spread of
root children and again as a parent registered it twice, and TanStack rejected
the whole tree with `Duplicate routes found with id: /library` — a blank options
page, not a warning. Nothing short of building a router in a test found it;
importing the module and asserting on its exports does not.