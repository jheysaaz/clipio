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
import { compareSnippetContext, type ContextUsage } from "@/lib/context-usage";
import { useRankingContext } from "@/store/ranking-context";

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
 * The no-query branch maps before sorting. `sort` mutates, and the array handed
 * in is the store's own `snippets`; sorting it in place would reorder the library
 * itself, so "newest first" would quietly become the new canonical order and
 * survive the search being cleared.
 *
 * `context` supplies local recent-use data and the current hostname. It is
 * consulted only after the primary order (fuzzy score, or edit recency with no
 * query) has failed to separate two snippets.
 */
export type RankingContextInput = {
  /** Local-only recent-use data. Missing/absent means "no context signal". */
  usage?: ContextUsage;
  /** Current site hostname. Reduced to a bare hostname before comparison. */
  hostname?: string | null;
};

function contextOrder(
  a: Snippet,
  b: Snippet,
  context: RankingContextInput
): number {
  return compareSnippetContext(
    context.usage?.[a.id],
    context.usage?.[b.id],
    context.hostname ?? null
  );
}

export function visibleSnippets(
  snippets: readonly Snippet[],
  query: string,
  context: RankingContextInput = {}
): Snippet[] {
  if (!query) {
    // Primary order is still recency of editing. Context only speaks when two
    // snippets were edited at the same instant, which is the one case where the
    // old sort had nothing left to say.
    return snippets
      .map((snippet, index) => ({ snippet, index }))
      .sort((a, b) => {
        const edited = b.snippet.updatedAt.localeCompare(a.snippet.updatedAt);
        if (edited !== 0) return edited;
        return contextOrder(a.snippet, b.snippet, context) || a.index - b.index;
      })
      .map(({ snippet }) => snippet);
  }

  const matches = fuzzyMatchSnippets(query, snippets as Snippet[]).map(
    (match, index) => ({ ...match, index })
  );
  matches.sort((a, b) => {
    const relevance = b.relevanceScore - a.relevanceScore;
    if (relevance !== 0) return relevance;

    // Only equal scores reach here. This is the whole invariant: a strong
    // recent-use or same-site signal is a tie-break, never an override of the
    // fuzzy matcher's answer.
    const contextResult = contextOrder(
      a.snippet as unknown as Snippet,
      b.snippet as unknown as Snippet,
      context
    );
    return contextResult || a.index - b.index;
  });
  return matches.map((match) => match.snippet as unknown as Snippet);
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
  const usage = useRankingContext((s) => s.usage);
  const hostname = useRankingContext((s) => s.hostname);
  return visibleSnippets(snippets, query, { usage, hostname });
}
