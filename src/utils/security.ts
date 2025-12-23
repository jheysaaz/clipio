/**
 * Security utilities for API calls
 */

import { API_BASE_URL } from "../config/constants";

const ALLOWED_API_ORIGIN = new URL(API_BASE_URL).origin;

/**
 * Validate that a URL is safe to call
 * @param url URL to validate
 * @returns true if URL is safe, false otherwise
 */
export const isValidApiUrl = (url: string): boolean => {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.origin === ALLOWED_API_ORIGIN;
  } catch {
    return false;
  }
};

/**
 * Fetch with timeout
 * @param url URL to fetch
 * @param options Fetch options
 * @param timeoutMs Timeout in milliseconds (default: 30000)
 * @returns Fetch response
 */
export const fetchWithTimeout = async (
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 30000
): Promise<Response> => {
  // Validate URL for security
  if (!isValidApiUrl(url)) {
    throw new Error(`Invalid API URL: ${url}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
};
