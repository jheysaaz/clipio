import browser from "webextension-polyfill";
import type { User, Snippet } from "../types";
import { STORAGE_KEYS } from "../config/constants";
import { logger } from "./logger";
import { safeJsonParse, safeJsonParseWithValidation } from "./safe-parse";
import type { QueuedOperation, SyncQueue } from "./queue";
import { getEmptyQueue, isValidQueuedOperation } from "./queue";

/**
 * Storage utility for managing Chrome extension storage and localStorage
 * Provides fallbacks for development environment
 */

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
 * Save access token
 */
export const saveAccessToken = async (token: string): Promise<void> => {
  try {
    if (isBrowserStorageAvailable()) {
      await browser.storage.local.set({ [STORAGE_KEYS.ACCESS_TOKEN]: token });
    }
    localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, token);
  } catch (error) {
    logger.error("Failed to save access token", { data: { error } });
    // Fallback to localStorage only
    localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, token);
  }
};

/**
 * Get access token
 */
export const getAccessToken = async (): Promise<string | null> => {
  try {
    if (isBrowserStorageAvailable()) {
      const result = await browser.storage.local.get(STORAGE_KEYS.ACCESS_TOKEN);
      return (result[STORAGE_KEYS.ACCESS_TOKEN] as string) || null;
    }
    return localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
  } catch (error) {
    logger.error("Failed to get access token", { data: { error } });
    return localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
  }
};

/**
 * Remove access token
 */
export const removeAccessToken = async (): Promise<void> => {
  try {
    if (isBrowserStorageAvailable()) {
      await browser.storage.local.remove(STORAGE_KEYS.ACCESS_TOKEN);
    }
    localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
  } catch (error) {
    logger.error("Failed to remove access token", { data: { error } });
    localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
  }
};

// Legacy refresh token cleanup helpers (refresh is now cookie-based)
export const removeRefreshToken = async (): Promise<void> => {
  try {
    if (isBrowserStorageAvailable()) {
      await browser.storage.local.remove(STORAGE_KEYS.REFRESH_TOKEN);
    }
    localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
  } catch (error) {
    console.error("Failed to remove refresh token:", error);
    localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
  }
};

/**
 * Save user info
 */
export const saveUserInfo = async (user: User): Promise<void> => {
  try {
    const userString = JSON.stringify(user);
    if (isBrowserStorageAvailable()) {
      await browser.storage.local.set({ [STORAGE_KEYS.USER_INFO]: userString });
    }
    localStorage.setItem(STORAGE_KEYS.USER_INFO, userString);
  } catch (error) {
    console.error("Failed to save user info:", error);
    localStorage.setItem(STORAGE_KEYS.USER_INFO, JSON.stringify(user));
  }
};

/**
 * Get user info
 */
export const getUserInfo = async (): Promise<User | null> => {
  try {
    let userString: string | null = null;

    if (isBrowserStorageAvailable()) {
      const result = await browser.storage.local.get(STORAGE_KEYS.USER_INFO);
      userString = (result[STORAGE_KEYS.USER_INFO] as string) || null;
    }

    if (!userString) {
      userString = localStorage.getItem(STORAGE_KEYS.USER_INFO);
    }

    return safeJsonParse<User>(userString);
  } catch (error) {
    console.error("Failed to get user info:", error);
    const userString = localStorage.getItem(STORAGE_KEYS.USER_INFO);
    return safeJsonParse<User>(userString);
  }
};

/**
 * Remove user info
 */
export const removeUserInfo = async (): Promise<void> => {
  try {
    if (isBrowserStorageAvailable()) {
      await browser.storage.local.remove(STORAGE_KEYS.USER_INFO);
    }
    localStorage.removeItem(STORAGE_KEYS.USER_INFO);
  } catch (error) {
    console.error("Failed to remove user info:", error);
    localStorage.removeItem(STORAGE_KEYS.USER_INFO);
  }
};

/**
 * Save authentication tokens and user info
 */
export const saveAuthData = async (
  accessToken: string,
  user: User,
  expiresIn?: number
): Promise<void> => {
  await saveAccessToken(accessToken);
  await saveUserInfo(user);

  // Send message to background script to schedule token refresh
  if (expiresIn && isBrowserStorageAvailable()) {
    try {
      await browser.runtime.sendMessage({
        type: "SCHEDULE_TOKEN_REFRESH",
        payload: { expiresIn },
      });
    } catch (error) {
      console.error("Failed to schedule token refresh:", error);
    }
  }
};

/**
 * Remove cached snippets
 */
export const removeCachedSnippets = async (): Promise<void> => {
  try {
    if (isBrowserStorageAvailable()) {
      await browser.storage.local.remove(STORAGE_KEYS.CACHED_SNIPPETS);
    }
    localStorage.removeItem(STORAGE_KEYS.CACHED_SNIPPETS);
  } catch (error) {
    console.error("Failed to remove cached snippets:", error);
    localStorage.removeItem(STORAGE_KEYS.CACHED_SNIPPETS);
  }
};

/**
 * Save cached snippets for a user
 */
export const saveCachedSnippets = async (
  userId: string,
  snippets: Snippet[]
): Promise<void> => {
  try {
    const payload = JSON.stringify({ userId, snippets });
    if (isBrowserStorageAvailable()) {
      await browser.storage.local.set({ [STORAGE_KEYS.CACHED_SNIPPETS]: payload });
    }
    localStorage.setItem(STORAGE_KEYS.CACHED_SNIPPETS, payload);
  } catch (error) {
    console.error("Failed to save cached snippets:", error);
    localStorage.setItem(
      STORAGE_KEYS.CACHED_SNIPPETS,
      JSON.stringify({ userId, snippets })
    );
  }
};

/**
 * Get cached snippets for a user
 */
export const getCachedSnippets = async (
  userId: string
): Promise<Snippet[] | null> => {
  try {
    let payload: string | null = null;

    if (isBrowserStorageAvailable()) {
      const result = await browser.storage.local.get(STORAGE_KEYS.CACHED_SNIPPETS);
      payload = (result[STORAGE_KEYS.CACHED_SNIPPETS] as string) || null;
    }

    if (!payload) {
      payload = localStorage.getItem(STORAGE_KEYS.CACHED_SNIPPETS);
    }

    if (!payload) return null;

    const parsed = safeJsonParse<{ userId: string; snippets: Snippet[] }>(payload);
    if (!parsed || parsed.userId !== userId) return null;

    return parsed.snippets;
  } catch (error) {
    console.error("Failed to get cached snippets:", error);
    return null;
  }
};

/**
 * Remove token expiration time
 */
export const removeTokenExpiresAt = async (): Promise<void> => {
  try {
    if (isBrowserStorageAvailable()) {
      await browser.storage.local.remove(STORAGE_KEYS.TOKEN_EXPIRES_AT);
    }
    localStorage.removeItem(STORAGE_KEYS.TOKEN_EXPIRES_AT);
  } catch (error) {
    console.error("Failed to remove token expiration:", error);
    localStorage.removeItem(STORAGE_KEYS.TOKEN_EXPIRES_AT);
  }
};

/**
 * Save last sync timestamp and user for incremental sync
 */
export const saveLastSyncMeta = async (userId: string, isoTimestamp: string): Promise<void> => {
  try {
    if (isBrowserStorageAvailable()) {
      await browser.storage.local.set({
        [STORAGE_KEYS.LAST_SYNC_USER_ID]: userId,
        [STORAGE_KEYS.LAST_SYNC_AT]: isoTimestamp,
      });
    }
    localStorage.setItem(STORAGE_KEYS.LAST_SYNC_USER_ID, userId);
    localStorage.setItem(STORAGE_KEYS.LAST_SYNC_AT, isoTimestamp);
  } catch (error) {
    console.error("Failed to save last sync meta:", error);
    localStorage.setItem(STORAGE_KEYS.LAST_SYNC_USER_ID, userId);
    localStorage.setItem(STORAGE_KEYS.LAST_SYNC_AT, isoTimestamp);
  }
};

export const getLastSyncMeta = async (): Promise<{ userId: string; lastSyncAt: string } | null> => {
  try {
    let userId: string | null = null;
    let lastSyncAt: string | null = null;

    if (isBrowserStorageAvailable()) {
      const result = await browser.storage.local.get([
        STORAGE_KEYS.LAST_SYNC_USER_ID,
        STORAGE_KEYS.LAST_SYNC_AT,
      ]);
      userId = (result[STORAGE_KEYS.LAST_SYNC_USER_ID] as string) || null;
      lastSyncAt = (result[STORAGE_KEYS.LAST_SYNC_AT] as string) || null;
    }

    if (!userId || !lastSyncAt) {
      userId = userId || localStorage.getItem(STORAGE_KEYS.LAST_SYNC_USER_ID);
      lastSyncAt = lastSyncAt || localStorage.getItem(STORAGE_KEYS.LAST_SYNC_AT);
    }

    if (!userId || !lastSyncAt) return null;
    return { userId, lastSyncAt };
  } catch (error) {
    console.error("Failed to get last sync meta:", error);
    return null;
  }
};

export const removeLastSyncAt = async (): Promise<void> => {
  try {
    if (isBrowserStorageAvailable()) {
      await browser.storage.local.remove(STORAGE_KEYS.LAST_SYNC_AT);
    }
    localStorage.removeItem(STORAGE_KEYS.LAST_SYNC_AT);
  } catch (error) {
    console.error("Failed to remove last sync timestamp:", error);
    localStorage.removeItem(STORAGE_KEYS.LAST_SYNC_AT);
  }
};

export const removeLastSyncUser = async (): Promise<void> => {
  try {
    if (isBrowserStorageAvailable()) {
      await browser.storage.local.remove(STORAGE_KEYS.LAST_SYNC_USER_ID);
    }
    localStorage.removeItem(STORAGE_KEYS.LAST_SYNC_USER_ID);
  } catch (error) {
    console.error("Failed to remove last sync user:", error);
    localStorage.removeItem(STORAGE_KEYS.LAST_SYNC_USER_ID);
  }
};

/**
 * Remove storage type preference
 */
export const removeStorageType = async (): Promise<void> => {
  try {
    if (isBrowserStorageAvailable()) {
      await browser.storage.local.remove(STORAGE_KEYS.STORAGE_TYPE);
    }
    localStorage.removeItem(STORAGE_KEYS.STORAGE_TYPE);
  } catch (error) {
    console.error("Failed to remove storage type:", error);
    localStorage.removeItem(STORAGE_KEYS.STORAGE_TYPE);
  }
};

/**
 * Cancel token refresh alarm
 */
export const cancelTokenRefresh = async (): Promise<void> => {
  if (isBrowserStorageAvailable()) {
    try {
      // Fire-and-forget to avoid hanging when no listener responds
      void browser.runtime.sendMessage({
        type: "CANCEL_TOKEN_REFRESH",
      });
    } catch (error) {
      console.error("Failed to cancel token refresh:", error);
    }
  }
};

/**
 * Clear all authentication data
 */
export const clearAuthData = async (): Promise<void> => {
  await Promise.allSettled([
    removeAccessToken(),
    removeRefreshToken(),
    removeUserInfo(),
    removeCachedSnippets(),
    removeTokenExpiresAt(),
    removeStorageType(),
    removeLastSyncAt(),
    removeLastSyncUser(),
  ]);
  // Do not await to prevent potential hangs if background doesn't respond
  void cancelTokenRefresh();
};

/**
 * Check if user is authenticated
 */
export const isAuthenticated = async (): Promise<boolean> => {
  const token = await getAccessToken();
  return !!token;
};

/**
 * Save queued operation for offline sync
 */
export const saveQueuedOperation = async (operation: QueuedOperation): Promise<void> => {
  try {
    const queue = await getSyncQueue();
    queue.operations.push(operation);

    const queueString = JSON.stringify(queue);
    if (isBrowserStorageAvailable()) {
      await browser.storage.local.set({ [STORAGE_KEYS.SYNC_QUEUE]: queueString });
    }
    localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, queueString);
    logger.info("Operation queued for offline sync", { data: { opId: operation.id } });
  } catch (error) {
    console.error("Failed to queue operation:", error);
    // Fallback to localStorage
    const queue = await getSyncQueue();
    queue.operations.push(operation);
    localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(queue));
  }
};

/**
 * Get all queued operations
 */
export const getSyncQueue = async (): Promise<SyncQueue> => {
  try {
    let queueString: string | null = null;

    if (isBrowserStorageAvailable()) {
      const result = await browser.storage.local.get(STORAGE_KEYS.SYNC_QUEUE);
      queueString = (result[STORAGE_KEYS.SYNC_QUEUE] as string) || null;
    }

    if (!queueString) {
      queueString = localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE);
    }

    if (!queueString) return getEmptyQueue();

    const queue = safeJsonParse<SyncQueue>(queueString);
    if (!queue) return getEmptyQueue();

    // Validate operations
    queue.operations = (queue.operations || []).filter(isValidQueuedOperation);
    queue.syncInProgress = queue.syncInProgress || false;

    return queue;
  } catch (error) {
    console.error("Failed to get sync queue:", error);
    return getEmptyQueue();
  }
};

/**
 * Remove queued operation after successful sync
 */
export const removeQueuedOperation = async (operationId: string): Promise<void> => {
  try {
    const queue = await getSyncQueue();
    queue.operations = queue.operations.filter((op) => op.id !== operationId);

    const queueString = JSON.stringify(queue);
    if (isBrowserStorageAvailable()) {
      await browser.storage.local.set({ [STORAGE_KEYS.SYNC_QUEUE]: queueString });
    }
    localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, queueString);
  } catch (error) {
    console.error("Failed to remove queued operation:", error);
  }
};

/**
 * Clear all queued operations
 */
export const clearSyncQueue = async (): Promise<void> => {
  try {
    if (isBrowserStorageAvailable()) {
      await browser.storage.local.remove(STORAGE_KEYS.SYNC_QUEUE);
    }
    localStorage.removeItem(STORAGE_KEYS.SYNC_QUEUE);
  } catch (error) {
    console.error("Failed to clear sync queue:", error);
  }
};

/**
 * Update sync queue status
 */
export const setSyncInProgress = async (inProgress: boolean): Promise<void> => {
  try {
    const queue = await getSyncQueue();
    queue.syncInProgress = inProgress;
    queue.lastSyncAt = Date.now();

    const queueString = JSON.stringify(queue);
    if (isBrowserStorageAvailable()) {
      await browser.storage.local.set({ [STORAGE_KEYS.SYNC_QUEUE]: queueString });
    }
    localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, queueString);
  } catch (error) {
    console.error("Failed to update sync status:", error);
  }
};
