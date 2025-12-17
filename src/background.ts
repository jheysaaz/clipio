import browser from "webextension-polyfill";
import {
  API_BASE_URL,
  API_ENDPOINTS,
  STORAGE_KEYS,
  TIMING,
} from "./config/constants";

const ALARM_NAME = "token_refresh";

// Listen for extension installation
browser.runtime.onInstalled.addListener((details) => {
  console.log("[Background] Extension installed:", details);
  checkAndScheduleTokenRefresh();
});

// Listen for extension startup (browser restart)
browser.runtime.onStartup.addListener(() => {
  console.log("[Background] Extension started");
  checkAndScheduleTokenRefresh();
});

// Listen for messages from popup
interface TokenRefreshMessage {
  type: "SCHEDULE_TOKEN_REFRESH" | "CANCEL_TOKEN_REFRESH";
  payload?: { expiresIn: number };
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const msg = message as TokenRefreshMessage;
  if (msg.type === "SCHEDULE_TOKEN_REFRESH") {
    const { expiresIn } = msg.payload!;
    scheduleTokenRefresh(expiresIn);
  } else if (msg.type === "CANCEL_TOKEN_REFRESH") {
    cancelTokenRefresh();
  }
  return true; // Keep the message channel open for async response
});

// Listen for alarm
browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log("[Background] Token refresh alarm triggered");
    await refreshAccessToken();
  }
});

// Schedule token refresh alarm
function scheduleTokenRefresh(expiresIn: number) {
  // Schedule alarm at 90% of expiry time (in minutes)
  const refreshTimeMinutes = Math.max(
    (expiresIn * TIMING.TOKEN_REFRESH_PERCENTAGE) / 60,
    1
  );

  console.log(
    `[Background] Scheduling token refresh in ${refreshTimeMinutes} minutes (expires in ${expiresIn} seconds)`
  );

  browser.alarms.create(ALARM_NAME, {
    delayInMinutes: refreshTimeMinutes,
  });

  // Store the expiry time for checking on startup
  browser.storage.local.set({
    [STORAGE_KEYS.TOKEN_EXPIRES_AT]: Date.now() + expiresIn * 1000,
  });
}

// Cancel token refresh alarm
function cancelTokenRefresh() {
  browser.alarms.clear(ALARM_NAME);
  browser.storage.local.remove(STORAGE_KEYS.TOKEN_EXPIRES_AT);
}

// Check if token needs refresh on startup
async function checkAndScheduleTokenRefresh() {
  const result = await browser.storage.local.get([
    STORAGE_KEYS.TOKEN_EXPIRES_AT,
    STORAGE_KEYS.REFRESH_TOKEN,
  ]);

  console.log("[Background] Checking token refresh status:", {
    hasRefreshToken: !!result[STORAGE_KEYS.REFRESH_TOKEN],
    hasExpiresAt: !!result[STORAGE_KEYS.TOKEN_EXPIRES_AT],
  });

  if (
    result[STORAGE_KEYS.REFRESH_TOKEN] &&
    result[STORAGE_KEYS.TOKEN_EXPIRES_AT]
  ) {
    const now = Date.now();
    const timeUntilExpiry =
      ((result[STORAGE_KEYS.TOKEN_EXPIRES_AT] as number) - now) / 1000; // in seconds

    console.log(`[Background] Time until expiry: ${timeUntilExpiry} seconds`);

    if (timeUntilExpiry > 0) {
      // Token still valid, schedule refresh
      scheduleTokenRefresh(timeUntilExpiry);
    } else {
      // Token already expired, refresh immediately
      console.log("[Background] Token expired, refreshing immediately");
      await refreshAccessToken();
    }
  } else {
    console.log("[Background] No refresh token or expiry time found");
  }
}

// Refresh the access token
async function refreshAccessToken() {
  try {
    console.log("[Background] Starting token refresh...");

    const result = await browser.storage.local.get(STORAGE_KEYS.REFRESH_TOKEN);
    const refreshToken = result[STORAGE_KEYS.REFRESH_TOKEN];

    if (!refreshToken) {
      console.error("[Background] No refresh token found");
      return false;
    }

    console.log(
      "[Background] Calling refresh API:",
      API_BASE_URL + API_ENDPOINTS.REFRESH
    );

    const response = await fetch(API_BASE_URL + API_ENDPOINTS.REFRESH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refreshToken: refreshToken }),
    });

    console.log("[Background] Refresh response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Background] Refresh failed:", response.status, errorText);
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = await response.json();
    console.log("[Background] Refresh response:", {
      hasAccessToken: !!data.accessToken,
      hasRefreshToken: !!data.refreshToken,
    });

    // Update the tokens in storage
    await browser.storage.local.set({
      [STORAGE_KEYS.ACCESS_TOKEN]: data.accessToken,
    });

    // Update refresh token if a new one is provided
    if (data.refreshToken) {
      await browser.storage.local.set({
        [STORAGE_KEYS.REFRESH_TOKEN]: data.refreshToken,
      });
    }

    // Schedule the next refresh
    if (data.expiresIn || data.expires_in) {
      const expiresIn = data.expiresIn || data.expires_in;
      scheduleTokenRefresh(expiresIn);
    } else {
      console.warn("[Background] No expiresIn in refresh response");
    }

    console.log("[Background] Token refreshed successfully");
    return true;
  } catch (error) {
    console.error("[Background] Failed to refresh token:", error);

    // If refresh fails, clear all auth data
    await browser.storage.local.remove([...Object.values(STORAGE_KEYS)]);
    cancelTokenRefresh();

    return false;
  }
}
