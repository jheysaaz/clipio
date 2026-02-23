import {
  useState,
  useEffect,
  useRef,
  useCallback,
  lazy,
  Suspense,
} from "react";
import { i18n } from "#i18n";
import {
  Plus,
  Search,
  Loader2,
  PanelLeftClose,
  PanelLeft,
  Settings,
  Clipboard,
  ArrowDownUp,
} from "lucide-react";
import SnippetListItem from "~/components/SnippetListItem";
const SnippetDetailView = lazy(() => import("~/components/SnippetDetailView"));
const NewSnippetView = lazy(() => import("~/components/NewSnippetView"));
import { InlineError } from "~/components/ui/inline-error";
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
  bulkSaveSnippets,
  tryRecoverFromBackup,
  clearSyncDataLostFlag,
  StorageQuotaError,
} from "~/storage";
import { WarningBanner } from "~/components/ui/warning-banner";
import { FLAGS } from "~/config/constants";
import { captureError } from "~/lib/sentry";

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
  const [showUninstallWarning, setShowUninstallWarning] = useState(false);
  const [recoverySnippets, setRecoverySnippets] = useState<Snippet[]>([]);
  const [showRecoveryBanner, setShowRecoveryBanner] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const isResizing = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
        captureError(err, { action: "loadSnippets" });
        setLoadError(i18n.t("dashboard.errors.failedToLoad"));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Check uninstall-warning flag + sign-out recovery on mount
  useEffect(() => {
    (async () => {
      try {
        const flags = await browser.storage.local.get([
          FLAGS.DISMISSED_UNINSTALL_WARNING,
          FLAGS.SYNC_DATA_LOST,
        ]);

        if (flags[FLAGS.DISMISSED_UNINSTALL_WARNING] !== true) {
          setShowUninstallWarning(true);
          // Persist immediately — don't wait for the X click.
          // If the popup is closed any other way the banner still won't reappear.
          browser.storage.local
            .set({ [FLAGS.DISMISSED_UNINSTALL_WARNING]: true })
            .catch(console.warn);
        }

        if (flags[FLAGS.SYNC_DATA_LOST] === true) {
          const backup = await tryRecoverFromBackup();
          if (backup.length > 0) {
            setRecoverySnippets(backup);
            setShowRecoveryBanner(true);
          }
          await clearSyncDataLostFlag();
        }
      } catch (err) {
        console.error("[Clipio] Flag check failed:", err);
        captureError(err, { action: "flagCheck" });
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
    } catch (err) {
      if (err instanceof StorageQuotaError) {
        setQuotaWarning(true);
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
          captureError(retryErr, { action: "saveSnippetRetry" });
          setCreateError(i18n.t("dashboard.errors.failedToCreate"));
        }
      } else {
        setCreateError(i18n.t("dashboard.errors.failedToCreate"));
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
      captureError(err, { action: "deleteSnippet" });
      throw err;
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
      captureError(err, { action: "updateSnippet" });
      throw err;
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
      if (e.key === "ArrowDown") {
        e.preventDefault();
        newIndex =
          currentIndex < filteredSnippets.length - 1 ? currentIndex + 1 : 0;
      } else if (e.key === "ArrowUp") {
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

  // Focus search on ⌘K / Ctrl+K
  useEffect(() => {
    const handleSearchShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    document.addEventListener("keydown", handleSearchShortcut);
    return () => document.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full select-none">
      {/* Sign-out recovery banner */}
      {showRecoveryBanner && (
        <WarningBanner
          action={{
            label: i18n.t(
              "dashboard.warnings.recovery.action",
              recoverySnippets.length
            ),
            onClick: async () => {
              try {
                await bulkSaveSnippets(recoverySnippets);
                const list = await getSnippets();
                setSnippets(list);
                if (list.length > 0) setSelectedSnippet(list[0]);
                setShowRecoveryBanner(false);
              } catch (err) {
                console.error("[Clipio] Recovery failed:", err);
                setRecoveryError(i18n.t("dashboard.errors.failedToRestore"));
              }
            },
          }}
          onDismiss={() => setShowRecoveryBanner(false)}
        >
          {i18n.t("dashboard.warnings.recovery.body", recoverySnippets.length)}
        </WarningBanner>
      )}
      <InlineError
        message={recoveryError}
        onDismiss={() => setRecoveryError(null)}
      />

      {/* First-open uninstall data-loss warning */}
      {showUninstallWarning && (
        <WarningBanner
          action={{
            label: i18n.t("dashboard.warnings.uninstall.action"),
            onClick: () => browser.runtime.openOptionsPage(),
          }}
          onDismiss={() => setShowUninstallWarning(false)}
        >
          {i18n.t("dashboard.warnings.uninstall.body")}
        </WarningBanner>
      )}

      {/* Quota warning banner */}
      {quotaWarning && (
        <WarningBanner
          action={{
            label: i18n.t("dashboard.warnings.quotaFull.action"),
            onClick: () => browser.runtime.openOptionsPage(),
          }}
          onDismiss={() => setQuotaWarning(false)}
        >
          {i18n.t("dashboard.warnings.quotaFull.body")}
        </WarningBanner>
      )}

      {/* Master-Detail Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <div
          style={{ width: sidebarOpen ? sidebarWidth : 0 }}
          className="flex flex-col border-r bg-muted/50 relative shrink-0 transition-[width] duration-200 ease-in-out overflow-hidden min-w-0"
        >
          {/* Resize Handle */}
          <div
            className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-muted-foreground/20 transition-colors z-10"
            onMouseDown={() => {
              isResizing.current = true;
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
          />

          {/* Search Bar */}
          <div className="px-2 py-2 border-b">
            <div className="relative">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
                strokeWidth={1.5}
              />
              <Input
                ref={searchInputRef}
                type="text"
                placeholder={i18n.t("dashboard.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-12 h-8 text-sm rounded-lg"
              />
              {!searchQuery && (
                <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden h-5 select-none items-center rounded border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
                  {/mac/i.test(navigator.platform) ? "⌘K" : "Ctrl+K"}
                </kbd>
              )}
            </div>
          </div>

          {/* Snippet List */}
          <ScrollArea className="flex-1 min-w-0">
            <div className="p-2 pb-14 overflow-hidden">
              {loading ? (
                <div
                  className="flex flex-col items-center justify-center py-12 gap-3"
                  role="status"
                  aria-live="polite"
                >
                  <Loader2
                    className="h-6 w-6 animate-spin text-muted-foreground"
                    strokeWidth={1.5}
                  />
                  <p className="text-xs text-muted-foreground">
                    {i18n.t("dashboard.loadingSnippets")}
                  </p>
                </div>
              ) : loadError ? (
                <InlineError
                  message={loadError}
                  onDismiss={() => setLoadError(null)}
                  className="border border-red-200 dark:border-red-800 rounded-lg"
                />
              ) : filteredSnippets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2.5 px-3">
                  <p className="text-xs text-muted-foreground text-center">
                    {searchQuery
                      ? i18n.t("dashboard.noSnippetsFound")
                      : i18n.t("dashboard.noSnippetsYet")}
                  </p>
                  {searchQuery ? (
                    <p className="text-xs text-muted-foreground text-center">
                      {i18n.t("dashboard.tryDifferentSearch")}
                    </p>
                  ) : snippets.length === 0 ? (
                    <>
                      <p className="text-xs text-muted-foreground text-center">
                        {i18n.t("dashboard.importSuggestion")}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-7 text-xs gap-1.5 mt-1"
                        onClick={() =>
                          browser.tabs.create({
                            url:
                              browser.runtime.getURL("/options.html") +
                              "#import-export",
                          })
                        }
                      >
                        <ArrowDownUp className="h-3 w-3" strokeWidth={1.5} />
                        {i18n.t("dashboard.importButton")}
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : (
                <div
                  className="space-y-1 overflow-hidden"
                  role="listbox"
                  aria-label={i18n.t("dashboard.snippetListLabel")}
                >
                  {/* Draft preview while creating */}
                  {isCreating &&
                    (draftSnippet.label || draftSnippet.shortcut) && (
                      <div className="w-full text-left h-auto py-2 px-2.5 rounded-lg bg-muted border border-dashed">
                        <div className="flex items-center gap-2 w-full min-w-0 overflow-hidden">
                          <span className="font-medium text-xs text-foreground truncate flex-1 min-w-0">
                            {draftSnippet.label ||
                              i18n.t("dashboard.draftLabel")}
                          </span>
                          <span className="font-mono text-xs px-1.5 py-0 border rounded max-w-18 truncate shrink-0 text-muted-foreground">
                            {draftSnippet.shortcut ||
                              i18n.t("dashboard.draftShortcut")}
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

          {/* Add Snippet + Settings */}
          <div className="px-2 py-2 border-t flex items-center gap-1.5">
            <Button
              onClick={handleAddSnippet}
              className="flex-1 h-8 text-xs rounded-lg"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
              {i18n.t("dashboard.addSnippet")}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => browser.runtime.openOptionsPage()}
              className="h-8 w-8 shrink-0 rounded-lg"
              title={i18n.t("dashboard.settingsAndExport")}
              aria-label={i18n.t("dashboard.settingsAndExport")}
            >
              <Settings className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Button>
          </div>
        </div>

        {/* Right Content - Detail */}
        <div className="flex-1 flex flex-col bg-background">
          {isCreating ? (
            <Suspense
              fallback={
                <div className="flex items-center justify-center flex-1">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              }
            >
              <NewSnippetView
                draftSnippet={draftSnippet}
                onDraftChange={setDraftSnippet}
                onSave={handleSaveNewSnippet}
                onCancel={handleCancelCreate}
                isSaving={isSaving}
                createError={createError}
                onClearCreateError={() => setCreateError(null)}
                sidebarOpen={sidebarOpen}
                onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
              />
            </Suspense>
          ) : selectedSnippet ? (
            <Suspense
              fallback={
                <div className="flex items-center justify-center flex-1">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              }
            >
              <SnippetDetailView
                key={selectedSnippet.id}
                snippet={selectedSnippet}
                onDelete={handleDeleteSnippet}
                onUpdate={handleUpdateSnippet}
                sidebarOpen={sidebarOpen}
                onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
              />
            </Suspense>
          ) : snippets.length === 0 && !loading ? (
            /* Empty state when no snippets exist */
            <>
              <div className="px-3 py-2 border-b flex items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="h-8 w-8"
                  title={
                    sidebarOpen
                      ? i18n.t("common.hideSidebar")
                      : i18n.t("common.showSidebar")
                  }
                  aria-label={
                    sidebarOpen
                      ? i18n.t("common.hideSidebar")
                      : i18n.t("common.showSidebar")
                  }
                >
                  {sidebarOpen ? (
                    <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.5} />
                  ) : (
                    <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
                  )}
                </Button>
              </div>
              <div className="flex flex-col items-center justify-center flex-1 p-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                  <Clipboard
                    className="h-8 w-8 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                </div>
                <h3 className="text-sm font-medium text-foreground mb-1">
                  {i18n.t("dashboard.emptyState.heading")}
                </h3>
                <p className="text-xs text-muted-foreground mb-4 max-w-50">
                  {i18n.t("dashboard.emptyState.body")}
                </p>
                <Button onClick={handleAddSnippet} className="h-8 text-xs">
                  <Plus className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                  {i18n.t("dashboard.emptyState.action")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="px-3 py-2 border-b flex items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="h-8 w-8"
                  title={
                    sidebarOpen
                      ? i18n.t("common.hideSidebar")
                      : i18n.t("common.showSidebar")
                  }
                  aria-label={
                    sidebarOpen
                      ? i18n.t("common.hideSidebar")
                      : i18n.t("common.showSidebar")
                  }
                >
                  {sidebarOpen ? (
                    <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.5} />
                  ) : (
                    <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
                  )}
                </Button>
              </div>
              <div className="flex items-center justify-center flex-1">
                <p className="text-sm text-muted-foreground">
                  {i18n.t("dashboard.detailPlaceholder")}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
