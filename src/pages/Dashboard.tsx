import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import Header from "../components/Header";
import Search from "../components/Search";
import SnippetList from "../components/SnippetList";
import AddSnippetModal from "../components/AddSnippetModal";
import { authenticatedFetch } from "../utils/api";
import { useAppDispatch } from "../store/hooks";
import { showToast } from "../store/slices/toastSlice";
import { getUserInfo, getAccessToken } from "../utils/storage";
import { useNavigate } from "react-router";
import type { SnippetFormData } from "../types";
import { API_BASE_URL, API_ENDPOINTS } from "../config/constants";

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
        navigate("/cloud-login", { replace: true });
      }
    })();
  }, [navigate]);

  const handleAddSnippet = () => {
    setIsModalOpen(true);
  };

  const handleSubmitSnippet = async (snippet: SnippetFormData) => {
    console.log("Submitting snippet:", snippet);

    try {
      // Get user info for userId
      const user = await getUserInfo();
      if (user) {
        snippet.userId = user.id;
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
        // Trigger refresh of snippet list
        setRefreshTrigger((prev) => prev + 1);
      } else {
        const error = await response.json();
        dispatch(
          showToast({
            message: error.message || "Failed to add snippet",
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
