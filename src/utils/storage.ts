import browser from "webextension-polyfill";
import type { User, AuthTokens } from "../types";
import { STORAGE_KEYS } from "../config/constants";

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
    console.error("Failed to save access token:", error);
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
    console.error("Failed to get access token:", error);
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
    console.error("Failed to remove access token:", error);
    localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
  }
};

/**
 * Save refresh token
 */
export const saveRefreshToken = async (token: string): Promise<void> => {
  try {
    if (isBrowserStorageAvailable()) {
      await browser.storage.local.set({ [STORAGE_KEYS.REFRESH_TOKEN]: token });
    }
    localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, token);
  } catch (error) {
    console.error("Failed to save refresh token:", error);
    localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, token);
  }
};

/**
 * Get refresh token
 */
export const getRefreshToken = async (): Promise<string | null> => {
  try {
    if (isBrowserStorageAvailable()) {
      const result = await browser.storage.local.get(
        STORAGE_KEYS.REFRESH_TOKEN
      );
      return (result[STORAGE_KEYS.REFRESH_TOKEN] as string) || null;
    }
    return localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
  } catch (error) {
    console.error("Failed to get refresh token:", error);
    return localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
  }
};

/**
 * Remove refresh token
 */
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

    return userString ? JSON.parse(userString) : null;
  } catch (error) {
    console.error("Failed to get user info:", error);
    const userString = localStorage.getItem(STORAGE_KEYS.USER_INFO);
    return userString ? JSON.parse(userString) : null;
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
  expiresIn?: number,
  refreshToken?: string
): Promise<void> => {
  await saveAccessToken(accessToken);
  await saveUserInfo(user);

  // Save refresh token if provided
  if (refreshToken) {
    await saveRefreshToken(refreshToken);
  }

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
