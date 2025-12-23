import { Code2, Sun, Moon, Power, Wifi, WifiOff, Zap } from "lucide-react";
import { useState, useEffect } from "react";
import { authenticatedFetch } from "../utils/api";
import { clearAuthData, getSyncQueue } from "../utils/storage";
import { useNavigate } from "react-router";
import { API_BASE_URL, API_ENDPOINTS } from "../config/constants";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { toggleTheme } from "../store/slices/themeSlice";
import { showToast } from "../store/slices/toastSlice";
import { logger } from "../utils/logger";
import { getOnlineStatus, onOnlineStatusChange } from "../utils/offline";
import { processSyncQueue } from "../utils/sync-engine";

export default function Header() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const theme = useAppSelector((state) => state.theme.current);
  const [isOnline, setIsOnline] = useState(() => getOnlineStatus());
  const [pendingOps, setPendingOps] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    // Listen for online/offline status changes
    const unsubscribe = onOnlineStatusChange((online) => {
      setIsOnline(online);
      if (online) {
        // Try to sync when coming back online
        syncPendingOperations();
      }
    });

    // Load pending operations count
    loadPendingCount();

    return unsubscribe;
  }, []);

  const loadPendingCount = async () => {
    const queue = await getSyncQueue();
    setPendingOps(queue.operations.length);
  };

  const syncPendingOperations = async () => {
    setIsSyncing(true);
    try {
      const result = await processSyncQueue();
      dispatch(
        showToast({
          message: `Synced ${result.successful} operations${result.failed > 0 ? `, ${result.failed} failed` : ""}`,
          type: result.failed > 0 ? "error" : "success",
        })
      );
      await loadPendingCount();
    } catch (error) {
      console.error("Sync error:", error);
    } finally {
      setIsSyncing(false);
    }
  };

  const onLogout = async () => {
    try {
      await authenticatedFetch(API_BASE_URL + API_ENDPOINTS.LOGOUT, {
        method: "POST",
      });
    } catch (error) {
      console.error("Logout API error (ignored):", error);
    }

    clearAuthData();
    dispatch(
      showToast({ message: "Logged out successfully!", type: "success" })
    );

    setTimeout(() => {
      navigate("/login", { replace: true });
    }, 500);
  };

  return (
    <header className="flex flex-row transition-colors">
      <div className="flex w-full justify-between items-start">
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="p-1.5 bg-gray-500/10 dark:bg-gray-500/20 rounded-lg">
              <Code2 className="h-4 w-4 text-gray-700 dark:text-gray-300 " />
            </div>
            <h1 className="text-zinc-900 dark:text-zinc-50">
              Snippy Dashboard
            </h1>
          </div>
          <p className="text-zinc-600 dark:text-zinc-400">
            Store and manage your super snippets
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Offline indicator */}
          {!isOnline && (
            <div
              className="px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-900 flex items-center gap-2"
              title="You are offline. Changes will be synced when connection recovers."
            >
              <WifiOff className="h-3 w-3 text-amber-700 dark:text-amber-300" />
              <span className="text-xs text-amber-700 dark:text-amber-300">
                Offline
              </span>
            </div>
          )}

          {/* Pending operations indicator */}
          {pendingOps > 0 && (
            <button
              onClick={syncPendingOperations}
              disabled={isSyncing}
              className="px-2 py-1 rounded-lg bg-blue-100 dark:bg-blue-900 hover:bg-blue-200 dark:hover:bg-blue-800 flex items-center gap-2 transition-colors disabled:opacity-50"
              title={`${pendingOps} operation(s) pending sync`}
            >
              {isSyncing ? (
                <div className="h-3 w-3 border-2 border-blue-700 border-t-transparent rounded-full animate-spin" />
              ) : (
                <Zap className="h-3 w-3 text-blue-700 dark:text-blue-300" />
              )}
              <span className="text-xs text-blue-700 dark:text-blue-300">
                {pendingOps}
              </span>
            </button>
          )}

          <button
            onClick={() => dispatch(toggleTheme())}
            className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            aria-label="Toggle theme"
          >
            {theme === "light" ? (
              <Moon className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
            ) : (
              <Sun className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />
            )}
          </button>
          <button
            onClick={onLogout}
            className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            aria-label="Logout"
          >
            <Power className="h-4 w-4 text-zinc-700 dark:text-zinc-300 hover:text-red-500" />
          </button>
        </div>
      </div>
    </header>
  );
}
