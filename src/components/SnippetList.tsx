import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { authenticatedFetch } from "../utils/api";
import {
  getUserInfo,
  clearAuthData,
  getCachedSnippets,
  saveCachedSnippets,
  getLastSyncMeta,
  saveLastSyncMeta,
} from "../utils/storage";
import SnippetCard from "./SnippetCard";
import type { Snippet } from "../types";
import { API_BASE_URL, API_ENDPOINTS } from "../config/constants";
import { logger } from "../utils/logger";
import { getOnlineStatus } from "../utils/offline";

interface SnippetListProps {
  searchQuery: string;
  refreshTrigger?: number;
  selectedCategory?: string;
}

export default function SnippetList({
  searchQuery,
  refreshTrigger,
  selectedCategory,
}: SnippetListProps) {
  const navigate = useNavigate();
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    fetchSnippets();
  }, [refreshTrigger, retryCount, navigate]);

  const normalizeSnippets = (input: unknown): Snippet[] => {
    // Backend returns { data: [...], count: number } via respondWithCount
    if (Array.isArray((input as any)?.data)) {
      return (input as any).data;
    }
    // Direct array (legacy or different endpoint)
    if (Array.isArray(input)) {
      return input;
    }
    return [];
  };

  const fetchSnippets = async (forceFullFetch = false) => {
    try {
      setLoading(true);
      setError(null);

      const user = await getUserInfo();

      if (!user) {
        // If offline, show cached snippets instead of redirecting to login
        if (!getOnlineStatus()) {
          setError("You're offline. Showing cached snippets.");
          setLoading(false);
          return;
        }
        setError("No authentication found. Please login.");
        setLoading(false);
        navigate("/login");
        return;
      }

      // Use cached snippets optimistically while syncing
      const cached = await getCachedSnippets(user.id);
      if (Array.isArray(cached) && !forceFullFetch) {
        setSnippets(cached);
        setLoading(false);
      }

      // If offline, don't try to fetch from server
      if (!getOnlineStatus()) {
        setLoading(false);
        if (!cached || cached.length === 0) {
          setError("You're offline and no cached snippets are available.");
        }
        return;
      }

      // If forceFullFetch is true, always fetch full list instead of sync
      if (forceFullFetch) {
        const fullRes = await authenticatedFetch(
          API_BASE_URL + API_ENDPOINTS.USER_SNIPPETS,
          { method: "GET" }
        );
        if (fullRes.status === 401) {
          await clearAuthData();
          navigate("/login");
          return;
        }
        if (!fullRes.ok) {
          throw new Error(
            `Failed to fetch snippets: ${fullRes.status} ${fullRes.statusText}`
          );
        }
        const data = await fullRes.json();
        const items = normalizeSnippets(data);

        setSnippets(items);
        setRetryCount(0);

        try {
          await saveCachedSnippets(user.id, items);
          await saveLastSyncMeta(user.id, new Date().toISOString());
          logger.success("Snippets fetched and cached");
        } catch (error) {
          logger.error("Failed to cache snippets", { data: { error } });
        }

        setLoading(false);
        return;
      }

      const lastSync = await getLastSyncMeta();
      const updatedSince =
        lastSync && lastSync.userId === user.id
          ? lastSync.lastSyncAt
          : "1970-01-01T00:00:00Z";

      const syncUrl = `${API_BASE_URL + API_ENDPOINTS.SNIPPETS_SYNC}?updated_since=${encodeURIComponent(
        updatedSince
      )}`;

      const response = await authenticatedFetch(syncUrl, {
        method: "GET",
      });

      // If 401, redirect immediately to login
      if (response.status === 401) {
        await clearAuthData();
        navigate("/login");
        return;
      }

      let data;
      if (response.ok) {
        data = await response.json();
        // Sync endpoint returns { created: [], updated: [], deleted: [] }
        // Apply incremental changes to existing snippets
        if (data.created || data.updated || data.deleted) {
          let currentSnippets = [...snippets];

          // Apply deletions
          if (data.deleted && data.deleted.length > 0) {
            const deletedIds = data.deleted.map((d: any) => d.id);
            currentSnippets = currentSnippets.filter(
              (s) => !deletedIds.includes(s.id)
            );
          }

          // Apply updates
          if (data.updated && data.updated.length > 0) {
            data.updated.forEach((updatedSnippet: Snippet) => {
              const index = currentSnippets.findIndex(
                (s) => s.id === updatedSnippet.id
              );
              if (index !== -1) {
                currentSnippets[index] = updatedSnippet;
              } else {
                currentSnippets.push(updatedSnippet);
              }
            });
          }

          // Apply creations
          if (data.created && data.created.length > 0) {
            data.created.forEach((newSnippet: Snippet) => {
              if (!currentSnippets.find((s) => s.id === newSnippet.id)) {
                currentSnippets.push(newSnippet);
              }
            });
          }

          setSnippets(currentSnippets);
          setRetryCount(0);

          try {
            await saveCachedSnippets(user.id, currentSnippets);
            await saveLastSyncMeta(user.id, new Date().toISOString());
            logger.success("Snippets synced successfully");
          } catch (error) {
            logger.error("Failed to cache snippets", { data: { error } });
          }

          setLoading(false);
          return;
        }
      } else if (response.status === 400) {
        // Fallback to full fetch if sync parameter rejected
        const fullRes = await authenticatedFetch(
          API_BASE_URL + API_ENDPOINTS.USER_SNIPPETS,
          { method: "GET" }
        );
        if (fullRes.status === 401) {
          await clearAuthData();
          navigate("/login");
          return;
        }
        if (!fullRes.ok) {
          throw new Error(
            `Failed to fetch snippets: ${fullRes.status} ${fullRes.statusText}`
          );
        }
        data = await fullRes.json();
      } else {
        throw new Error(
          `Failed to fetch snippets: ${response.status} ${response.statusText}`
        );
      }

      const items = normalizeSnippets(data);

      setSnippets(items);
      setRetryCount(0); // Reset retry count on success

      try {
        await saveCachedSnippets(user.id, items || []);
        await saveLastSyncMeta(user.id, new Date().toISOString());
        logger.success("Snippets cached for content script");
      } catch (error) {
        logger.error("Failed to cache snippets", { data: { error } });
      }

      setLoading(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Check if it's a network error (Failed to fetch, ERR_NETWORK_CHANGED, etc.)
      const isNetworkError =
        errorMessage.includes("Failed to fetch") ||
        errorMessage.includes("NetworkError") ||
        errorMessage.includes("ERR_NETWORK_CHANGED");

      if (isNetworkError) {
        logger.warn("Network error fetching snippets, will retry", {
          data: { error: err, attempt: retryCount + 1 },
        });

        // For network errors, retry with exponential backoff (up to 3 times)
        if (retryCount < 3) {
          const delay = Math.min(1000 * Math.pow(2, retryCount), 5000); // 1s, 2s, 4s (max 5s)
          setError(
            `Network unstable. Retrying in ${delay / 1000}s... (${retryCount + 1}/3)`
          );
          setLoading(false);

          setTimeout(() => {
            setRetryCount((prev) => prev + 1);
          }, delay);
        } else {
          setError("Network error. Showing cached snippets.");
          setLoading(false);
          setRetryCount(0); // Reset for next manual retry
        }
      } else {
        // For other errors (auth, server errors), log and show error
        logger.error("Error fetching snippets", { data: { error: err } });
        setError("Failed to load snippets. Please try again.");
        setLoading(false);
      }
    }
  };

  const filteredSnippets = snippets.filter((snippet) => {
    // Filter by search query
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      snippet.label.toLowerCase().includes(query) ||
      snippet.content.toLowerCase().includes(query) ||
      snippet.shortcut.toLowerCase().includes(query) ||
      snippet.tags?.some((tag) => tag.toLowerCase().includes(query))
    );
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-gray-600 dark:text-gray-400" />
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Loading snippets...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <button
          onClick={() => fetchSnippets(true)}
          className="text-sm text-gray-700 dark:text-gray-300 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (filteredSnippets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {searchQuery ? "No snippets found" : "No snippets yet"}
        </p>
        {searchQuery && (
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            Try a different search term
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {filteredSnippets.map((snippet) => (
        <SnippetCard
          key={snippet.id}
          snippet={snippet}
          onDelete={fetchSnippets}
          onUpdate={fetchSnippets}
        />
      ))}
    </div>
  );
}
