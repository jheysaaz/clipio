/**
 * Application constants
 */

export const API_BASE_URL =
  import.meta.env.VITE_API_URI || "http://128.199.4.253:8080";

export const API_ENDPOINTS = {
  LOGIN: "/api/v1/auth/login",
  LOGOUT: "/api/v1/auth/logout",
  LOGOUT_ALL: "/api/v1/auth/logout-all",
  REFRESH: "/api/v1/auth/refresh",
  REGISTER: "/api/v1/auth/register",
  AVAILABILITY: "/api/v1/auth/availability",
  SESSIONS: "/api/v1/auth/sessions",
  SNIPPETS: "/api/v1/snippets",
  USER_SNIPPETS: `/api/v1/snippets`,
  SNIPPETS_SYNC: "/api/v1/snippets/sync",
  SNIPPET_BY_ID: (id: number) => `/api/v1/snippets/${id}`,
} as const;

export const STORAGE_KEYS = {
  ACCESS_TOKEN: "accessToken",
  REFRESH_TOKEN: "refreshToken",
  USER_INFO: "userInfo",
  CACHED_SNIPPETS: "cachedSnippets",
  LAST_SYNC_AT: "lastSyncAt",
  LAST_SYNC_USER_ID: "lastSyncUserId",
  TOKEN_EXPIRES_AT: "tokenExpiresAt",
  STORAGE_TYPE: "storageType",
  SYNC_QUEUE: "syncQueue",
} as const;

export const TIMING = {
  TYPING_TIMEOUT: 750, // ms to wait before expanding snippet
  TOKEN_REFRESH_PERCENTAGE: 0.9, // Refresh at 90% of token lifetime
  TOAST_DURATION: 3000, // Toast display duration in ms
} as const;
