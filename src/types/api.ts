/**
 * API Response types aligned with snippy-backend v1.0
 * 
 * Backend uses these response helpers:
 * - respondSuccess(c, status, data) -> returns data directly
 * - respondWithCount(c, data, count) -> returns { data: [...], count: number }
 * - respondError(c, status, message) -> returns { error: string }
 */

import type { Snippet, User } from "./index";

/**
 * Standard list response (via respondWithCount)
 * Used by: GET /snippets, GET /users
 */
export interface ApiListResponse<T> {
  data: T[];
  count: number;
}

/**
 * Sync endpoint response
 * Used by: GET /snippets/sync
 */
export interface ApiSyncResponse {
  created: Snippet[];
  updated: Snippet[];
  deleted: Array<{
    id: number;
    deletedAt?: string;
  }>;
}

/**
 * Error response (via respondError)
 */
export interface ApiErrorResponse {
  error: string;
}

/**
 * Login response (via respondSuccess)
 * Used by: POST /auth/login
 */
export interface ApiLoginResponse {
  user: User;
  accessToken: string;
  expiresIn: number;
}

/**
 * Token refresh response
 * Used by: POST /auth/refresh
 */
export interface ApiRefreshResponse {
  accessToken: string;
  expiresIn: number;
}

/**
 * Availability check response
 * Used by: GET /auth/availability
 */
export interface ApiAvailabilityResponse {
  available: boolean;
}

/**
 * Generic success message response
 */
export interface ApiMessageResponse {
  message: string;
}

/**
 * Type guard for error responses
 */
export function isApiErrorResponse(
  response: unknown
): response is ApiErrorResponse {
  return (
    typeof response === "object" &&
    response !== null &&
    "error" in response &&
    typeof (response as ApiErrorResponse).error === "string"
  );
}

/**
 * Type guard for list responses
 */
export function isApiListResponse<T>(
  response: unknown
): response is ApiListResponse<T> {
  return (
    typeof response === "object" &&
    response !== null &&
    "data" in response &&
    Array.isArray((response as ApiListResponse<T>).data) &&
    "count" in response &&
    typeof (response as ApiListResponse<T>).count === "number"
  );
}

/**
 * Type guard for sync responses
 */
export function isApiSyncResponse(
  response: unknown
): response is ApiSyncResponse {
  return (
    typeof response === "object" &&
    response !== null &&
    "created" in response &&
    "updated" in response &&
    "deleted" in response &&
    Array.isArray((response as ApiSyncResponse).created) &&
    Array.isArray((response as ApiSyncResponse).updated) &&
    Array.isArray((response as ApiSyncResponse).deleted)
  );
}
