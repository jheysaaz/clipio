import browser from "webextension-polyfill";
import {
  API_BASE_URL,
  API_ENDPOINTS,
  STORAGE_KEYS,
  TIMING,
} from "./config/constants";
import { logger } from "./utils/logger";
import { fetchWithTimeout } from "./utils/security";
import { getOnlineStatus, onOnlineStatusChange } from "./utils/offline";
import { processSyncQueue } from "./utils/sync-engine";

const ALARM_NAME = "token_refresh";
const TOKEN_RETRY_ALARM_NAME = "token_refresh_retry";
let tokenRefreshRetries = 0;
const MAX_TOKEN_REFRESH_RETRIES = 36; // 30 minutes with 50s intervals

// Listen for extension installation
browser.runtime.onInstalled.addListener((details) => {
  logger.info("Extension installed", {
    data: {
      reason: details.reason,
      previousVersion: details.previousVersion,
    },
  });
  checkAndScheduleTokenRefresh();
});

// Listen for extension startup (browser restart)
browser.runtime.onStartup.addListener(() => {
  logger.info("Extension started");
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
    logger.info("Token refresh alarm triggered");
    await refreshAccessToken();
  } else if (alarm.name === TOKEN_RETRY_ALARM_NAME) {
    logger.info("Token refresh retry alarm triggered");
    await refreshAccessTokenWithRetry();
  }
});

// Schedule token refresh alarm
function scheduleTokenRefresh(expiresIn: number) {
  // Schedule alarm at 90% of expiry time (in minutes)
  const refreshTimeMinutes = Math.max(
    (expiresIn * TIMING.TOKEN_REFRESH_PERCENTAGE) / 60,
    1
  );

  logger.info(`Scheduling token refresh in ${refreshTimeMinutes} minutes`);

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
  ]);

  const now = Date.now();
  logger.info("Checking token refresh status", {
    data: {
      expiresAt: result[STORAGE_KEYS.TOKEN_EXPIRES_AT],
    },
  });

  if (result[STORAGE_KEYS.TOKEN_EXPIRES_AT]) {
    const timeUntilExpiry =
      ((result[STORAGE_KEYS.TOKEN_EXPIRES_AT] as number) - now) / 1000; // in seconds

    if (timeUntilExpiry > 0) {
      // Token still valid, schedule refresh
      scheduleTokenRefresh(timeUntilExpiry);
    } else {
      // Token already expired, refresh immediately
      logger.info("Token expired, refreshing immediately");
      await refreshAccessToken();
    }
  } else {
    logger.warn("No token expiry found; skipping refresh schedule");
  }
}

// Refresh the access token
async function refreshAccessToken() {
  try {
    logger.info("Starting token refresh...");

    const response = await fetchWithTimeout(
      API_BASE_URL + API_ENDPOINTS.REFRESH,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", // needed to send httpOnly refresh cookie
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("Refresh failed", {
        data: { status: response.status, errorText },
      });
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = await response.json();

    // Update the tokens in storage
    await browser.storage.local.set({
      [STORAGE_KEYS.ACCESS_TOKEN]: data.accessToken,
    });

    // Schedule the next refresh
    if (data.expiresIn || data.expires_in) {
      const expiresIn = data.expiresIn || data.expires_in;
      scheduleTokenRefresh(expiresIn);
    } else {
      logger.warn("No expiresIn in refresh response");
    }

    logger.success("Token refreshed successfully");
    tokenRefreshRetries = 0; // Reset retry count on success
    return true;
  } catch (error) {
    // Check if offline
    if (!getOnlineStatus()) {
      logger.warn("Network offline, will retry token refresh when online");
      // Schedule retry when online
      await scheduleTokenRefreshRetry();
      return false;
    }

    logger.error("Failed to refresh token", { data: { error } });

    // If refresh fails and we're online, clear all auth data
    await browser.storage.local.remove([...Object.values(STORAGE_KEYS)]);
    cancelTokenRefresh();

    return false;
  }
}

// Retry token refresh with exponential backoff
async function refreshAccessTokenWithRetry() {
  // Check if we're online now
  if (!getOnlineStatus()) {
    tokenRefreshRetries++;
    if (tokenRefreshRetries < MAX_TOKEN_REFRESH_RETRIES) {
      logger.warn("Still offline, scheduling another retry", {
        data: { attempt: tokenRefreshRetries },
      });
      await scheduleTokenRefreshRetry();
    } else {
      logger.error("Max token refresh retries exceeded, clearing auth");
      await browser.storage.local.remove([...Object.values(STORAGE_KEYS)]);
      cancelTokenRefresh();
      tokenRefreshRetries = 0;
    }
    return;
  }

  // We're online, try to refresh
  const success = await refreshAccessToken();
  if (success) {
    tokenRefreshRetries = 0;
  }
}

// Schedule token refresh retry (for offline scenarios)
async function scheduleTokenRefreshRetry() {
  // Clear any existing retry alarm
  await browser.alarms.clear(TOKEN_RETRY_ALARM_NAME);

  // Schedule retry in 50 seconds (will trigger up to 36 times = ~30 minutes)
  browser.alarms.create(TOKEN_RETRY_ALARM_NAME, {
    delayInMinutes: 50 / 60, // 50 seconds in minutes
  });
}

// Listen for online status changes
onOnlineStatusChange((isOnline) => {
  if (isOnline) {
    logger.info("Connection recovered, attempting token refresh and queue sync");
    // Try to refresh token and process sync queue
    void (async () => {
      await refreshAccessToken();
      await processSyncQueue();
    })();
  }
});
