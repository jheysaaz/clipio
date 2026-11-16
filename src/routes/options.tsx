/**
 * The options page route tree.
 *
 * ── Why routes are generated from `SECTIONS` ─────────────────────────────────
 *
 * The page previously kept its own copy of "which sections exist" in
 * `sectionFromHash`, validating a hash against `SECTIONS.some(...)`. That was a
 * second source of truth: adding a section meant editing the registry *and*
 * remembering nothing else, but adding a *route* to the sidebar meant also
 * remembering the hash validator would accept it. Generating the routes from the
 * same array makes the two impossible to disagree.
 *
 * ── Why sub-routes exist ────────────────────────────────────────────────────
 *
 * A section is not the only thing worth linking to. `#/library/import` reaches
 * the import/export panel; `#/about/feedback` opens the feedback form. Both were
 * wanted as URLs, and a section-level route could not express either.
 *
 * ── Why path segments and not search params ─────────────────────────────────
 *
 * With hash history, TanStack reads search params from `window.location.search`
 * — *before* the hash. So `?panel=import` would have to be written
 * `options.html?panel=import#library`: unreadable, and it puts the state nowhere
 * near the thing it describes. Path segments keep it in one place.
 */

import {
  createRootRoute,
  createRoute,
  createHashHistory,
  redirect,
} from "@tanstack/react-router";

import {
  SECTIONS,
  type SectionId,
} from "@/components/options/settings/registry";
import { OptionsShell } from "@/pages/options/OptionsShell";
import { SectionView } from "@/pages/options/SectionView";
import { LibraryImportPanel } from "@/pages/options/LibraryImportPanel";
import { AboutFeedbackPanel } from "@/pages/options/AboutFeedbackPanel";
import { OptionsNotFound } from "@/pages/options/OptionsNotFound";

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export const rootRoute = createRootRoute({
  component: OptionsShell,
  // A path that exists but is not a page — `#/library/import/extra`, say — or a
  // section id that was renamed. Previously `sectionFromHash` swallowed both and
  // silently landed on Library, which is indistinguishable from the link working.
  notFoundComponent: OptionsNotFound,
});

// ---------------------------------------------------------------------------
// `/` → redirect to the first section
// ---------------------------------------------------------------------------

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    // `redirect()` rather than a thrown literal: the helper attaches the marker
    // the router looks for. A plain `{ redirect: … }` object is just an error to
    // it, so `/` would render the not-found view instead of landing on Library.
    throw redirect({ to: "/library", replace: true });
  },
});

// ---------------------------------------------------------------------------
// One route per section, straight from SECTIONS
// ---------------------------------------------------------------------------

const sectionRoutes = SECTIONS.map((section) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: `/${section.id}`,
    // One shared component for every section, not a closure per section. It
    // derives which section it is from the matched path, so the route module
    // holds no per-route functions at all — just data.
    component: SectionView,
  })
);

/**
 * Section id → its route.
 *
 * Keyed by the registry's own id rather than by searching for a route whose
 * `path` matches. TanStack normalises `path` internally, so matching on it means
 * depending on a representation that is not part of its public contract — and
 * this lookup runs at module load, so a mismatch is a blank options page rather
 * than a failed test.
 */
const routesBySection = new Map<SectionId, (typeof sectionRoutes)[number]>(
  SECTIONS.map((section, i) => [section.id, sectionRoutes[i]])
);

/** `/library` by id, resolved from the registry rather than hard-coded. */
function sectionRoute(id: SectionId) {
  const found = routesBySection.get(id);
  if (!found) {
    // Unreachable while `id` is a `SectionId`, and the point of the throw is that
    // a new section added to the union but not to `SECTIONS` fails loudly here
    // rather than producing a route that silently renders nothing.
    throw new Error(`No route for section "${id}"`);
  }
  return found;
}

const libraryRoute = sectionRoute("library");
const aboutRoute = sectionRoute("about");

// ---------------------------------------------------------------------------
// Sub-routes — the parts of a section worth linking to directly
// ---------------------------------------------------------------------------

/**
 * `/library/import` — the same section, with the import/export panel brought
 * into view. Reached from the popup's empty state and from anywhere else that
 * wants to send a user straight to importing.
 */
const libraryImportRoute = createRoute({
  getParentRoute: () => libraryRoute,
  path: "/import",
  component: LibraryImportPanel,
});

/**
 * `/about/feedback` — the feedback form, open.
 *
 * `background.ts` has always linked here as `options.html#feedback`. That hash
 * never matched a section id, so `sectionFromHash` rejected it and the user
 * landed on Library — the link worked and arrived somewhere else. This route is
 * what it was always trying to be.
 */
const aboutFeedbackRoute = createRoute({
  getParentRoute: () => aboutRoute,
  path: "/feedback",
  component: AboutFeedbackPanel,
});

// ---------------------------------------------------------------------------
// Assembled tree
// ---------------------------------------------------------------------------

/** Exposed for tests: the `/` route's redirect, and the section lookup. */
export const _internals = { indexRoute, sectionRoute, routesBySection };

export const routeTree = rootRoute.addChildren([
  indexRoute,
  // Every section except the two that gain sub-routes.
  //
  // `addChildren` *mutates* the parent and returns it, so listing `libraryRoute`
  // in the flat spread and then again as a parent registers it twice — and
  // TanStack rejects the tree with "Duplicate routes found with id: /library".
  // That is a blank options page, not a warning, and the only thing that caught
  // it was the test which builds a router from this tree.
  ...sectionRoutes.filter(
    (route) => route !== libraryRoute && route !== aboutRoute
  ),
  // No index child route: with no sub-route matched, SectionView's own `<Outlet />`
  // renders nothing, which is exactly the plain `/library` and `/about` case. An
  // index route holding a second `<Outlet />` would only nest them.
  libraryRoute.addChildren([libraryImportRoute]),
  aboutRoute.addChildren([aboutFeedbackRoute]),
]);

// ---------------------------------------------------------------------------
// Legacy hashes
// ---------------------------------------------------------------------------

/**
 * Hashes that shipped before the router, mapped onto routes that exist.
 *
 * A bare `#about` already parses as `/about` — `normalizeHref` prepends the
 * slash — so the section links need nothing. These two do not: neither name is a
 * section id, so they would 404 without a redirect.
 *
 * Mapped by string rather than by `beforeLoad` so the URL is *rewritten* to the
 * canonical form. Leaving a bookmark reading `#feedback` while the app believes
 * it is at `#/about/feedback` would make the back button and a shared link
 * disagree with the address bar.
 */
export const LEGACY_HASH_REDIRECTS: Readonly<Record<string, string>> = {
  feedback: "/about/feedback",
  "import-export": "/library/import",
};

/**
 * The canonical hash for a pre-router hash, or `null` when it needs none.
 *
 * Pure and exported so it can be unit-tested against every hash that has ever
 * shipped, which is the only way to be sure a bookmark still lands somewhere
 * real. Returns `null` rather than a rewritten value for a hash that is already
 * correct, so the caller does not touch the address bar unnecessarily — a
 * needless `location.replace` would discard the entry from session history.
 */
export function legacyHashRedirect(hash: string): string | null {
  const bare = hash.replace(/^#\/?/, "");
  if (!bare) return null;
  if (isSectionRoute(bare)) return null;
  return LEGACY_HASH_REDIRECTS[bare] ?? null;
}

/** Whether a bare segment names a section, and so already parses correctly. */
function isSectionRoute(bare: string): boolean {
  return SECTIONS.some((section) => section.id === bare);
}

/** The section a route path belongs to, for the sidebar's active state. */
export function sectionIdFromPath(pathname: string): SectionId | null {
  const first = pathname.split("/").filter(Boolean)[0];
  return SECTIONS.some((s) => s.id === first) ? (first as SectionId) : null;
}

/**
 * The hash-history instance.
 *
 * `options.html` is a static file with no server to rewrite paths, and the
 * browser must not treat everything after `?` as a query string — so hash
 * routing it is. Created once and shared: a second history instance would fight
 * the first over `hashchange`.
 */
export const optionsHistory = createHashHistory();
