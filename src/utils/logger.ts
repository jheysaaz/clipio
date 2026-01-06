/**
 * Simple console logger utility for debugging and tracking app events
 * Logs are also cached in browser.storage.session for debugging purposes
 */

type LogLevel = "info" | "success" | "warn" | "error";

interface LogOptions {
  data?: Record<string, any>;
  timestamp?: boolean;
}

interface LogEntry {
  timestamp: string;
  level: "info" | "success" | "warn" | "error";
  message: string;
  data?: Record<string, any>;
}

const dimGray = "color: #888888";
const LOGS_CACHE_KEY = "clipio_logs_cache";
const MAX_LOGS = 100;

/**
 * Check if browser.storage.session is available
 */
const isSessionStorageAvailable = (): boolean => {
  try {
    return !!(browser && browser.storage && browser.storage.session);
  } catch {
    return false;
  }
};

/**
 * Add a log entry to the cache
 */
const addLogToCache = async (
  level: LogLevel,
  message: string,
  data?: Record<string, any>
): Promise<void> => {
  if (!isSessionStorageAvailable()) {
    return;
  }

  try {
    const result = await browser.storage.session.get(LOGS_CACHE_KEY);
    const logs: LogEntry[] = (result[LOGS_CACHE_KEY] as LogEntry[]) || [];

    const newEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };

    logs.push(newEntry);

    // Keep only the last MAX_LOGS entries
    if (logs.length > MAX_LOGS) {
      logs.splice(0, logs.length - MAX_LOGS);
    }

    await browser.storage.session.set({ [LOGS_CACHE_KEY]: logs });
  } catch (error) {
    logger.error("Failed to cache log entry", { data: { error } });
  }
};

const log = (level: LogLevel, message: string, options: LogOptions = {}) => {
  const { data, timestamp = true } = options;
  const time = timestamp ? new Date().toLocaleTimeString() : "";
  const capitalizedLevel = level.charAt(0).toUpperCase() + level.slice(1);
  const prefix = `[Clipio - ${capitalizedLevel}]:`;

  if (data && Object.keys(data).length > 0) {
    // Format data as key=value pairs for clean inline display
    const formatted = Object.entries(data)
      .map(([k, v]) => `✱ ${k} = ${typeof v === "string" ? `"${v}"` : v}`)
      .join("\n");

    if (time) {
      console.log(
        `%c${time}%c ${prefix} ${message}\n%c${formatted}`,
        dimGray,
        "",
        "color: #6b7280"
      );
    } else {
      console.log(
        `%c${prefix} ${message}\n%c${formatted}`,
        dimGray,
        "color: #6b7280"
      );
    }
  } else {
    if (time) {
      console.log(`%c${time}%c ${prefix} ${message}`, dimGray, "");
    } else {
      console.log(`%c${prefix} ${message}`, dimGray);
    }
  }

  // Cache the log entry
  addLogToCache(level, message, data).catch(() => {
    // Silently fail if caching fails
  });
};

export const logger = {
  info: (message: string, options?: LogOptions) =>
    log("info", message, options),
  success: (message: string, options?: LogOptions) =>
    log("success", message, options),
  warn: (message: string, options?: LogOptions) =>
    log("warn", message, options),
  error: (message: string, options?: LogOptions) =>
    log("error", message, options),
};

/**
 * Get all cached logs
 */
export const getCachedLogs = async (): Promise<LogEntry[]> => {
  if (!isSessionStorageAvailable()) {
    return [];
  }

  try {
    const result = await browser.storage.session.get(LOGS_CACHE_KEY);
    return (result[LOGS_CACHE_KEY] as LogEntry[]) || [];
  } catch (error) {
    return [];
  }
};

/**
 * Clear log cache
 */
export const clearLogCache = async (): Promise<void> => {
  if (!isSessionStorageAvailable()) {
    return;
  }

  try {
    await browser.storage.session.remove(LOGS_CACHE_KEY);
  } catch (error) {
    // Silently fail
  }
};
