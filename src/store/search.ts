/**
 * Popup search state, as a store.
 *
 * ── Why the query and its results are in one place ──────────────────────────
 *
 * `Dashboard.tsx` held the query in `useState` and derived the visible list with
 * a `useMemo` whose dependency array was `[searchQuery, snippets]`. That is
 * correct today and fragile in a way worth naming: the list is also the thing the
 * keyboard handler walks, and a third piece of state appeared there too — the
 * index of the selected row. Three things that must agree, connected by an array
 * that nothing checks.
 *
 * Here they are one state, and the visible list is a function of it rather than a
 * memo someone has to remember to invalidate.
 *
 * The results are **not** cached. `filteredSnippets` was a `useMemo` because
 * recomputing it on every keystroke was thought to be wasteful; it is a sort or a
 * fuzzy pass over a list that is bounded by the storage quota (500 items), which
 * is microseconds. Caching it would buy nothing and would add a second source of
 * truth to invalidate — the exact failure this file exists to remove.
 */

import { createStore } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";

import type { Snippet } from "@/types";
import { fuzzyMatchSnippets } from "@/lib/preview-helpers";

export type SearchState = {
  /** The raw text in the search box. */
  query: string;
  /**
   * The list to show, given the query and the library.
   *
   * Not stored — see the note above. `visibleSnippets` is how it is read.
   */
};

export const searchStore = createStore<SearchState>({ query: "" });

export function setSearchQuery(query: string): void {
  // Guarded because `setState` notifies unconditionally. The search input fires on
  // every keystroke, and a controlled input re-emits its value on every render,
  // so an unguarded write re-runs the fuzzy pass and re-renders the whole sidebar
  // for text that did not change.
  if (searchStore.state.query === query) return;
  searchStore.setState(() => ({ query }));
}

/**
 * The list the sidebar should render.
 *
 * An empty query sorts by recency, newest first — the order the user expects when
 * they have not searched for anything. A non-empty query runs the fuzzy matcher,
 * which already returns its own relevance order and must not be re-sorted: doing
 * so would throw away the ranking, which is the whole reason for fuzzy matching
 * rather than `includes`.
 *
 * The no-query branch copies before sorting. `sort` mutates, and the array handed
 * in is the store's own `snippets`; sorting it in place would reorder the library
 * itself, so "newest first" would quietly become the new canonical order and
 * survive the search being cleared.
 */
export function visibleSnippets(
  snippets: readonly Snippet[],
  query: string
): Snippet[] {
  if (!query) {
    return [...snippets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return fuzzyMatchSnippets(query, snippets as Snippet[]).map(
    (f) => f.snippet as unknown as Snippet
  );
}

// ---------------------------------------------------------------------------
// Test seam
// ---------------------------------------------------------------------------

/**
 * Reset the query.
 *
 * The store is a module singleton and a component test leaves the user mid-search;
 * the next test would then start with a query it did not set and assert on a
 * filtered list it did not expect.
 */
export function resetSearchForTests(): void {
  searchStore.setState(() => ({ query: "" }));
}

// ---------------------------------------------------------------------------
// React bindings
// ---------------------------------------------------------------------------

/** Subscribe to one slice of the search store. */
export function useSearch<T>(selector: (state: SearchState) => T): T {
  return useStore(searchStore, selector);
}

/** The visible list, given the library. Recomputed on read, never cached. */
export function useVisibleSnippets(snippets: readonly Snippet[]): Snippet[] {
  const query = useSearch((s) => s.query);
  return visibleSnippets(snippets, query);
}
