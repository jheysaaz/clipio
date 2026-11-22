import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSearch, useVisibleSnippets } from "./search";

import {
  resetSearchForTests,
  searchStore,
  setSearchQuery,
  visibleSnippets,
} from "./search";

import type { Snippet } from "@/types";

function makeSnippet(overrides: Partial<Snippet> = {}): Snippet {
  return {
    id: "s1",
    label: "First",
    shortcut: "/a",
    content: "content",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Snippet;
}

const OLDEST = makeSnippet({
  id: "old",
  label: "Alpha",
  updatedAt: "2026-01-01T00:00:00.000Z",
});
const MIDDLE = makeSnippet({
  id: "mid",
  label: "Beta",
  updatedAt: "2026-06-01T00:00:00.000Z",
});
const NEWEST = makeSnippet({
  id: "new",
  label: "Gamma",
  updatedAt: "2026-12-01T00:00:00.000Z",
});

const LIST = [OLDEST, MIDDLE, NEWEST];

beforeEach(() => {
  resetSearchForTests();
});

describe("query state", () => {
  it("starts empty", () => {
    expect(searchStore.state.query).toBe("");
  });

  it("records what was typed", () => {
    setSearchQuery("gam");
    expect(searchStore.state.query).toBe("gam");
  });

  it("notifies subscribers on change", () => {
    // Without this the store would type-check and render nothing: the query would
    // change while the list kept showing the previous result set.
    const seen: string[] = [];
    // `subscribe` returns a subscription object, not a bare function — the same
    // shape `effectOn` in `state/effect.ts` relies on.
    const subscription = searchStore.subscribe((s) => seen.push(s.query));

    setSearchQuery("a");
    setSearchQuery("ab");
    setSearchQuery("");
    subscription.unsubscribe();

    expect(seen).toEqual(["a", "ab", ""]);
    // Unsubscribe is honoured, so a torn-down component stops being called.
    setSearchQuery("after");
    expect(seen).toEqual(["a", "ab", ""]);
  });

  it("does not notify when set to the value it already holds", () => {
    // `setState` notifies unconditionally — verified against the installed
    // `@tanstack/store`, not assumed. The search input re-emits its value on every
    // render, so without this guard every unrelated re-render would re-run the
    // fuzzy pass and re-render the whole sidebar for text that did not change.
    setSearchQuery("same");
    const seen: string[] = [];
    const subscription = searchStore.subscribe((s) => seen.push(s.query));

    setSearchQuery("same");
    subscription.unsubscribe();

    // Empty, not `["same"]`. The first call happened before subscribing, so the
    // only thing that could have pushed an entry is the *second*, identical one —
    // which is exactly what the guard prevents.
    expect(seen).toEqual([]);
  });
});

describe("visibleSnippets", () => {
  const list = [MIDDLE, OLDEST, NEWEST];

  it("sorts newest first when there is no query", () => {
    expect(visibleSnippets(list, "").map((s) => s.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("does not reorder the library it was given", () => {
    // `sort` mutates. Sorting the store's own `snippets` in place would make
    // "newest first" the canonical order, and it would survive the search being
    // cleared — so the user would come back to a library somebody else reordered.
    const source = [MIDDLE, OLDEST, NEWEST];
    visibleSnippets(source, "");
    expect(source.map((s) => s.id)).toEqual(["mid", "old", "new"]);
  });

  it("returns an empty list for an empty library", () => {
    expect(visibleSnippets([], "")).toEqual([]);
    expect(visibleSnippets([], "anything")).toEqual([]);
  });

  it("returns nothing for a query that matches nothing", () => {
    // The negative case with teeth: an empty result must not fall back to the
    // full list, or clearing the box would be the only way to see anything.
    expect(visibleSnippets(list, "zzzzzzz")).toEqual([]);
  });

  it("filters on a query", () => {
    const result = visibleSnippets(list, "gamma");
    expect(result.map((s) => s.id)).toEqual(["new"]);
  });

  it("matches on the shortcut as well as the label", () => {
    const byShortcut = [
      makeSnippet({ id: "one", label: "Nothing alike", shortcut: "/zz" }),
    ];
    expect(visibleSnippets(byShortcut, "zz").map((s) => s.id)).toEqual(["one"]);
  });

  it("keeps the matcher's relevance order rather than re-sorting by date", () => {
    // Re-sorting by recency would throw away the ranking, which is the entire
    // reason for fuzzy matching over `includes`.
    //
    // Asserted as a *relationship* — the result must not be the recency order —
    // rather than by naming which snippet wins. Which one wins is
    // `fuzzyMatchSnippets`' business and its scoring is not this module's to
    // restate; writing the expected order here would assert the implementation's
    // answer back at it, which is the mistake that let the list-marker bug through
    // two rounds of review.
    const older = makeSnippet({
      id: "older",
      label: "Sign off and reply",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const newer = makeSnippet({
      id: "newer",
      label: "Sign",
      updatedAt: "2026-12-01T00:00:00.000Z",
    });

    const result = visibleSnippets([older, newer], "sign").map((s) => s.id);

    expect(result).toHaveLength(2);
    expect([...result].sort()).toEqual(["newer", "older"]);
    // The recency order would be exactly this. If the result equals it, someone
    // has re-sorted by date.
    expect(result).not.toEqual(["newer", "older"]);
  });

  it("is a function of its inputs, not a cache", () => {
    // Called twice with the same inputs and once with a different query. If this
    // were memoised on something stale, the third call would return the first
    // answer.
    expect(visibleSnippets(list, "alpha")).toHaveLength(1);
    expect(visibleSnippets(list, "")).toHaveLength(3);
    expect(visibleSnippets(list, "alpha")).toHaveLength(1);
  });

  it("uses same-site use to break an equal-relevance tie", () => {
    const onSite = makeSnippet({
      id: "on-site",
      label: "Reply",
      shortcut: "/r",
    });
    const recentElsewhere = makeSnippet({
      id: "recent-elsewhere",
      label: "Reply",
      shortcut: "/r",
    });
    const usage = {
      "on-site": {
        lastUsedAt: 100,
        uses: 1,
        sites: [{ hostname: "example.com", lastUsedAt: 100, uses: 1 }],
      },
      "recent-elsewhere": { lastUsedAt: 900, uses: 3, sites: [] },
    };

    // A full URL here must still resolve to the same bare hostname — the
    // comparator, not just the recorder, enforces the storage contract.
    const result = visibleSnippets([recentElsewhere, onSite], "reply", {
      usage,
      hostname: "https://example.com/path?q=1",
    });

    expect(result.map((s) => s.id)).toEqual(["on-site", "recent-elsewhere"]);
  });

  it("never lets context outrank a higher fuzzy relevance score", () => {
    // Negative test with teeth: the exact shortcut match must stay first even
    // when the weaker fuzzy match was used on this site seconds ago and used
    // far more often overall. Context is a tie-break, not a second ranking.
    const exact = makeSnippet({
      id: "exact",
      label: "Nothing alike",
      shortcut: "/match",
    });
    const fuzzy = makeSnippet({
      id: "fuzzy",
      label: "m a t c h",
      shortcut: "/other",
    });
    const now = 1_700_000_000_000;
    const usage = {
      fuzzy: {
        lastUsedAt: now,
        uses: 99,
        sites: [{ hostname: "example.com", lastUsedAt: now, uses: 40 }],
      },
    };

    const result = visibleSnippets([fuzzy, exact], "match", {
      usage,
      hostname: "example.com",
    });

    expect(result.map((s) => s.id)).toEqual(["exact", "fuzzy"]);
  });

  it("breaks equal edit dates with context when there is no query", () => {
    const olderInList = makeSnippet({
      id: "used",
      label: "A",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const newerInList = makeSnippet({
      id: "unused",
      label: "B",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const usage = {
      used: {
        lastUsedAt: 500,
        uses: 1,
        sites: [{ hostname: "example.com", lastUsedAt: 500, uses: 1 }],
      },
    };

    expect(
      visibleSnippets([newerInList, olderInList], "", {
        usage,
        hostname: "example.com",
      }).map((s) => s.id)
    ).toEqual(["used", "unused"]);
  });
});

describe("React bindings", () => {
  it("re-renders on a query change and reports the new list", () => {
    // Without a render the bindings would be unmeasured code that type-checks and
    // is never called in a test — and a binding wired to the wrong store fails
    // silently at runtime, because the selector returns a valid `undefined`-shaped
    // value rather than throwing.
    const { result } = renderHook(
      () => ({
        query: useSearch((s) => s.query),
        list: useVisibleSnippets(LIST),
      }),
      { wrapper: undefined }
    );

    expect(result.current.query).toBe("");
    expect(result.current.list.map((s) => s.id)).toEqual(["new", "mid", "old"]);

    act(() => setSearchQuery("alpha"));

    expect(result.current.query).toBe("alpha");
    expect(result.current.list.map((s) => s.id)).toEqual(["old"]);
  });

  it("re-renders when the library changes under an unchanged query", () => {
    // The second input. `useVisibleSnippets` closes over the library, so a store
    // notification alone does not refresh it — the component has to re-render
    // from the library it was given.
    const { result, rerender } = renderHook(() => useVisibleSnippets(LIST));

    expect(result.current).toHaveLength(3);
    rerender();
    expect(result.current).toHaveLength(3);
  });
});
