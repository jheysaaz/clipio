/**
 * Persisted inputs to popup ranking: local usage data and the current hostname.
 *
 * This store owns no decisions about order — `visibleSnippets` does. Its job is
 * to make two asynchronous inputs reactive and to keep the hostname at the
 * boundary: `getCurrentSiteHostname` returns only a bare hostname, and that is
 * all this store holds.
 */

import { createStore } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";

import { getCurrentSiteHostname } from "@/lib/current-site";
import { normalizeContextUsage, type ContextUsage } from "@/lib/context-usage";
import { captureError } from "@/lib/sentry";
import { getContextUsage } from "@/storage/context-usage";
import { snippetContextUsageItem } from "@/storage/items";

export type RankingContextState = {
  usage: ContextUsage;
  hostname: string | null;
  isLoaded: boolean;
};

export const rankingContextStore = createStore<RankingContextState>({
  usage: {},
  hostname: null,
  isLoaded: false,
});

export async function loadRankingContext(): Promise<void> {
  try {
    const [usage, hostname] = await Promise.all([
      getContextUsage(),
      getCurrentSiteHostname(),
    ]);
    rankingContextStore.setState(() => ({
      usage,
      hostname,
      isLoaded: true,
    }));
  } catch (error) {
    captureError(error, { action: "rankingContext.load" });
    // A failed load must leave the library sorted by its primary order, not
    // leave the popup waiting forever for context that never arrives.
    rankingContextStore.setState(() => ({
      usage: {},
      hostname: null,
      isLoaded: true,
    }));
  }
}

// A content script can record an insertion while the popup stays open, so the
// usage half of this state has to follow storage changes. The active tab cannot
// change without the popup closing, so the hostname is read once per load.
snippetContextUsageItem.watch((stored) => {
  // `normalizeContextUsage` returns a fresh map, so an identity guard would
  // never fire; every storage event is a real reason to re-derive the list.
  const usage = normalizeContextUsage(stored);
  rankingContextStore.setState((prev) => ({ ...prev, usage }));
});

void loadRankingContext();

export function useRankingContext<T>(
  selector: (state: RankingContextState) => T
): T {
  return useStore(rankingContextStore, selector);
}

/** Component tests leave the singleton loaded; restore it each time. */
export function resetRankingContextForTests(): void {
  rankingContextStore.setState(() => ({
    usage: {},
    hostname: null,
    isLoaded: false,
  }));
}
