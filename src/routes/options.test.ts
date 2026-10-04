/**
 * Tests for the options route tree.
 *
 * The routing logic worth testing is pure and lives in `legacyHashRedirect` and
 * `sectionIdFromPath`. The tree assembly itself is declarative and is proved by
 * the e2e suite, which drives real URLs through a real browser — which is the
 * only place a hash can be checked end to end.
 *
 * `legacyHashRedirect` gets the most attention because it is the one piece of
 * routing that can silently break a link somebody is already using. The hashes
 * it handles were produced by shipped code: `#feedback` by the context menu's
 * "give feedback" item, `#import-export` by the popup's empty state.
 */

import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";

import { SECTIONS } from "@/components/options/settings/registry";

import {
  LEGACY_HASH_REDIRECTS,
  routeTree,
  _internals,
  legacyHashRedirect,
  sectionIdFromPath,
} from "./options";

// ---------------------------------------------------------------------------
// legacyHashRedirect
// ---------------------------------------------------------------------------

describe("legacyHashRedirect", () => {
  it("rewrites the context menu's feedback hash to its route", () => {
    // `background.ts` built `options.html#feedback`. That name was never a
    // section id, so the page's old hash validator rejected it and the user
    // landed on Library — the link worked and arrived somewhere else.
    expect(legacyHashRedirect("#feedback")).toBe("/about/feedback");
  });

  it("rewrites the popup's import hash to its route", () => {
    expect(legacyHashRedirect("#import-export")).toBe("/library/import");
  });

  it("accepts a leading slash, since a hash may be written either way", () => {
    expect(legacyHashRedirect("#/feedback")).toBe("/about/feedback");
    expect(legacyHashRedirect("#/import-export")).toBe("/library/import");
  });

  it("leaves a bare section hash alone", () => {
    // These already parse correctly — `normalizeHref` prepends the slash — so
    // rewriting them would push a needless history entry via `location.replace`.
    for (const section of [
      "library",
      "images",
      "expansion",
      "blocked-sites",
      "appearance",
      "storage",
      "diagnostics",
      "about",
    ]) {
      expect(legacyHashRedirect(`#${section}`), section).toBeNull();
    }
  });

  it("leaves a section sub-route alone", () => {
    expect(legacyHashRedirect("#/library/import")).toBeNull();
    expect(legacyHashRedirect("#/about/feedback")).toBeNull();
  });

  it("leaves an empty hash alone", () => {
    // `/` with no hash redirects to the first section on mount. Rewriting to
    // `#/library` here would make the redirect unreachable.
    expect(legacyHashRedirect("")).toBeNull();
    expect(legacyHashRedirect("#")).toBeNull();
    expect(legacyHashRedirect("#/")).toBeNull();
  });

  it("leaves an unknown hash alone so the router can show a not-found page", () => {
    // Deliberately *not* redirected to /library. Silently landing somewhere
    // plausible is what the old validator did, and it is why a broken link was
    // indistinguishable from a working one.
    expect(legacyHashRedirect("#nope")).toBeNull();
    expect(legacyHashRedirect("#/library/nope/deeper")).toBeNull();
  });

  it("maps only the hashes that were ever shipped", () => {
    // A guard against the table quietly growing. Every entry needs a reason, and
    // the way to check that is to see it.
    expect(Object.keys(LEGACY_HASH_REDIRECTS).sort()).toEqual([
      "feedback",
      "import-export",
    ]);
  });
});

// ---------------------------------------------------------------------------
// sectionIdFromPath
// ---------------------------------------------------------------------------

describe("sectionIdFromPath", () => {
  it("reads the section from a section route", () => {
    expect(sectionIdFromPath("/appearance")).toBe("appearance");
  });

  it("reads the section from a sub-route", () => {
    // The sidebar must show Library as current while the user is on
    // `/library/import`, or the nav disagrees with the address bar.
    expect(sectionIdFromPath("/library/import")).toBe("library");
    expect(sectionIdFromPath("/about/feedback")).toBe("about");
  });

  it("returns null for a path with no section", () => {
    expect(sectionIdFromPath("/")).toBeNull();
    expect(sectionIdFromPath("")).toBeNull();
  });

  it("returns null for an unknown first segment", () => {
    expect(sectionIdFromPath("/nope")).toBeNull();
  });

  it("ignores a trailing slash", () => {
    expect(sectionIdFromPath("/storage/")).toBe("storage");
  });
});

// ---------------------------------------------------------------------------
// Tree shape
// ---------------------------------------------------------------------------

describe("route tree", () => {
  it("redirects the bare path away from itself", () => {
    // `/` has to go somewhere. Asserted only to throw here — the test that proves
    // the *destination* is the one that builds a router and checks where it
    // lands, because the thrown object's shape is TanStack's business, not ours.
    expect(() =>
      _internals.indexRoute.options.beforeLoad?.({} as never)
    ).toThrow();
  });

  it("resolves every section id to a route", () => {
    for (const [id, route] of _internals.routesBySection) {
      expect(route, id).toBeDefined();
    }
    // One route per section, and no extras: a stray entry would be a route the
    // nav cannot reach.
    expect(_internals.routesBySection.size).toBe(SECTIONS.length);
  });

  it("throws for a section id with no route", () => {
    // The guard exists so a new `SectionId` that never reaches `SECTIONS` fails
    // loudly at module load, rather than producing a route that renders nothing.
    expect(() =>
      _internals.sectionRoute(
        "nope" as Parameters<typeof _internals.sectionRoute>[0]
      )
    ).toThrow(/No route for section/);
  });
});

// ---------------------------------------------------------------------------
// Tree assembly
// ---------------------------------------------------------------------------

describe("the assembled tree", () => {
  /**
   * Build a router sitting at `path` and report what it matched.
   *
   * Building the router is what forces TanStack to walk the tree and call every
   * `getParentRoute`. Until something does, those callbacks have never run — so
   * this is also the only place a mis-wired parent is caught without a browser.
   */
  async function matchedIdsAt(path: string): Promise<string[]> {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: [path] }),
    });
    await router.load();
    return router.state.matches.map((match) => match.routeId as string);
  }

  it("builds without a parent-cycle or duplicate-id error", () => {
    // This is the assertion that caught a real bug: `addChildren` mutates, so
    // listing a section both in the flat spread and again as a parent registered
    // it twice and TanStack refused the whole tree.
    expect(() =>
      createRouter({
        routeTree,
        history: createMemoryHistory({ initialEntries: ["/library"] }),
      })
    ).not.toThrow();
  });

  it("matches a route for every section path", async () => {
    for (const section of SECTIONS) {
      const ids = await matchedIdsAt(`/${section.id}`);
      expect(ids.length, section.id).toBeGreaterThan(0);
    }
  });

  it("matches the sub-route beneath its section", async () => {
    const library = await matchedIdsAt("/library/import");
    expect(library.length).toBeGreaterThan(1);
    const about = await matchedIdsAt("/about/feedback");
    expect(about.length).toBeGreaterThan(1);
  });

  it("matches only the root for an unknown path, which is what shows the not-found view", async () => {
    // The not-found view depends on this exactly. A path that matched a section
    // route would render a page, and a broken link would be indistinguishable
    // from a working one — which is what the old hash validator did.
    expect(await matchedIdsAt("/nope")).toEqual(["__root__"]);
  });

  it("redirects the bare path to the first section", async () => {
    // Asserted on the resolved location rather than a route id, because the id
    // is TanStack's to choose and the destination is the thing we promised.
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    expect(router.state.location.pathname).toBe("/library");
  });
});
