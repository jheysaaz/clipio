import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  lazy,
  Suspense,
} from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
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
import { Icon } from "@/components/ui/icon";
import SnippetListItem from "@/components/SnippetListItem";
import ConfirmDialog from "@/components/ConfirmDialog";
const SnippetDetailView = lazy(() => import("~/components/SnippetDetailView"));
const NewSnippetView = lazy(() => import("~/components/NewSnippetView"));
import { InlineError } from "@/components/ui/inline-error";
import { toast } from "sonner";

import type { Snippet, SnippetFormData } from "@/types";
import { createSnippet } from "@/types";
import { fuzzyMatchSnippets } from "@/lib/preview-helpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
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
} from "@/storage";
import { WarningBanner } from "@/components/ui/warning-banner";
import {
  syncDataLostItem,
  contextMenuDraftItem,
  latestVersionItem,
  dismissedUpdateVersionItem,
} from "@/storage/items";
import { captureError } from "@/lib/sentry";
import { selectNewest } from "@/lib/snippet-utils";
import { openReleasePage } from "@/lib/update-checker";
import {
  LIST_ROUTE,
  NEW_ROUTE,
  SNIPPET_ROUTE,
  viewFromPath,
} from "@/routes/popup";

const CONTEXT_MENU_DRAFT_SESSION_KEY = "__clipioContextMenuDraft__";

/**
 * Turn a `StorageQuotaError` into something the user can act on.
 *
 * `checkQuota` says which limit broke and by how much, so the message can name
 * it instead of saying "quota exceeded". Falls back to the generic copy when
 * the error came from the browser rather than the preflight, which is the one
 * case where we have no breakdown — and the case we want to hear about, so it is
 * also reported.
 */
/** Bytes as KB, for the quota message. The limits are small enough that one
 *  decimal is enough to be useful and never enough to be misleading. */
function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function quotaMessage(error: StorageQuotaError): string {
  const reasons = error.reasons;
  if (!reasons || reasons.length === 0) {
    captureError(error, { action: "quotaError.noReasons" });
    return i18n.t("dashboard.errors.quotaExceeded");
  }
  const parts = reasons.map((reason) => {
    if (reason.kind === "per-item") {
      return i18n.t("dashboard.errors.quotaPerItem", [
        formatBytes(reason.actual),
        formatBytes(reason.limit),
      ]);
    }
    if (reason.kind === "count") {
      return i18n.t("dashboard.errors.quotaCount", [
        String(reason.actual),
        String(reason.limit),
      ]);
    }
    return i18n.t("dashboard.errors.quotaTotal", [
      formatBytes(reason.actual),
      formatBytes(reason.limit),
    ]);
  });
  return parts.join(" ");
}

export default function Dashboard() {
  const navigate = useNavigate();

  // Which snippet is selected, and whether the create form is open, are now the
  // URL. That is what gives a selection an address: a future "open this specific
  // snippet" — a context-menu entry, a notification, a keyboard shortcut — builds
  // a location instead of inventing a side channel.
  //
  // `replace`, never `push`. The popup closes on blur, so a history entry is
  // something the user can never use; growing `history.length` would only make a
  // stray Back press worse.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const view = viewFromPath(pathname);
  const isCreating = view.kind === "new";
  const selectedSnippetId = view.kind === "snippet" ? view.id : null;

  const selectSnippet = useCallback(
    (id: string) => {
      void navigate({
        to: SNIPPET_ROUTE,
        params: { snippetId: id },
        replace: true,
      });
    },
    [navigate]
  );
  const showList = useCallback(() => {
    void navigate({ to: LIST_ROUTE, replace: true });
  }, [navigate]);
  const startCreating = useCallback(() => {
    void navigate({ to: NEW_ROUTE, replace: true });
  }, [navigate]);

  const [searchQuery, setSearchQuery] = useState("");
  const [draftSnippet, setDraftSnippet] = useState<SnippetFormData>({
    label: "",
    shortcut: "",
    content: "",
    tags: [],
  });
  const [isSaving, setIsSaving] = useState(false);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  /**
   * The selected snippet, looked up from the list.
   *
   * Derived rather than stored: the route holds the *id*, and the object lives in
   * `snippets`. Storing both meant two sources of truth, and an edit to the
   * selected snippet had to be written back into a copy or the detail pane would
   * keep rendering the pre-edit version.
   */
  const selectedSnippet: Snippet | null = useMemo(
    () => snippets.find((s) => s.id === selectedSnippetId) ?? null,
    [snippets, selectedSnippetId]
  );

  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [quotaWarning, setQuotaWarning] = useState(false);
  const [syncPausedWarning, setSyncPausedWarning] = useState(false);

  const [recoverySnippets, setRecoverySnippets] = useState<Snippet[]>([]);
  const [showRecoveryBanner, setShowRecoveryBanner] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [updateRelease, setUpdateRelease] = useState<{
    version: string;
    htmlUrl: string;
    publishedAt: string;
  } | null>(null);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const isResizing = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const detailHasChanges = useRef(false);
  const [pendingSnippet, setPendingSnippet] = useState<Snippet | null>(null);

  // -------------------------------------------------------------------------
  // Sidebar resize
  // -------------------------------------------------------------------------

  const SIDEBAR_MIN_WIDTH = 120;
  const SIDEBAR_MAX_WIDTH = 240;

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;
    setSidebarWidth(
      Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, e.clientX))
    );
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

  const handleResizeKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = 20;
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        setSidebarWidth((w) => Math.max(SIDEBAR_MIN_WIDTH, w - step));
        break;
      case "ArrowRight":
        e.preventDefault();
        setSidebarWidth((w) => Math.min(SIDEBAR_MAX_WIDTH, w + step));
        break;
      case "Home":
        e.preventDefault();
        setSidebarWidth(SIDEBAR_MIN_WIDTH);
        break;
      case "End":
        e.preventDefault();
        setSidebarWidth(SIDEBAR_MAX_WIDTH);
        break;
    }
  }, []);

  // -------------------------------------------------------------------------
  // Load snippets on mount
  // -------------------------------------------------------------------------

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const list = await getSnippets();
        setSnippets(list);

        // Check if we're already in local-fallback mode
        const status = await getStorageStatus();
        if (status.quotaExceeded) {
          setQuotaWarning(true);
        } else if (status.mode === "local" && status.localReason === "manual") {
          setSyncPausedWarning(true);
        }
      } catch (err) {
        console.error("[Clipio] Failed to load snippets:", err);
        captureError(err, { action: "loadSnippets" });
        setLoadError(i18n.t("dashboard.errors.failedToLoad"));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Check if the popup was opened via the "Save selection" context-menu action.
  // If so, pre-fill the draft and switch to create mode.
  useEffect(() => {
    (async () => {
      try {
        const draft = await contextMenuDraftItem.getValue();
        if (typeof draft === "string" && draft) {
          // Consume both stores immediately so the draft doesn't persist across reopens.
          await contextMenuDraftItem.removeValue().catch((err) => {
            captureError(err, { action: "loadContextMenuDraft.clearLocal" });
          });
          await browser.storage.session
            .remove(CONTEXT_MENU_DRAFT_SESSION_KEY)
            .catch((err) => {
              captureError(err, {
                action: "loadContextMenuDraft.clearSession",
              });
            });
          setDraftSnippet({
            label: "",
            shortcut: "/",
            content: draft,
            tags: [],
          });
          startCreating();
          return;
        }

        const sessionDraftResult = await browser.storage.session.get(
          CONTEXT_MENU_DRAFT_SESSION_KEY
        );
        const sessionDraft = sessionDraftResult[CONTEXT_MENU_DRAFT_SESSION_KEY];
        if (typeof sessionDraft === "string" && sessionDraft) {
          await browser.storage.session
            .remove(CONTEXT_MENU_DRAFT_SESSION_KEY)
            .catch((err) => {
              captureError(err, {
                action: "loadContextMenuDraft.clearSession",
              });
            });
          setDraftSnippet({
            label: "",
            shortcut: "/",
            content: sessionDraft,
            tags: [],
          });
          startCreating();
        }
      } catch (err) {
        console.error("[Clipio] Failed to read context-menu draft:", err);
        captureError(err, { action: "loadContextMenuDraft" });
      }
    })();
  }, []);

  // Check uninstall-warning flag + sign-out recovery on mount
  useEffect(() => {
    (async () => {
      try {
        const dataLost = await syncDataLostItem.getValue();
        if (dataLost) {
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

  // Check for available update banner
  useEffect(() => {
    (async () => {
      try {
        const [release, dismissed] = await Promise.all([
          latestVersionItem.getValue(),
          dismissedUpdateVersionItem.getValue(),
        ]);
        if (release && release.version !== dismissed) {
          setUpdateRelease(release);
          setShowUpdateBanner(true);
        }
      } catch (err) {
        captureError(err, { action: "loadUpdateBanner" });
      }
    })();
  }, []);

  /**
   * Land on something when the URL does not already say what to show.
   *
   * A deep link like `#/snippet/abc` is a request for *that* snippet.
   * Auto-selecting the newest regardless would make every deep link open the
   * same snippet whatever its id — a link that looks right and is wrong, which is
   * worse than no link.
   *
   * Kept separate from loading, and keyed on the live address, because the router
   * may not have resolved the location by the time snippets arrive: a snapshot
   * taken during the load effect would still read "no snippet addressed" and
   * overrule the deep link.
   */
  const autoSelected = useRef(false);
  useEffect(() => {
    // `#/new` is a destination in its own right, so it must be left alone for the
    // same reason a deep-linked snippet is. Without this guard the effect fired
    // on the way in — the draft read resolves, `startCreating()` runs, then
    // `getSnippets()` resolves and this replaced the route with the newest
    // snippet. The create form closed itself and took the pasted text with it:
    // right-click → "Save selection" → the form appears → a moment later it is
    // gone. The `e2e/background.spec.ts` test missed it because it runs against
    // an empty library, where `snippets.length === 0` returns early anyway.
    if (selectedSnippetId) return;
    if (isCreating) return;
    if (autoSelected.current || snippets.length === 0) return;
    autoSelected.current = true;
    const newest = selectNewest(snippets);
    if (newest) selectSnippet(newest.id);
  }, [snippets, selectedSnippetId, isCreating, selectSnippet]);

  // -------------------------------------------------------------------------
  // CRUD helpers
  // -------------------------------------------------------------------------

  const handleAddSnippet = () => {
    setDraftSnippet({ label: "", shortcut: "/", content: "", tags: [] });
    startCreating();
  };

  const handleCancelCreate = () => {
    setDraftSnippet({ label: "", shortcut: "/", content: "", tags: [] });
    const newest = selectNewest(snippets);
    if (newest) selectSnippet(newest.id);
    else showList();
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
      // Address the new snippet rather than only showing it: the id is now in the
      // URL, so "copy link to this snippet" needs no work to start working.
      selectSnippet(newSnippet.id);
      setDraftSnippet({ label: "", shortcut: "", content: "", tags: [] });
      toast.success(i18n.t("dashboard.toast.snippetSaved"));
    } catch (err) {
      if (err instanceof StorageQuotaError) {
        // Show the banner, and explain rather than silently retrying.
        //
        // This used to retry the save "after manager has switched to local
        // mode". The manager no longer switches: Wave 9 replaced the silent
        // fallback with a refusal (), so
        // the retry ran the identical, stateless preflight and could not
        // succeed. The snippet is now simply not saved, which is a real
        // behaviour change — the user is told and can switch storage mode from
        // the options page.
        setQuotaWarning(true);
        setCreateError(quotaMessage(err));
        // The create view is deliberately left OPEN. Closing it here unmounted
        // `NewSnippetView`, which is the component that renders `createError` —
        // so the explanation was set and then immediately made invisible, and
        // the user saw their snippet silently not save. Keeping the form open
        // also lets them shorten the snippet and retry without starting over.
      } else {
        captureError(err, { action: "saveSnippet" });
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
      // Deleting the addressed snippet has to move the address too, or the URL
      // would keep pointing at something that no longer exists.
      if (selectedSnippetId === snippetId) {
        const newest = selectNewest(newList);
        if (newest) selectSnippet(newest.id);
        else showList();
      }
      toast.success(i18n.t("dashboard.toast.snippetDeleted"));
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
      toast.success(i18n.t("dashboard.toast.snippetUpdated"));
    } catch (err) {
      console.error("[Clipio] Failed to update snippet:", err);
      captureError(err, { action: "updateSnippet" });
      throw err;
    }
  };

  // -------------------------------------------------------------------------
  // Filtering & keyboard navigation
  // -------------------------------------------------------------------------

  const filteredSnippets: Snippet[] = useMemo(
    () =>
      searchQuery
        ? fuzzyMatchSnippets(searchQuery, snippets).map(
            (f) => f.snippet as unknown as Snippet
          )
        : [...snippets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [searchQuery, snippets]
  );

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
        selectSnippet(filteredSnippets[newIndex].id);
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
          testId="warning-uninstall"
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
                const newest = selectNewest(list);
                if (newest) selectSnippet(newest.id);
                setShowRecoveryBanner(false);
              } catch (err) {
                console.error("[Clipio] Recovery failed:", err);
                captureError(err, { action: "recoverSnippets" });
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

      {/* Quota warning banner — only shown when sync quota was actually exceeded */}
      {quotaWarning && (
        <WarningBanner
          testId="warning-quota"
          action={{
            label: i18n.t("dashboard.warnings.quotaFull.action"),
            onClick: () => browser.runtime.openOptionsPage(),
          }}
          onDismiss={() => setQuotaWarning(false)}
        >
          {i18n.t("dashboard.warnings.quotaFull.body")}
        </WarningBanner>
      )}

      {/* Sync paused banner — shown when user manually switched to local */}
      {syncPausedWarning && (
        <WarningBanner
          testId="warning-sync-paused"
          action={{
            label: i18n.t("dashboard.warnings.syncPaused.action"),
            onClick: () => browser.runtime.openOptionsPage(),
          }}
          onDismiss={() => setSyncPausedWarning(false)}
        >
          {i18n.t("dashboard.warnings.syncPaused.body")}
        </WarningBanner>
      )}

      {/* Update available banner */}
      {showUpdateBanner && updateRelease && (
        <WarningBanner
          testId="warning-update"
          action={{
            label: i18n.t("dashboard.warnings.updateAvailable.action"),
            onClick: () => {
              void openReleasePage(updateRelease.htmlUrl);
            },
          }}
          onDismiss={() => {
            dismissedUpdateVersionItem
              .setValue(updateRelease.version)
              .catch(console.warn);
            setShowUpdateBanner(false);
          }}
        >
          {i18n.t("dashboard.warnings.updateAvailable.body", [
            updateRelease.version,
          ])}
        </WarningBanner>
      )}

      {/* Master-Detail Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <div
          style={{ width: sidebarOpen ? sidebarWidth : 0 }}
          className="flex flex-col border-r bg-muted/50 relative shrink-0 transition-[width] duration-200 ease-in-out overflow-hidden min-w-0 min-h-0"
        >
          {/* Resize Handle */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={sidebarWidth}
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            aria-label={i18n.t("common.resizeSidebar")}
            tabIndex={0}
            className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-muted-foreground/20 transition-colors z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            onMouseDown={() => {
              isResizing.current = true;
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
            onKeyDown={handleResizeKeyDown}
          />

          {/* Search Bar */}
          <div className="px-2 py-2 border-b">
            <div className="relative">
              <Icon
                icon={Search}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                ref={searchInputRef}
                type="text"
                placeholder={i18n.t("dashboard.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={i18n.t("dashboard.searchPlaceholder")}
                aria-describedby="search-help"
                className="pl-8 pr-12 h-8 text-sm rounded-lg"
              />
              {!searchQuery && (
                <kbd
                  id="search-help"
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden h-5 select-none items-center rounded border bg-muted px-1 font-mono text-[10px] font-medium text-foreground/70 sm:flex"
                >
                  {/mac/i.test(navigator.platform) ? "⌘K" : "Ctrl+K"}
                </kbd>
              )}
            </div>
          </div>

          {/* Snippet List */}
          <ScrollArea className="flex-1 min-w-0 min-h-0">
            <div className="p-2 pb-14 overflow-hidden">
              {loading ? (
                <div
                  className="flex flex-col items-center justify-center py-12 gap-3"
                  role="status"
                  aria-live="polite"
                >
                  <Icon
                    icon={Loader2}
                    size="xl"
                    className="animate-spin text-muted-foreground"
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
                <div
                  data-testid="empty-state"
                  className="flex flex-col items-center justify-center py-6 gap-1 px-3"
                >
                  {/*
                    Message only, no buttons.

                    This pane used to offer "Create snippet" and "Import" while
                    the footer directly below offered "Add Snippet" and a
                    settings icon that reaches the same import screen, all at
                    once, beside a second full copy of the hero in the detail
                    pane. Four controls for two actions.

                    The actions now live in exactly one place — the detail pane's
                    empty state, which is also what stays visible when the
                    sidebar is collapsed. The footer is untouched: it is the
                    persistent control bar, not part of the empty state.
                  */}
                  <p className="text-xs text-muted-foreground text-center">
                    {searchQuery
                      ? i18n.t("dashboard.noSnippetsFound")
                      : i18n.t("dashboard.noSnippetsYet")}
                  </p>
                  {searchQuery ? (
                    <p className="text-xs text-muted-foreground text-center">
                      {i18n.t("dashboard.tryDifferentSearch")}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div
                  data-testid="snippet-list"
                  className="space-y-1 overflow-hidden"
                  role="listbox"
                  aria-label={i18n.t("dashboard.snippetListLabel")}
                  aria-activedescendant={
                    selectedSnippet ? `snippet-${selectedSnippet.id}` : ""
                  }
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
                      snippetId={`snippet-${snippet.id}`}
                      isSelected={
                        selectedSnippet?.id === snippet.id && !isCreating
                      }
                      onClick={() => {
                        const target = snippet;
                        if (detailHasChanges.current) {
                          setPendingSnippet(target);
                          return;
                        }
                        if (isCreating) {
                          setDraftSnippet({
                            label: "",
                            shortcut: "",
                            content: "",
                            tags: [],
                          });
                        }
                        selectSnippet(target.id);
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
              data-testid="add-snippet"
              onClick={handleAddSnippet}
              className="flex-1 h-8 text-xs rounded-lg"
            >
              <Icon icon={Plus} size="lg" className="mr-1.5" />
              {i18n.t("dashboard.addSnippet")}
            </Button>
            <Button
              data-testid="settings-button"
              variant="outline"
              size="icon"
              onClick={() => browser.runtime.openOptionsPage()}
              className="h-8 w-8 shrink-0 rounded-lg"
              title={i18n.t("dashboard.settingsAndExport")}
              aria-label={i18n.t("dashboard.settingsAndExport")}
            >
              <Icon icon={Settings} />
            </Button>
          </div>
        </div>

        {/* Right Content - Detail */}
        <div className="flex-1 flex flex-col bg-background">
          {isCreating ? (
            <Suspense
              fallback={
                <div className="flex items-center justify-center flex-1">
                  <Icon
                    icon={Loader2}
                    size="xl"
                    className="animate-spin text-muted-foreground"
                  />
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
                existingSnippets={snippets}
              />
            </Suspense>
          ) : selectedSnippet ? (
            <Suspense
              fallback={
                <div className="flex items-center justify-center flex-1">
                  <Icon
                    icon={Loader2}
                    size="xl"
                    className="animate-spin text-muted-foreground"
                  />
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
                onHasChanges={(v) => {
                  detailHasChanges.current = v;
                }}
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
                    <Icon icon={PanelLeftClose} />
                  ) : (
                    <Icon icon={PanelLeft} />
                  )}
                </Button>
              </div>
              <div className="flex flex-col items-center justify-center flex-1 p-8 text-center">
                <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                  <Icon
                    icon={Clipboard}
                    size="3xl"
                    className="text-muted-foreground"
                  />
                </div>
                <h3 className="text-sm font-medium text-foreground mb-1">
                  {i18n.t("dashboard.emptyState.heading")}
                </h3>
                <p className="text-xs text-muted-foreground mb-4 max-w-50">
                  {i18n.t("dashboard.emptyState.body")}
                </p>
                <div className="flex flex-col gap-2 w-full max-w-44">
                  <Button
                    data-testid="empty-create"
                    onClick={handleAddSnippet}
                    className="h-8 text-xs w-full"
                  >
                    <Icon icon={Plus} size="sm" className="mr-1.5" />
                    {i18n.t("dashboard.emptyState.action")}
                  </Button>
                  <Button
                    data-testid="empty-import"
                    variant="outline"
                    size="sm"
                    className="w-full h-7 text-xs gap-1.5"
                    onClick={() =>
                      browser.tabs.create({
                        // The import panel's own route, rather than the
                        // `#import-export` hash this used to build — which named
                        // no section and so fell through to Library by accident.
                        url:
                          browser.runtime.getURL("/options.html") +
                          "#/library/import",
                      })
                    }
                  >
                    <Icon icon={ArrowDownUp} size="sm" />
                    {i18n.t("dashboard.importButton")}
                  </Button>
                  {/*
                    No "Open settings" button here. The sidebar footer already
                    carries a settings icon labelled "Settings & Import/Export",
                    one click away and present in every state, so a third route
                    to the same page was pure duplication — and it forced an e2e
                    test to disambiguate by exact accessible name.
                  */}
                </div>
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
                    <Icon icon={PanelLeftClose} />
                  ) : (
                    <Icon icon={PanelLeft} />
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

      {/* Unsaved changes guard */}
      <ConfirmDialog
        isOpen={pendingSnippet !== null}
        onClose={() => setPendingSnippet(null)}
        onConfirm={() => {
          if (pendingSnippet) {
            detailHasChanges.current = false;
            selectSnippet(pendingSnippet.id);
            setPendingSnippet(null);
          }
        }}
        title={i18n.t("snippetDetail.unsavedChanges.title")}
        message={i18n.t("snippetDetail.unsavedChanges.message")}
        confirmText={i18n.t("snippetDetail.unsavedChanges.discard")}
        cancelText={i18n.t("snippetDetail.unsavedChanges.keepEditing")}
        confirmVariant="danger"
      />
    </div>
  );
}
