import { describe, it, expect } from "vitest";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";

import {
  CLICKABLE_MENU_IDS,
  FEEDBACK_ROUTE,
  POPUP_NEW_ROUTE,
  popupRouteForAction,
  resolveContextMenuAction,
  type ContextMenuAction,
} from "./context-menu";
import { CONTEXT_MENU } from "@/config/constants";
// Imported here, and not in `context-menu.ts`, because `routes/popup.tsx` pulls in
// `Dashboard` and the whole component tree: pulling `NEW_ROUTE` in for the string
// would bundle React into the service worker. The test can afford the import, and
// being able to afford it is the whole point — the route the menu names is checked
// against the router that has to answer for it.
import { NEW_ROUTE, popupRouteTree, viewFromPath } from "@/routes/popup";

/**
 * The bug this table exists to make unreachable.
 *
 * "Give feedback" pointed at `options.html#feedback`. That was never a section
 * id, so the options page rejected the hash and the user landed on Library. The
 * link worked and arrived somewhere else — and nothing reported a problem,
 * because every layer above it succeeded.
 *
 * The old e2e spec could not have caught this: it asserted a hardcoded array of
 * menu ids against itself and imported nothing from `background.ts`.
 */

const SELECTION = "some selected text";
const PAGE = "https://example.com/some/page";

/** A route as it appears in a URL. `#/new` addresses the path `/new`. */
function pathFromHash(hash: string): string {
  return hash.replace(/^#/, "");
}

describe("resolveContextMenuAction", () => {
  it("maps every clickable id to a distinct action", () => {
    // Exhaustive over the table, so an id added to `CONTEXT_MENU` without a
    // handler fails here rather than silently doing nothing in production.
    const actions = CLICKABLE_MENU_IDS.map(
      (id) =>
        resolveContextMenuAction({
          menuItemId: id,
          selectionText: SELECTION,
          pageUrl: PAGE,
        }).kind
    );

    expect(actions).toEqual([
      "save-selection",
      "create-snippet",
      "open-dashboard",
      "open-feedback",
      "hide-on-site",
    ]);
    // And no two ids collapse onto one action, which is how a copy-paste branch
    // would present itself.
    expect(new Set(actions).size).toBe(actions.length);
  });

  it("covers every clickable id in the constant", () => {
    // The two lists must not drift. `SEPARATOR_HIDE` is excluded because a
    // separator is not clickable; `PARENT` because it only parents the others.
    expect([...CLICKABLE_MENU_IDS].sort()).toEqual(
      [
        CONTEXT_MENU.SAVE_SELECTION,
        CONTEXT_MENU.CREATE_SNIPPET,
        CONTEXT_MENU.OPEN_DASHBOARD,
        CONTEXT_MENU.GIVE_FEEDBACK,
        CONTEXT_MENU.HIDE_ON_SITE,
      ].sort()
    );
  });

  describe("save selection", () => {
    it("carries the trimmed selection", () => {
      const action = resolveContextMenuAction({
        menuItemId: CONTEXT_MENU.SAVE_SELECTION,
        selectionText: "  padded  ",
      });

      expect(action).toEqual({ kind: "save-selection", text: "padded" });
    });

    it("does nothing when there is no selection", () => {
      // The negative case. Stashing `undefined` would pre-fill the create form
      // with the string "undefined" and open the popup on it.
      expect(
        resolveContextMenuAction({ menuItemId: CONTEXT_MENU.SAVE_SELECTION })
      ).toEqual({ kind: "none" });
    });

    it("does nothing for a whitespace-only selection", () => {
      // Checked after trimming, not before. A click-drag that caught a newline
      // reports a truthy selection that is not one.
      expect(
        resolveContextMenuAction({
          menuItemId: CONTEXT_MENU.SAVE_SELECTION,
          selectionText: " \n\t ",
        })
      ).toEqual({ kind: "none" });
    });

    it("does not require a page url", () => {
      // Some hosts report a selection without a URL — a selection inside a
      // shadow root, or in a context the browser does not describe. Blocking the
      // draft on that would lose the user's selection.
      expect(
        resolveContextMenuAction({
          menuItemId: CONTEXT_MENU.SAVE_SELECTION,
          selectionText: SELECTION,
        }).kind
      ).toBe("save-selection");
    });
  });

  describe("hide on site", () => {
    it("carries the hostname of the page", () => {
      expect(
        resolveContextMenuAction({
          menuItemId: CONTEXT_MENU.HIDE_ON_SITE,
          pageUrl: PAGE,
        })
      ).toEqual({ kind: "hide-on-site", hostname: "example.com" });
    });

    it("drops the path, query and fragment", () => {
      // Blocking a whole URL rather than a host would stop working the moment the
      // user navigated anywhere else on the site.
      expect(
        resolveContextMenuAction({
          menuItemId: CONTEXT_MENU.HIDE_ON_SITE,
          pageUrl: "https://example.com/a/b?q=1#frag",
        })
      ).toEqual({ kind: "hide-on-site", hostname: "example.com" });
    });

    it("does nothing when there is no page url", () => {
      expect(
        resolveContextMenuAction({ menuItemId: CONTEXT_MENU.HIDE_ON_SITE })
      ).toEqual({ kind: "none" });
    });

    it("throws on an unparseable url rather than doing nothing quietly", () => {
      // A genuine fault, and the caller reports it. Returning `none` here would
      // make a broken host invisible: the menu item would simply never work.
      expect(() =>
        resolveContextMenuAction({
          menuItemId: CONTEXT_MENU.HIDE_ON_SITE,
          pageUrl: "not a url",
        })
      ).toThrow();
    });
  });

  describe("pages", () => {
    it("opens a real feedback route, not a legacy hash", () => {
      // The regression this file is for. `#feedback` was never a section id: the
      // options page rejected it and the user landed on Library, with the link
      // reporting success throughout.
      expect(FEEDBACK_ROUTE).toBe("#/about/feedback");
      expect(FEEDBACK_ROUTE.startsWith("#/")).toBe(true);
      // A hash with no route prefix is the shape that broke.
      expect(FEEDBACK_ROUTE).not.toBe("#feedback");
    });

    it("routes the dashboard and the create form with no input needed", () => {
      // Neither depends on the page or the selection, so a click that arrives
      // without either must still work.
      expect(
        resolveContextMenuAction({ menuItemId: CONTEXT_MENU.OPEN_DASHBOARD })
      ).toEqual({ kind: "open-dashboard" });
      expect(
        resolveContextMenuAction({ menuItemId: CONTEXT_MENU.CREATE_SNIPPET })
      ).toEqual({ kind: "create-snippet" });
    });
  });

  // ── The bug this file's route table exists to make unreachable ────────────────
  //
  // "Create new snippet" called `openPopup()` with no URL, and the popup reopens
  // at whatever route it was last showing. So the one menu item whose entire
  // meaning is *which* page to open opened whichever snippet the popup happened
  // to be showing — and nothing failed, which is what made it survive.
  describe("popupRouteForAction", () => {
    it("sends create-snippet to the popup's create route", () => {
      expect(popupRouteForAction({ kind: "create-snippet" })).toBe(
        POPUP_NEW_ROUTE
      );
    });

    it("names the route the popup's router actually has", () => {
      // Not `#/new` asserted against itself — the router decides. If `NEW_ROUTE`
      // moved, this fails rather than the menu item silently opening a 404.
      expect(POPUP_NEW_ROUTE).toBe(`#${NEW_ROUTE}`);
      expect(POPUP_NEW_ROUTE).toBe("#/new");
    });

    it("produces a URL the popup reads as the create form", async () => {
      // The two halves the popup relies on: `viewFromPath` is what `Dashboard`
      // reads to decide which view to render, and the router is what resolves the
      // address. A route that satisfies the first and not the second is a link
      // that looks right and lands on nothing.
      expect(viewFromPath(pathFromHash(POPUP_NEW_ROUTE))).toEqual({
        kind: "new",
      });

      const router = createRouter({
        routeTree: popupRouteTree,
        history: createMemoryHistory({
          initialEntries: [pathFromHash(POPUP_NEW_ROUTE)],
        }),
      });
      await router.load();

      expect(router.state.location.pathname).toBe(NEW_ROUTE);
      expect(router.state.matches.map((m) => m.routeId)).toContain(NEW_ROUTE);
    });

    it("leaves the draft's own route decision alone", () => {
      // The negative case, and the one that matters for correctness rather than
      // coverage: "Save selection" also ends on the create form, but the draft
      // decides that — it carries the text too. A route here would be a second
      // channel for one decision, free to disagree with the first.
      expect(
        popupRouteForAction({ kind: "save-selection", text: SELECTION })
      ).toBe(null);
    });

    it("asks for no route from an action that opens no popup", () => {
      // Two open a tab, one blocks a host, one does nothing. A route for any of
      // them would be a request the popup never reads.
      const actions: ContextMenuAction[] = [
        { kind: "open-dashboard" },
        { kind: "open-feedback" },
        { kind: "hide-on-site", hostname: "example.com" },
        { kind: "none" },
      ];

      for (const action of actions) {
        expect(popupRouteForAction(action), action.kind).toBe(null);
      }
    });

    it("never returns a route for a click that did nothing", () => {
      // The end-to-end version of the two tests above, driven through the real
      // resolver rather than a hand-built action — so a `none` reached from an
      // unknown id, a separator, or a missing page url is covered too.
      const clicks = [
        { menuItemId: CONTEXT_MENU.PARENT },
        { menuItemId: CONTEXT_MENU.SEPARATOR_HIDE },
        { menuItemId: CONTEXT_MENU.HIDE_ON_SITE },
        { menuItemId: "clipio-from-the-future" },
      ];

      for (const click of clicks) {
        const action = resolveContextMenuAction(click);
        expect(action.kind, click.menuItemId).toBe("none");
        expect(popupRouteForAction(action), click.menuItemId).toBe(null);
      }
    });
  });

  describe("ids with no action", () => {
    it("does nothing for the parent item", () => {
      expect(
        resolveContextMenuAction({ menuItemId: CONTEXT_MENU.PARENT })
      ).toEqual({ kind: "none" });
    });

    it("does nothing for the separator", () => {
      expect(
        resolveContextMenuAction({ menuItemId: CONTEXT_MENU.SEPARATOR_HIDE })
      ).toEqual({ kind: "none" });
    });

    it("does nothing for an id it does not recognise", () => {
      // An id from a newer build, or a host page invoking the handler directly.
      // Doing nothing is right; what matters is that it is decided rather than
      // fallen into.
      expect(
        resolveContextMenuAction({ menuItemId: "clipio-from-the-future" })
      ).toEqual({ kind: "none" });
    });

    it("returns the same frozen value every time", () => {
      // So a caller cannot mutate the shared no-op and change it for everyone.
      const first = resolveContextMenuAction({ menuItemId: "unknown" });
      const second = resolveContextMenuAction({ menuItemId: "also-unknown" });

      expect(first).toBe(second);
      expect(Object.isFrozen(first)).toBe(true);
    });
  });

  it("never returns undefined", () => {
    // The shape of a bug this table invites: a branch added with a bare `return;`
    // and a caller that then reads `.kind` off undefined. Every id is checked so
    // the union is closed.
    const ids: string[] = [
      ...CLICKABLE_MENU_IDS,
      CONTEXT_MENU.PARENT,
      CONTEXT_MENU.SEPARATOR_HIDE,
      "unknown",
      "",
    ];

    for (const menuItemId of ids) {
      const action: ContextMenuAction = resolveContextMenuAction({
        menuItemId,
        selectionText: SELECTION,
        pageUrl: PAGE,
      });
      expect(action).toBeDefined();
      expect(typeof action.kind).toBe("string");
    }
  });
});
