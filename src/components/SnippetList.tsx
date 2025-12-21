import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { authenticatedFetch } from "../utils/api";
import { getUserInfo, clearAuthData } from "../utils/storage";
import SnippetCard from "./SnippetCard";
import type { Snippet } from "../types";
import browser from "webextension-polyfill";
import { API_BASE_URL, API_ENDPOINTS, STORAGE_KEYS } from "../config/constants";
import { logger } from "../utils/logger";

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

  const fetchSnippets = async () => {
    try {
      setLoading(true);
      setError(null);

      const user = await getUserInfo();

      if (!user) {
        setError("No authentication found. Please login.");
        setLoading(false);
        navigate("/login");
        return;
      }

      const response = await authenticatedFetch(
        API_BASE_URL + API_ENDPOINTS.USER_SNIPPETS,
        {
          method: "GET",
        }
      );

      // If 401, redirect immediately to login
      if (response.status === 401) {
        await clearAuthData();
        navigate("/login");
        return;
      }

      if (!response.ok) {
        throw new Error(
          `Failed to fetch snippets: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      setSnippets(data.items || data);
      setRetryCount(0); // Reset retry count on success

      // Cache snippets for content script to use
      try {
        await browser.storage.local.set({
          [STORAGE_KEYS.CACHED_SNIPPETS]: JSON.stringify(data.snippets || data),
        });
        logger.success("Snippets cached for content script");
      } catch (error) {
        logger.error("Failed to cache snippets", { data: { error } });
      }

      setLoading(false);
    } catch (err) {
      logger.error("Error fetching snippets", { data: { error: err } });

      // Increment retry count only for network/fetch errors
      if (retryCount < 3) {
        setRetryCount((prev) => prev + 1);
        setError(`Failed to load snippets. Retry ${retryCount + 1}/3...`);
      } else {
        setError(
          "Failed to load snippets after multiple attempts. Please check your connection and try again."
        );
        await clearAuthData();
        navigate("/login");
      }
      setLoading(false);
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
          onClick={fetchSnippets}
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
