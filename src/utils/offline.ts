/**
 * Offline detection and status management
 */

let isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

/**
 * Get current online status
 */
export const getOnlineStatus = (): boolean => {
  return isOnline;
};

/**
 * Set online/offline status
 */
const setOnlineStatus = (status: boolean): void => {
  isOnline = status;
};

/**
 * Listen for online/offline events
 */
export const setupOfflineDetection = (): void => {
  if (typeof window === "undefined") return;

  window.addEventListener("online", () => {
    console.log("[Offline] Connection recovered");
    setOnlineStatus(true);
    // Dispatch custom event so other parts of app can react
    window.dispatchEvent(new CustomEvent("snippy:online", { detail: { isOnline: true } }));
  });

  window.addEventListener("offline", () => {
    console.log("[Offline] Connection lost");
    setOnlineStatus(false);
    window.dispatchEvent(new CustomEvent("snippy:offline", { detail: { isOnline: false } }));
  });
};

/**
 * Listen for online status changes
 */
export const onOnlineStatusChange = (callback: (isOnline: boolean) => void): (() => void) => {
  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);

  if (typeof window !== "undefined") {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    // Also listen to custom events
    window.addEventListener("snippy:online", () => callback(true));
    window.addEventListener("snippy:offline", () => callback(false));
  }

  // Return cleanup function
  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    }
  };
};
