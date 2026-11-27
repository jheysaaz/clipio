/**
 * Tests for the popup route tree.
 *
 * `viewFromPath` is the mapping between a URL and what the popup shows, and both
 * the dashboard and the context-menu flow depend on it agreeing. It is pure, so
 * it is tested here directly; the wiring is proved by the e2e suite driving real
 * URLs.
 */

import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";

import {
  LIST_ROUTE,
  NEW_ROUTE,
  SNIPPET_ROUTE,
  popupRouteTree,
  viewFromPath,
} from "./popup";

describe("viewFromPath", () => {
  it("reads the list", () => {
    expect(viewFromPath("/list")).toEqual({ kind: "list" });
  });

  it("reads the create form", () => {
    expect(viewFromPath("/new")).toEqual({ kind: "new" });
  });

  it("reads a specific snippet by id", () => {
    // The case that decided the routing: a selection needs an address so a future
    // "open this specific snippet" can build a location.
    expect(viewFromPath("/snippet/abc-123")).toEqual({
      kind: "snippet",
      id: "abc-123",
    });
  });

  it("treats an id containing a dash as one segment", () => {
    expect(viewFromPath("/snippet/a-b-c")).toEqual({
      kind: "snippet",
      id: "a-b-c",
    });
  });

  it("decodes an encoded id from a Used in link", () => {
    // Imported ids can contain `/`, `?` and `#`; the options page encodes them
    // before asking the popup to open one.
    expect(viewFromPath("/snippet/a%2Fb%3Fc%23d")).toEqual({
      kind: "snippet",
      id: "a/b?c#d",
    });
  });

  it("falls back to the list when an id has a broken escape", () => {
    // A malformed path must not become a selection for an invented snippet id.
    expect(viewFromPath("/snippet/%E0%A4%A")).toEqual({ kind: "list" });
  });

  it("falls back to the list for the root and for unknown paths", () => {
    expect(viewFromPath("/")).toEqual({ kind: "list" });
    expect(viewFromPath("")).toEqual({ kind: "list" });
    expect(viewFromPath("/nope")).toEqual({ kind: "list" });
  });

  it("treats a snippet route with no id as the list rather than an empty selection", () => {
    // `/snippet` with nothing after it must not become a snippet view with an
    // undefined id, which would render a detail pane for nothing.
    expect(viewFromPath("/snippet")).toEqual({ kind: "list" });
    expect(viewFromPath("/snippet/")).toEqual({ kind: "list" });
  });
});

describe("the assembled popup tree", () => {
  function makeRouter(path: string) {
    return createRouter({
      routeTree: popupRouteTree,
      history: createMemoryHistory({ initialEntries: [path] }),
    });
  }

  it("builds without a duplicate-id or parent-cycle error", () => {
    expect(() => makeRouter(LIST_ROUTE)).not.toThrow();
  });

  it("redirects the bare path to the list", async () => {
    const router = makeRouter("/");
    await router.load();
    expect(router.state.location.pathname).toBe(LIST_ROUTE);
  });

  it("matches each of the three views", async () => {
    for (const path of [LIST_ROUTE, NEW_ROUTE, "/snippet/abc"]) {
      const router = makeRouter(path);
      await router.load();
      expect(router.state.location.pathname, path).toBe(path);
    }
  });

  it("keeps the snippet id in the matched params", async () => {
    // The router owns the id; `viewFromPath` re-reads it. If those two ever
    // disagreed the detail pane would show a different snippet from the one the
    // URL names.
    const router = makeRouter("/snippet/xyz");
    await router.load();
    const match = router.state.matches.find(
      (m) => m.routeId === (SNIPPET_ROUTE as unknown as string)
    );
    expect(match?.params).toMatchObject({ snippetId: "xyz" });
  });

  it("decodes an encoded id the same way the router does", async () => {
    const path = "/snippet/a%2Fb";
    const router = makeRouter(path);
    await router.load();
    const match = router.state.matches.find(
      (m) => m.routeId === (SNIPPET_ROUTE as unknown as string)
    );

    expect(match?.params).toMatchObject({ snippetId: "a/b" });
    expect(viewFromPath(path)).toEqual({ kind: "snippet", id: "a/b" });
  });
});
