import { getAccessToken } from "./storage";
import { fetchWithTimeout } from "./security";

interface FetchOptions extends RequestInit {
  headers?: Record<string, string>;
}

export const authenticatedFetch = async (
  url: string,
  options: FetchOptions = {},
  timeoutMs: number = 30000
): Promise<Response> => {
  // Get access token using storage utility
  const accessToken = await getAccessToken();

  if (!accessToken) {
    throw new Error("No access token found");
  }

  // Add authorization header
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
    Authorization: `Bearer ${accessToken}`,
  };

  // Make the request with timeout protection (no credentials: access token only in header)
  const response = await fetchWithTimeout(
    url,
    {
      ...options,
      headers,
    },
    timeoutMs
  );

  // If unauthorized (401), token will be refreshed by background script
  // Background script handles refresh automatically via alarms
  if (response.status === 401) {
    console.log(
      "Received 401 - token may be expired. Background script should handle refresh."
    );
    throw new Error("Unauthorized - please login again");
  }

  return response;
};
