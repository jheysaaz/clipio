import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import Header from "../components/Header";
import Search from "../components/Search";
import SnippetList from "../components/SnippetList";
import AddSnippetModal from "../components/AddSnippetModal";
import { authenticatedFetch } from "../utils/api";
import { useAppDispatch } from "../store/hooks";
import { showToast } from "../store/slices/toastSlice";
import { getAccessToken, saveQueuedOperation } from "../utils/storage";
import { logger } from "../utils/logger";
import { useNavigate } from "react-router";
import type { SnippetFormData } from "../types";
import { API_BASE_URL, API_ENDPOINTS } from "../config/constants";
import { getOnlineStatus } from "../utils/offline";
import { generateOperationId } from "../utils/queue";

export default function Dashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  // Guard: if no access token, redirect to cloud login
  useEffect(() => {
    (async () => {
      const token = await getAccessToken();
      if (!token) {
        navigate("/login", { replace: true });
      }
    })();
  }, [navigate]);

  const handleAddSnippet = () => {
    setIsModalOpen(true);
  };

  const handleSubmitSnippet = async (snippet: SnippetFormData) => {
    try {
      // Check if offline
      if (!getOnlineStatus()) {
        // Create optimistic snippet with temporary ID
        const tempId = -Date.now(); // Negative ID to indicate it's temporary
        const optimisticSnippet = {
          ...snippet,
          id: tempId,
          tags: snippet.tags || [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // Queue the operation for later sync
        const operationId = generateOperationId();
        await saveQueuedOperation({
          id: operationId,
          type: "create",
          data: snippet as unknown as Record<string, unknown>,
          createdAt: Date.now(),
          retries: 0,
        });

        dispatch(
          showToast({
            message:
              "Snippet created offline. Will sync when connection recovers.",
            type: "success",
          })
        );
        setIsModalOpen(false);
        // Trigger refresh to show optimistic update
        setRefreshTrigger((prev) => prev + 1);
        return;
      }

      const response = await authenticatedFetch(
        API_BASE_URL + API_ENDPOINTS.SNIPPETS,
        {
          method: "POST",
          body: JSON.stringify(snippet),
        }
      );

      if (response.ok) {
        dispatch(
          showToast({ message: "Snippet added successfully!", type: "success" })
        );
        setIsModalOpen(false);
        // Trigger refresh of snippet list
        setRefreshTrigger((prev) => prev + 1);
      } else {
        let errorMsg = "Failed to add snippet";
        try {
          const error = await response.json();
          if (error && typeof error.message === "string") {
            errorMsg = error.message;
          }
        } catch {
          // If we can't parse error response, use default message
        }
        dispatch(
          showToast({
            message: errorMsg,
            type: "error",
          })
        );
      }
    } catch (error) {
      console.error("Failed to add snippet:", error);
      dispatch(
        showToast({
          message: "Failed to add snippet. Please try again.",
          type: "error",
        })
      );
    }
  };

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Header */}
      <Header />
      {/* Search Bar with Add Button */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <Search value={searchQuery} onChange={setSearchQuery} />
        </div>
        <button
          onClick={handleAddSnippet}
          className="shrink-0 w-12 h-12 bg-gray-900 dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-100 text-white dark:text-gray-900 rounded-xl transition-colors flex items-center justify-center shadow-sm"
          title="Add new snippet"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="space-y-6">
          {/* Snippet List */}
          <SnippetList
            searchQuery={searchQuery}
            refreshTrigger={refreshTrigger}
          />
        </div>
      </div>

      <AddSnippetModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmitSnippet}
      />
    </div>
  );
}
