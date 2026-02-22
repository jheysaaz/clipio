import { useState, useEffect, useRef, useCallback } from "react";
import {
  Plus,
  Search,
  Loader2,
  PanelLeftClose,
  PanelLeft,
  Sun,
  Moon,
  Download,
  Upload,
  AlertTriangle,
  X,
  Clipboard,
} from "lucide-react";
import SnippetListItem from "~/components/SnippetListItem";
import SnippetDetailView from "~/components/SnippetDetailView";
import NewSnippetView from "~/components/NewSnippetView";
import { useToast } from "~/hooks/ToastContext";
import { useTheme } from "~/hooks/ThemeContext";
import type { Snippet, SnippetFormData } from "~/types";
import { createSnippet } from "~/types";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import {
  getSnippets,
  saveSnippet,
  updateSnippet,
  deleteSnippet,
  getStorageStatus,
  exportSnippets,
  importSnippets,
  StorageQuotaError,
} from "~/storage";

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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [quotaWarning, setQuotaWarning] = useState(false);
  const isResizing = useRef(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();
  const { theme, toggleTheme } = useTheme();

  // -------------------------------------------------------------------------
  // Sidebar resize
  // -------------------------------------------------------------------------

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;
    setSidebarWidth(Math.max(120, Math.min(240, e.clientX)));
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

  // -------------------------------------------------------------------------
  // Load snippets on mount
  // -------------------------------------------------------------------------

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const list = await getSnippets();
        setSnippets(list);
        if (list.length > 0) setSelectedSnippet(list[0]);

        // Check if we're already in local-fallback mode
        const status = await getStorageStatus();
        if (status.quotaExceeded) setQuotaWarning(true);
      } catch (err) {
        console.error("[Clipio] Failed to load snippets:", err);
        showToast("Failed to load snippets.", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // -------------------------------------------------------------------------
  // CRUD helpers
  // -------------------------------------------------------------------------

  const handleAddSnippet = () => {
    setDraftSnippet({ label: "", shortcut: "", content: "", tags: [] });
    setSelectedSnippet(null);
    setIsCreating(true);
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    setDraftSnippet({ label: "", shortcut: "", content: "", tags: [] });
    if (snippets.length > 0) setSelectedSnippet(snippets[0]);
  };

  const handleSaveNewSnippet = async () => {
    if (
      !draftSnippet.label.trim() ||
      !draftSnippet.shortcut.trim() ||
      !draftSnippet.content.trim()
    )
      return;

    setIsSaving(true);
    try {
      const newSnippet = createSnippet(draftSnippet);
      await saveSnippet(newSnippet);
      setSnippets((prev) => [...prev, newSnippet]);
      setSelectedSnippet(newSnippet);
      setIsCreating(false);
      setDraftSnippet({ label: "", shortcut: "", content: "", tags: [] });
      showToast("Snippet created!", "success");
    } catch (err) {
      if (err instanceof StorageQuotaError) {
        setQuotaWarning(true);
        showToast(
          "Sync storage full — switched to local storage. Your snippet was saved.",
          "error"
        );
        // Retry after manager has switched to local mode
        try {
          const newSnippet = createSnippet(draftSnippet);
          await saveSnippet(newSnippet);
          setSnippets((prev) => [...prev, newSnippet]);
          setSelectedSnippet(newSnippet);
          setIsCreating(false);
          setDraftSnippet({ label: "", shortcut: "", content: "", tags: [] });
        } catch (retryErr) {
          console.error("[Clipio] Retry after quota error failed:", retryErr);
          showToast("Failed to create snippet. Please try again.", "error");
        }
      } else {
        showToast("Failed to create snippet. Please try again.", "error");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSnippet = async (snippetId: string) => {
    try {
      await deleteSnippet(snippetId);
      const newList = snippets.filter((s) => s.id !== snippetId);
      setSnippets(newList);
      if (selectedSnippet?.id === snippetId) {
        setSelectedSnippet(newList.length > 0 ? newList[0] : null);
      }
    } catch (err) {
      console.error("[Clipio] Failed to delete snippet:", err);
      showToast("Failed to delete snippet.", "error");
    }
  };

  const handleUpdateSnippet = async (updated: Snippet) => {
    try {
      await updateSnippet(updated);
      setSnippets((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s))
      );
      if (selectedSnippet?.id === updated.id) setSelectedSnippet(updated);
    } catch (err) {
      console.error("[Clipio] Failed to update snippet:", err);
      showToast("Failed to update snippet.", "error");
    }
  };

  // -------------------------------------------------------------------------
  // Export / Import
  // -------------------------------------------------------------------------

  const handleExport = async () => {
    try {
      await exportSnippets();
      showToast("Snippets exported!", "success");
    } catch (err) {
      console.error("[Clipio] Export failed:", err);
      showToast("Failed to export snippets.", "error");
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { imported } = await importSnippets(file);
      const refreshed = await getSnippets();
      setSnippets(refreshed);
      showToast(`Imported ${imported} new snippet(s)!`, "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed.";
      showToast(message, "error");
    } finally {
      // Reset input so same file can be re-imported if needed
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  // -------------------------------------------------------------------------
  // Filtering & keyboard navigation
  // -------------------------------------------------------------------------

  const filteredSnippets = snippets.filter((snippet) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      snippet.label.toLowerCase().includes(q) ||
      snippet.content.toLowerCase().includes(q) ||
      snippet.shortcut.toLowerCase().includes(q) ||
      snippet.tags?.some((t) => t.toLowerCase().includes(q))
    );
  });

  const handleKeyboardNavigation = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        isCreating ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
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
    return () =>
      document.removeEventListener("keydown", handleKeyboardNavigation);
  }, [handleKeyboardNavigation]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full select-none">
      {/* Quota warning banner */}
      {quotaWarning && (
        <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs">
          <AlertTriangle
            className="h-3.5 w-3.5 shrink-0 mt-0.5"
            strokeWidth={1.5}
          />
          <p className="flex-1">
            Browser sync storage is full. New snippets are saved locally on this
            device only.{" "}
            <button
              onClick={handleExport}
              className="underline hover:no-underline font-medium"
            >
              Export a backup.
            </button>
          </p>
          <button onClick={() => setQuotaWarning(false)}>
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Master-Detail Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <div
          style={{ width: sidebarOpen ? sidebarWidth : 0 }}
          className="flex flex-col border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 relative shrink-0 transition-[width] duration-200 ease-in-out overflow-hidden min-w-0"
        >
          {/* Resize Handle */}
          <div
            className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors z-10"
            onMouseDown={() => {
              isResizing.current = true;
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
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
          <ScrollArea className="flex-1 min-w-0">
            <div className="p-2 pb-14 overflow-hidden">
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
              ) : filteredSnippets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    {searchQuery ? "No snippets found" : "No snippets yet"}
                  </p>
                  {searchQuery && (
                    <p className="text-xs text-zinc-500">
                      Try a different search term
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-1 overflow-hidden">
                  {/* Draft preview while creating */}
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
                      onUpdate={handleUpdateSnippet}
                    />
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Add Snippet Button */}
          <div className="px-2 py-2 border-t border-zinc-200 dark:border-zinc-800">
            <Button
              onClick={handleAddSnippet}
              className="w-full h-8 text-xs rounded-lg"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
              Add Snippet
            </Button>
          </div>

          {/* Settings Footer */}
          <div className="px-2 py-1.5 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            {/* Theme toggle group */}
            <div className="flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className="h-6 w-6 rounded-md"
                title={
                  theme === "light"
                    ? "Switch to dark mode"
                    : "Switch to light mode"
                }
              >
                {theme === "light" ? (
                  <Moon className="h-3 w-3" strokeWidth={1.5} />
                ) : (
                  <Sun className="h-3 w-3" strokeWidth={1.5} />
                )}
              </Button>
            </div>
            {/* Import/Export group */}
            <div className="flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleExport}
                className="h-6 w-6 rounded-md"
                title="Export snippets as JSON"
              >
                <Download className="h-3 w-3" strokeWidth={1.5} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => importInputRef.current?.click()}
                className="h-6 w-6 rounded-md"
                title="Import snippets from JSON"
              >
                <Upload className="h-3 w-3" strokeWidth={1.5} />
              </Button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleImport}
              />
            </div>
          </div>
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
          ) : snippets.length === 0 && !loading ? (
            /* Empty state when no snippets exist */
            <>
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
              <div className="flex flex-col items-center justify-center flex-1 p-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
                  <Clipboard
                    className="h-8 w-8 text-zinc-400 dark:text-zinc-500"
                    strokeWidth={1.5}
                  />
                </div>
                <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1">
                  No snippets yet
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4 max-w-50">
                  Create your first snippet to start saving and reusing text
                  quickly.
                </p>
                <Button onClick={handleAddSnippet} className="h-8 text-xs">
                  <Plus className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                  Create your first snippet
                </Button>
              </div>
            </>
          ) : (
            <>
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
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Select a snippet to view details
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
