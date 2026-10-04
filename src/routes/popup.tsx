/**
 * The popup route tree.
 *
 * ── Why the popup is routed at all ──────────────────────────────────────────
 *
 * The popup is 680×460 and closes on blur, so history entries there are a
 * liability rather than a feature. But an *address* is not a history entry.
 *
 * The case that decided it: if Clipio grows "open this specific snippet" — a
 * context-menu entry, a notification, a keyboard shortcut, a link from the
 * options page — a selection held in `useState` has no address, so the caller
 * would have to invent a side channel and every such feature would invent its
 * own. A route is the address; the feature then builds a location.
 *
 * So: routes, and `replace` only. `history.length` never grows while the popup
 * is open, which is what keeps the Back button from being a liability.
 *
 * ── Why the draft does not travel in the URL ────────────────────────────────
 *
 * The context menu's "save selection" text can be arbitrarily long. With hash
 * history, search params are read from `window.location.search` — *before* the
 * hash — so putting it there would mean a URL that long selection is pasted into
 * the address bar, kept in history, and shareable. It keeps travelling through
 * `contextMenuDraftItem` exactly as before; the route decides only which *view*
 * boots.
 *
 * ── Why every route renders nothing ─────────────────────────────────────────
 *
 * The three routes are address-only: the root owns `Dashboard` and each child
 * exists purely so a path can match. The obvious alternative — giving each route
 * `component: Dashboard` — would make `Dashboard` a *different* component per
 * route, so React unmounts and remounts it on every selection change, re-running
 * the load-from-storage effect and throwing away scroll position. An address
 * should not cost a remount.
 */

import {
  createRootRoute,
  createRoute,
  createHashHistory,
  redirect,
} from "@tanstack/react-router";

import Dashboard from "@/pages/popup/Dashboard";

/** The view with a list and no particular selection. */
export const LIST_ROUTE = "/list" as const;
/** The create form. */
export const NEW_ROUTE = "/new" as const;
/** One specific snippet, by id. */
export const SNIPPET_ROUTE = "/snippet/$snippetId" as const;

export const rootRoute = createRootRoute({
  component: Dashboard,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    // `redirect()` rather than a thrown literal: the helper attaches the marker
    // the router looks for, and a plain `{ redirect: … }` is just an error to it.
    throw redirect({ to: LIST_ROUTE, replace: true });
  },
});

const listRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: LIST_ROUTE,
});

const newRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: NEW_ROUTE,
});

const snippetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SNIPPET_ROUTE,
});

export const popupRouteTree = rootRoute.addChildren([
  indexRoute,
  listRoute,
  newRoute,
  snippetRoute,
]);

/**
 * The hash-history instance.
 *
 * Created once and shared: a second one would fight the first over `hashchange`,
 * and the popup mounts exactly one router per open.
 */
export const popupHistory = createHashHistory();

/** What the current path is asking the popup to show. */
export type PopupView =
  { kind: "list" } | { kind: "new" } | { kind: "snippet"; id: string };

/**
 * Reads a view out of a pathname.
 *
 * Pure and exported so the mapping can be unit-tested without a browser, and so
 * `Dashboard` and the context-menu flow agree on what a path means without
 * either owning it.
 */
export function viewFromPath(pathname: string): PopupView {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "new") return { kind: "new" };
  if (segments[0] === "snippet" && segments[1]) {
    return { kind: "snippet", id: segments[1] };
  }
  return { kind: "list" };
}
