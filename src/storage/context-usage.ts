/**
 * Local persistence for the ranking context signal.
 */

import {
  normalizeContextUsage,
  recordSnippetUse,
  type ContextUsage,
} from "@/lib/context-usage";
import { captureError } from "@/lib/sentry";
import { snippetContextUsageItem } from "@/storage/items";

/** Read and repair the local-only context usage map. */
export const getContextUsage = async (): Promise<ContextUsage> => {
  try {
    return normalizeContextUsage(await snippetContextUsageItem.getValue());
  } catch (error) {
    console.error("Failed to read context usage:", error);
    captureError(error, { action: "getContextUsage" });
    return {};
  }
};

/**
 * Record one successful insertion against the current site's bare hostname.
 *
 * Errors are swallowed: usage ranking is a convenience, and a storage failure
 * must never break snippet expansion. Neither the hostname nor the URL is
 * passed to Sentry — the error's action is the only extra recorded.
 */
export const recordContextUse = async (
  snippetId: string,
  hostname: string
): Promise<void> => {
  try {
    const current = await getContextUsage();
    const next = recordSnippetUse(current, snippetId, hostname);
    // An invalid hostname is a no-op. Skip the write rather than churn storage.
    if (next === current) return;
    await snippetContextUsageItem.setValue(next);
  } catch (error) {
    console.error("Failed to record context usage:", error);
    captureError(error, { action: "recordContextUse" });
  }
};
