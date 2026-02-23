/**
 * Local usage tracking for snippets
 * Tracks how many times each snippet has been copied/used
 */

import { captureError } from "~/lib/sentry";
import { usageCountsItem } from "~/storage/items";

/**
 * Get usage count for all snippets
 */
export const getUsageCounts = async (): Promise<Record<string, number>> => {
  try {
    return await usageCountsItem.getValue();
  } catch (error) {
    console.error("Failed to get usage counts:", error);
    captureError(error, { action: "getUsageCounts" });
    return {};
  }
};

/**
 * Get usage count for a specific snippet
 */
export const getSnippetUsageCount = async (
  snippetId: string
): Promise<number> => {
  const usageData = await getUsageCounts();
  return usageData[snippetId] || 0;
};

/**
 * Increment usage count for a snippet
 */
export const incrementSnippetUsage = async (
  snippetId: string
): Promise<number> => {
  try {
    const usageData = await getUsageCounts();
    const newCount = (usageData[snippetId] || 0) + 1;
    usageData[snippetId] = newCount;
    await usageCountsItem.setValue(usageData);
    return newCount;
  } catch (error) {
    console.error("Failed to increment usage count:", error);
    captureError(error, { action: "incrementSnippetUsage" });
    return 0;
  }
};

/**
 * Reset usage count for a specific snippet
 */
export const resetSnippetUsage = async (snippetId: string): Promise<void> => {
  try {
    const usageData = await getUsageCounts();
    delete usageData[snippetId];
    await usageCountsItem.setValue(usageData);
  } catch (error) {
    console.error("Failed to reset usage count:", error);
  }
};

/**
 * Clear all usage counts
 */
export const clearAllUsageCounts = async (): Promise<void> => {
  try {
    await usageCountsItem.removeValue();
  } catch (error) {
    console.error("Failed to clear usage counts:", error);
  }
};
