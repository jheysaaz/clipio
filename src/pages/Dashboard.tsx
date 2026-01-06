import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Search, Loader2, PanelLeftClose, PanelLeft } from "lucide-react";
import SnippetListItem from "~/components/SnippetListItem";
import SnippetDetailView from "~/components/SnippetDetailView";
import NewSnippetView from "~/components/NewSnippetView";
import SidebarUserProfile from "~/components/SidebarUserProfile";
import { authenticatedFetch } from "~/utils/api";
import { useToast } from "~/hooks/ToastContext";
import { getUserInfo, getAccessToken, clearAuthData } from "~/utils/storage";
import { useNavigate } from "react-router";
import type { Snippet, SnippetFormData } from "~/types";
import { API_BASE_URL, API_ENDPOINTS, STORAGE_KEYS } from "~/config/constants";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { logger } from "~/utils/logger";

export default function Dashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [draftSnippet, setDraftSnippet] = useState<SnippetFormData>({
    label: "",
    shortcut: "",
    content: "",
    tags: [],
  });
  const [isSaving, setIsSaving] = useState(false);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [selectedSnippet, setSelectedSnippet] = useState<Snippet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240); // in pixels
  const isResizing = useRef(false);
  const { showToast } = useToast();
  const navigate = useNavigate();

  // Handle sidebar resize
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;
    const newWidth = Math.max(120, Math.min(240, e.clientX));
    setSidebarWidth(newWidth);
  }, []);

  const handleMouseUp = useCallback(() => {
    isResizing.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const startResizing = () => {
    isResizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // Guard: if no access token, redirect to cloud login
  useEffect(() => {
    (async () => {
      const token = await getAccessToken();
      if (!token) {
        navigate("/login", { replace: true });
      } else {
        fetchSnippets();
      }
    })();
  }, [navigate]);

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
      const snippetsList = data.items || data;
      setSnippets(snippetsList);

      // Auto-select first snippet if available
      if (snippetsList.length > 0 && !selectedSnippet) {
        setSelectedSnippet(snippetsList[0]);
      }

      // Cache snippets for content script to use
      try {
        await browser.storage.local.set({
          [STORAGE_KEYS.CACHED_SNIPPETS]: JSON.stringify(snippetsList),
        });
        logger.success("Snippets cached for content script");
      } catch (error) {
        logger.error("Failed to cache snippets", { data: { error } });
      }

      setLoading(false);
    } catch (err) {
      logger.error("Error fetching snippets", { data: { error: err } });
      setError("Failed to load snippets. Please try again.");
      setLoading(false);
    }
  };

  const handleAddSnippet = () => {
    setDraftSnippet({ label: "", shortcut: "", content: "", tags: [] });
    setSelectedSnippet(null);
    setIsCreating(true);
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    setDraftSnippet({ label: "", shortcut: "", content: "", tags: [] });
    // Select first snippet if available
    if (snippets.length > 0) {
      setSelectedSnippet(snippets[0]);
    }
  };

  const handleSaveNewSnippet = async () => {
    if (
      !draftSnippet.label.trim() ||
      !draftSnippet.shortcut.trim() ||
      !draftSnippet.content.trim()
    ) {
      return;
    }

    setIsSaving(true);
    try {
      const user = await getUserInfo();
      const snippetData = { ...draftSnippet };
      if (user) {
        snippetData.userId = user.id;
      }

      const response = await authenticatedFetch(
        API_BASE_URL + API_ENDPOINTS.SNIPPETS,
        {
          method: "POST",
          body: JSON.stringify(snippetData),
        }
      );

      if (response.ok) {
        const data = await response.json();
        showToast("Snippet created successfully!", "success");
        setIsCreating(false);
        setDraftSnippet({ label: "", shortcut: "", content: "", tags: [] });
        await fetchSnippets();
        // Select the newly created snippet
        if (data.snippet) {
          setSelectedSnippet(data.snippet);
        }
      } else {
        const error = await response.json();
        showToast(error.message || "Failed to create snippet", "error");
      }
    } catch (error) {
      console.error("Failed to create snippet:", error);
      showToast("Failed to create snippet. Please try again.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSnippet = async (snippetId: string) => {
    const newSnippets = snippets.filter((s) => s.id !== snippetId);
    setSnippets(newSnippets);

    // Update cache immediately
    try {
      await browser.storage.local.set({
        [STORAGE_KEYS.CACHED_SNIPPETS]: JSON.stringify(newSnippets),
      });
      logger.success("Cache updated after delete");
    } catch (error) {
      logger.error("Failed to update cache after delete", { data: { error } });
    }

    // If deleted snippet was selected, select another one
    if (selectedSnippet?.id === snippetId) {
      setSelectedSnippet(newSnippets.length > 0 ? newSnippets[0] : null);
    }
  };

  const handleUpdateSnippet = async (updatedSnippet: Snippet) => {
    const newSnippets = snippets.map((s) =>
      s.id === updatedSnippet.id ? updatedSnippet : s
    );
    setSnippets(newSnippets);

    // Update cache immediately
    try {
      await browser.storage.local.set({
        [STORAGE_KEYS.CACHED_SNIPPETS]: JSON.stringify(newSnippets),
      });
      logger.success("Cache updated after update");
    } catch (error) {
      logger.error("Failed to update cache after update", { data: { error } });
    }

    // Update selected snippet if it's the one being updated
    if (selectedSnippet?.id === updatedSnippet.id) {
      setSelectedSnippet(updatedSnippet);
    }
  };

  const handleInlineUpdateSnippet = async (updatedSnippet: Snippet) => {
    // Optimistically update the UI
    handleUpdateSnippet(updatedSnippet);

    // Make API call to persist changes
    try {
      const response = await authenticatedFetch(
        API_BASE_URL + API_ENDPOINTS.SNIPPET_BY_ID(updatedSnippet.id),
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updatedSnippet),
        }
      );

      if (!response.ok) {
        // Revert on error by refetching
        showToast("Failed to update snippet", "error");
        fetchSnippets();
      }
    } catch (error) {
      console.error("Error updating snippet:", error);
      showToast("Failed to update snippet", "error");
      fetchSnippets();
    }
  };

  const filteredSnippets = snippets.filter((snippet) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      snippet.label.toLowerCase().includes(query) ||
      snippet.content.toLowerCase().includes(query) ||
      snippet.shortcut.toLowerCase().includes(query) ||
      snippet.tags?.some((tag) => tag.toLowerCase().includes(query))
    );
  });

  // Keyboard navigation for snippet list
  const handleKeyboardNavigation = useCallback(
    (e: KeyboardEvent) => {
      // Don't navigate if we're in creating mode or typing in an input
      const target = e.target as HTMLElement;
      if (
        isCreating ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (filteredSnippets.length === 0) return;

      const currentIndex = selectedSnippet
        ? filteredSnippets.findIndex((s) => s.id === selectedSnippet.id)
        : -1;

      let newIndex = currentIndex;

      if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
        e.preventDefault();
        newIndex =
          currentIndex < filteredSnippets.length - 1 ? currentIndex + 1 : 0;
      } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
        e.preventDefault();
        newIndex =
          currentIndex > 0 ? currentIndex - 1 : filteredSnippets.length - 1;
      }

      if (newIndex !== currentIndex && newIndex >= 0) {
        setSelectedSnippet(filteredSnippets[newIndex]);
      }
    },
    [filteredSnippets, selectedSnippet, isCreating]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyboardNavigation);
    return () => {
      document.removeEventListener("keydown", handleKeyboardNavigation);
    };
  }, [handleKeyboardNavigation]);

  return (
    <div className="flex flex-col h-full select-none">
      {/* Master-Detail Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Master */}
        <div
          style={{ width: sidebarOpen ? sidebarWidth : 0 }}
          className="flex flex-col border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 relative shrink-0 transition-[width] duration-200 ease-in-out overflow-hidden"
        >
          {/* Resize Handle */}
          <div
            className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors z-10"
            onMouseDown={startResizing}
          />
          {/* Search Bar */}
          <div className="px-2 py-2 border-b border-zinc-200 dark:border-zinc-800">
            <div className="relative">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500"
                strokeWidth={1.5}
              />
              <Input
                type="text"
                placeholder="Search snippets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-sm rounded-lg"
              />
            </div>
          </div>

          {/* Snippet List */}
          <ScrollArea className="flex-1">
            <div className="p-2 pb-14">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2
                    className="h-6 w-6 animate-spin text-zinc-600 dark:text-zinc-400"
                    strokeWidth={1.5}
                  />
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Loading snippets...
                  </p>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <p className="text-xs text-red-600 dark:text-red-400">
                    {error}
                  </p>
                  <Button
                    variant="link"
                    onClick={fetchSnippets}
                    className="text-xs"
                  >
                    Try again
                  </Button>
                </div>
              ) : filteredSnippets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    {searchQuery ? "No snippets found" : "No snippets yet"}
                  </p>
                  {searchQuery && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-500">
                      Try a different search term
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  {/* Draft snippet preview when creating */}
                  {isCreating &&
                    (draftSnippet.label || draftSnippet.shortcut) && (
                      <div className="w-full text-left h-auto py-2 px-2.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-dashed border-zinc-300 dark:border-zinc-600">
                        <div className="flex items-center gap-2 w-full min-w-0 overflow-hidden">
                          <span className="font-medium text-xs text-zinc-900 dark:text-zinc-100 truncate flex-1 min-w-0">
                            {draftSnippet.label || "Untitled"}
                          </span>
                          <span className="font-mono text-xs px-1.5 py-0 border border-zinc-200 dark:border-zinc-700 rounded max-w-18 truncate shrink-0 text-zinc-500">
                            {draftSnippet.shortcut || "/..."}
                          </span>
                        </div>
                      </div>
                    )}
                  {filteredSnippets.map((snippet) => (
                    <SnippetListItem
                      key={snippet.id}
                      snippet={snippet}
                      isSelected={
                        selectedSnippet?.id === snippet.id && !isCreating
                      }
                      onClick={() => {
                        if (isCreating) {
                          setIsCreating(false);
                          setDraftSnippet({
                            label: "",
                            shortcut: "",
                            content: "",
                            tags: [],
                          });
                        }
                        setSelectedSnippet(snippet);
                      }}
                      onUpdate={handleInlineUpdateSnippet}
                    />
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Floating Add Button */}
          <div className="px-2 py-2 border-t border-zinc-200 dark:border-zinc-800">
            <Button
              onClick={handleAddSnippet}
              className="w-full h-8 text-xs rounded-lg"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
              Add Snippet
            </Button>
          </div>

          {/* User Profile at Bottom */}
          <SidebarUserProfile />
        </div>

        {/* Right Content - Detail */}
        <div className="flex-1 flex flex-col bg-white dark:bg-zinc-950">
          {isCreating ? (
            <NewSnippetView
              draftSnippet={draftSnippet}
              onDraftChange={setDraftSnippet}
              onSave={handleSaveNewSnippet}
              onCancel={handleCancelCreate}
              isSaving={isSaving}
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            />
          ) : selectedSnippet ? (
            <SnippetDetailView
              key={selectedSnippet.id}
              snippet={selectedSnippet}
              onDelete={handleDeleteSnippet}
              onUpdate={handleUpdateSnippet}
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            />
          ) : (
            <>
              {/* Header with toggle when no snippet selected */}
              <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="h-8 w-8"
                  title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                >
                  {sidebarOpen ? (
                    <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.5} />
                  ) : (
                    <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
                  )}
                </Button>
              </div>
              <div className="flex items-center justify-center flex-1">
                <div className="text-center">
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Select a snippet to view details
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
