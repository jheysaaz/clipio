/**
 * Local usage tracking for snippets
 * Tracks how many times each snippet has been copied/used
 */

import { captureError } from "~/lib/sentry";

const USAGE_KEY = "snippetUsageCount";

interface UsageData {
  [snippetId: string]: number;
}

/**
 * Check if browser.storage is available
 */
const isBrowserStorageAvailable = (): boolean => {
  try {
    return !!(browser && browser.storage && browser.storage.local);
  } catch {
    return false;
  }
};

/**
 * Get usage count for all snippets
 */
export const getUsageCounts = async (): Promise<UsageData> => {
  try {
    if (isBrowserStorageAvailable()) {
      const result = await browser.storage.local.get(USAGE_KEY);
      return (result[USAGE_KEY] as UsageData) || {};
    }
    const data = localStorage.getItem(USAGE_KEY);
    return data ? JSON.parse(data) : {};
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

    if (isBrowserStorageAvailable()) {
      await browser.storage.local.set({ [USAGE_KEY]: usageData });
    }
    localStorage.setItem(USAGE_KEY, JSON.stringify(usageData));

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

    if (isBrowserStorageAvailable()) {
      await browser.storage.local.set({ [USAGE_KEY]: usageData });
    }
    localStorage.setItem(USAGE_KEY, JSON.stringify(usageData));
  } catch (error) {
    console.error("Failed to reset usage count:", error);
  }
};

/**
 * Clear all usage counts
 */
export const clearAllUsageCounts = async (): Promise<void> => {
  try {
    if (isBrowserStorageAvailable()) {
      await browser.storage.local.remove(USAGE_KEY);
    }
    localStorage.removeItem(USAGE_KEY);
  } catch (error) {
    console.error("Failed to clear usage counts:", error);
  }
};
