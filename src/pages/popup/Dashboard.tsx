import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  lazy,
  Suspense,
} from "react";
import {
  useNavigate,
  useRouterState,
  useBlocker,
  type ShouldBlockFn,
} from "@tanstack/react-router";
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
import { ActivationChecklist } from "@/components/onboarding/ActivationChecklist";
const SnippetDetailView = lazy(() => import("~/components/SnippetDetailView"));
const NewSnippetView = lazy(() => import("~/components/NewSnippetView"));
import { InlineError } from "@/components/ui/inline-error";
import { toast } from "sonner";

import type { Snippet } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  initialiseSnippets,
  addSnippet,
  editSnippet,
  removeSnippet,
  restoreRecoveredSnippets,
  dismissRecoveryBanner,
  dismissRecoveryError,
  dismissQuotaWarning,
  dismissSyncPausedWarning,
  dismissLoadError,
  dismissCreateError,
  findSnippet,
  rememberSnippetView,
  resolveInitialSnippet,
  setDraft,
  useSnippets,
} from "@/store/snippets";
import { setSearchQuery, useSearch, useVisibleSnippets } from "@/store/search";
import { WarningBanner } from "@/components/ui/warning-banner";
import {
  contextMenuDraftItem,
  latestVersionItem,
  dismissedUpdateVersionItem,
} from "@/storage/items";
import { captureError } from "@/lib/sentry";
import {
  POPUP_VIEW_SESSION_KEY,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/config/constants";
import { selectNewest } from "@/lib/snippet-utils";
import { blankSnippetDraft } from "@/lib/trigger-prefix";
import {
  nudgeSidebarWidth,
  setSidebarWidth,
  setSidebarWidthToMax,
  setSidebarWidthToMin,
  useSidebarWidth,
  setSidebarOpen as storeSetSidebarOpen,
} from "@/store/sidebar";
import { openReleasePage } from "@/lib/update-checker";
import {
  LIST_ROUTE,
  NEW_ROUTE,
  SNIPPET_ROUTE,
  viewFromPath,
} from "@/routes/popup";

const CONTEXT_MENU_DRAFT_SESSION_KEY = "__clipioContextMenuDraft__";

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
      // Recorded here rather than in the route, so a deep link is remembered too —
      // the user did view it. Fire-and-forget: navigation must not wait on a
      // storage write.
      rememberSnippetView(id);
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

  // The create form and the delete confirmation live in `@/store/snippets`. The
  // draft in particular is not really the component's: it is filled from a
  // context-menu selection *before* the create view mounts, and the pasted text has
  // to survive the route moving to `#/new`. Component state started empty every
  // time, which is how "Save selection" could open a form with nothing in it.
  const draftSnippet = useSnippets((s) => s.draft);
  const setDraftSnippet = setDraft;
  const isSaving = useSnippets((s) => s.isSaving);

  // The library, its load state, the storage warnings and the recovery banner all
  // live in `src/store/snippets.ts`. They used to be eight `useState` calls here,
  // set from five separate effects — and nothing listened for changes made in
  // another context, so a snippet deleted in the options page stayed in this list
  // with a delete button that would fail. One store, one owner, one event.
  const snippets = useSnippets((s) => s.snippets);
  const lastViewedSnippetId = useSnippets((s) => s.lastViewedSnippetId);
  const searchQuery = useSearch((s) => s.query);
  const loading = useSnippets((s) => !s.isLoaded);
  const quotaWarning = useSnippets((s) => s.quotaWarning);
  const syncPausedWarning = useSnippets((s) => s.syncPausedWarning);
  const recoverySnippets = useSnippets((s) => s.recoverySnippets);
  const showRecoveryBanner = useSnippets((s) => s.showRecoveryBanner);
  const loadError = useSnippets((s) => s.loadError);
  const recoveryError = useSnippets((s) => s.recoveryError);

  /**
   * The selected snippet, looked up from the list.
   *
   * Derived rather than stored: the route holds the *id*, and the object lives in
   * the store. Storing both meant two sources of truth, and an edit to the
   * selected snippet had to be written back into a copy or the detail pane would
   * keep rendering the pre-edit version.
   */
  const selectedSnippet: Snippet | null = useMemo(
    () => findSnippet(snippets, selectedSnippetId),
    [snippets, selectedSnippetId]
  );

  const createError = useSnippets((s) => s.createError);
  const sidebarOpen = useSidebarWidth((s) => s.isOpen);
  const setSidebarOpen = (open: boolean) => storeSetSidebarOpen(open);
  // The width is persisted, because a popup closes on every blur: as component
  // state it reset constantly, so dragging the divider and clicking back into the
  // page lost the size.
  const sidebarWidth = useSidebarWidth((s) => s.width);
  const [updateRelease, setUpdateRelease] = useState<{
    version: string;
    htmlUrl: string;
    publishedAt: string;
  } | null>(null);
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
  const draggingRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------------
  // The unsaved-changes guard
  // -------------------------------------------------------------------------
  //
  // `useBlocker` is the router's own mechanism, so one code path guards every way
  // out of a dirty editor: a sidebar click, an arrow key, "Add snippet", the
  // browser's Back and Forward. It was a `pendingSnippet` store field consulted by
  // the sidebar row alone, which left Back — the one a popup user actually reaches
  // for — walking straight past it and dropping the edit.
  //
  // The popup's own navigation stays `replace`-only (ADR 0011). Blocking does not
  // change that: a blocked navigation simply does not happen, so `history.length`
  // still never grows.

  const detailHasChanges = useRef(false);

  /**
   * Whether this navigation would throw away an edit.
   *
   * A ref, not state: it is written from the editor's own effect on every
   * keystroke, and `useBlocker` re-registers its listener whenever this function's
   * identity changes — so state here would tear the blocker down and rebuild it
   * per character.
   *
   * `useCallback` for the same reason, and with no dependencies on purpose: the ref
   * it reads is stable for the life of the popup.
   *
   * Only a *different* address is guarded. Re-selecting the snippet already open
   * replaces the location with the one the router is already at, and a dialog
   * warning about edits that are not going anywhere would be a lie.
   */
  const shouldBlockNavigation: ShouldBlockFn = useCallback(
    ({ current, next }) =>
      detailHasChanges.current && current.pathname !== next.pathname,
    []
  );

  const blocker = useBlocker({
    shouldBlockFn: shouldBlockNavigation,
    // No `beforeunload`: the popup is torn down on blur, so there is no document
    // unload for a prompt to be *about* — only one the user cannot answer.
    enableBeforeUnload: false,
    withResolver: true,
  });

  /**
   * Let a blocked navigation happen.
   *
   * The dirty flag is cleared first, and it has to be. The editor is about to
   * unmount without ever reporting `false` — `SnippetDetailView` only reports on a
   * *change* — so leaving the flag set would re-arm the blocker against the very
   * navigation being permitted, and against every one after it: navigating to
   * `#/list` mounts no editor to correct it, and the next selection would raise the
   * dialog again, about nothing.
   */
  const confirmBlockedNavigation = useCallback(() => {
    detailHasChanges.current = false;
    blocker.proceed?.();
  }, [blocker]);

  // ---------------------------------------------------------------------------
  // Sidebar resize
  // ---------------------------------------------------------------------------
  //
  // Pointer capture, not a document-level `mousemove` listener, and this is the
  // difference between the popup sidebar feeling solid and feeling like it fights
  // you:
  //
  //  - a document listener keeps firing when the pointer leaves the window, so
  //    dragging past the edge kept resizing from nowhere
  //  - `mousemove` coalesces differently across devices than `pointermove` does
  //  - capture means the handle keeps receiving moves even when the cursor is
  //    faster than the page, which is what stops the sidebar lagging behind the
  //    pointer mid-drag
  //
  // The options page resizer has done this all along, and it feels right there.

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      draggingRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.style.cursor = "col-resize";
      // Stop the browser selecting the snippet labels mid-drag.
      document.body.style.userSelect = "none";
    },
    []
  );

  const handleResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      // The clamp lives in the store, so a drag cannot leave the divider somewhere
      // the keyboard resize cannot reach.
      setSidebarWidth(e.clientX);
    },
    []
  );

  const handleResizePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    },
    []
  );

  const handleResizeKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = 20;
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        nudgeSidebarWidth(-step);
        break;
      case "ArrowRight":
        e.preventDefault();
        nudgeSidebarWidth(step);
        break;
      case "Home":
        e.preventDefault();
        setSidebarWidthToMin();
        break;
      case "End":
        e.preventDefault();
        setSidebarWidthToMax();
        break;
    }
  }, []);

  // -------------------------------------------------------------------------
  // Load snippets on mount
  // -------------------------------------------------------------------------

  useEffect(() => {
    void initialiseSnippets();
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
          // Prefilled from the configured trigger prefix, read fresh: a value
          // captured at module load is stale for the life of the popup, and
          // "change it in Options, reopen the popup" is exactly the case.
          setDraftSnippet(await blankSnippetDraft(draft));
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
          setDraftSnippet(await blankSnippetDraft(sessionDraft));
          startCreating();
        }
      } catch (err) {
        console.error("[Clipio] Failed to read context-menu draft:", err);
        captureError(err, { action: "loadContextMenuDraft" });
      }
    })();
    // Both are stable for the popup's life: `setDraft` is a module-level store
    // action, and `startCreating` is a `useCallback` over the router's stable
    // `navigate`. Listed explicitly so the rule does not have to infer that;
    // a re-run would be harmless anyway, since the draft is consumed on read.
  }, [setDraftSnippet, startCreating]);

  /**
   * Honour the route a context-menu action asked for.
   *
   * `browser.action.openPopup()` takes no URL, so when the background opens the
   * popup there is nothing it can address — the popup comes up at whatever route it
   * last held. The background therefore leaves the requested route in session
   * storage and this reads it.
   *
   * Separate from the draft effect above, and deliberately *not* an else-branch of
   * it: "Save selection" carries text and implies the create route, while "Create
   * snippet" carries only the route. One is a draft, the other is a destination, and
   * merging them would mean two channels for one decision free to disagree.
   *
   * Consumed on read. Left in place it would drag the popup back to `#/new` on the
   * next open, long after the user had navigated somewhere else.
   *
   * `replace`, never `push` — ADR 0011. The popup closes on blur, so a history
   * entry is something the user can never use.
   */
  useEffect(() => {
    (async () => {
      try {
        const stored = await browser.storage.session.get(
          POPUP_VIEW_SESSION_KEY
        );
        const requested = stored[POPUP_VIEW_SESSION_KEY];
        if (typeof requested !== "string" || !requested) return;
        // Removed before navigating, so a failure here cannot leave a stale route
        // that yanks the user back on a later open.
        await browser.storage.session
          .remove(POPUP_VIEW_SESSION_KEY)
          .catch((err: unknown) => {
            captureError(err, { action: "popupView.clearSession" });
          });
        navigate({ to: requested, replace: true });
      } catch (err) {
        captureError(err, { action: "popupView" });
      }
    })();
  }, [navigate]);

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
   * Land on something when the URL does not already say what to show: the last
   * snippet viewed, falling back to the newest.
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
    // Last viewed, falling back to newest. The fallback is load-bearing: the
    // remembered snippet can be deleted from the options page, arrive deleted from
    // another device's sync, or be replaced by an import, and a stale id must not
    // leave the popup on a blank pane.
    const initial = resolveInitialSnippet(snippets, lastViewedSnippetId);
    if (initial) selectSnippet(initial.id);
  }, [
    snippets,
    lastViewedSnippetId,
    selectedSnippetId,
    isCreating,
    selectSnippet,
  ]);

  // -------------------------------------------------------------------------
  // CRUD helpers
  // -------------------------------------------------------------------------

  // Async because the shortcut default comes from storage. Not pre-filled in
  // `NewSnippetView` on mount instead: this sets the draft *before* navigating, so
  // the form mounts with a non-empty shortcut and a mount-time prefill would be
  // skipped — and if it were not, it would be a second writer racing the draft it
  // was handed.
  const handleAddSnippet = async () => {
    setDraftSnippet(await blankSnippetDraft());
    startCreating();
  };

  const handleCancelCreate = async () => {
    setDraftSnippet(await blankSnippetDraft());
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

    // `addSnippet` owns the saving flag, the error and the draft reset, so the
    // button cannot stay disabled after a refusal and the message cannot be shown
    // against a draft that has already been cleared.
    const result = await addSnippet(draftSnippet);
    if (!result.ok) {
      // The create view stays OPEN. Closing it here unmounts `NewSnippetView`,
      // which is the component that renders `createError` — so the explanation was
      // set and then immediately made invisible and the user watched their snippet
      // silently not save. Keeping the form open also lets them shorten the
      // snippet and retry without starting over.
      return;
    }
    // Address the new snippet rather than only showing it: the id is now in the
    // URL, so "copy link to this snippet" needs no work to start working.
    selectSnippet(result.value.id);
    toast.success(i18n.t("dashboard.toast.snippetSaved"));
  };

  const handleDeleteSnippet = async (snippetId: string) => {
    // `removeSnippet` throws on failure; this propagates to the delete dialog,
    // which shows a message rather than pretending it worked.
    const { remaining } = await removeSnippet(snippetId);
    // The snippet is gone, so there is nothing left for the unsaved-changes guard
    // to protect — and the navigation below would otherwise be blocked by edits to
    // a snippet that no longer exists, raising the dialog *after* the delete had
    // already succeeded.
    detailHasChanges.current = false;
    // Deleting the addressed snippet has to move the address too, or the URL
    // would keep pointing at something that no longer exists.
    if (selectedSnippetId === snippetId) {
      const newest = selectNewest(remaining);
      if (newest) selectSnippet(newest.id);
      else showList();
    }
    toast.success(i18n.t("dashboard.toast.snippetDeleted"));
  };

  const handleUpdateSnippet = async (updated: Snippet) => {
    await editSnippet(updated);
    toast.success(i18n.t("dashboard.toast.snippetUpdated"));
  };

  // -------------------------------------------------------------------------
  // Filtering & keyboard navigation
  // -------------------------------------------------------------------------

  // The list the sidebar renders, and the list the keyboard handler walks. One
  // value, so they cannot disagree — which a `useMemo` and a separate piece of
  // state invited.
  const filteredSnippets = useVisibleSnippets(snippets);

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
    [filteredSnippets, selectedSnippet, isCreating, selectSnippet]
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
              const result = await restoreRecoveredSnippets();
              if (!result.ok) return;
              const newest = selectNewest(result.value);
              if (newest) selectSnippet(newest.id);
            },
          }}
          onDismiss={dismissRecoveryBanner}
        >
          {i18n.t("dashboard.warnings.recovery.body", recoverySnippets.length)}
        </WarningBanner>
      )}
      <InlineError message={recoveryError} onDismiss={dismissRecoveryError} />

      {/* Quota warning banner — only shown when sync quota was actually exceeded */}
      {quotaWarning && (
        <WarningBanner
          testId="warning-quota"
          action={{
            label: i18n.t("dashboard.warnings.quotaFull.action"),
            onClick: () => browser.runtime.openOptionsPage(),
          }}
          onDismiss={dismissQuotaWarning}
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
          onDismiss={dismissSyncPausedWarning}
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

      {/* First-success loop. Hidden until the tour is over, and gone for good
          once the user dismisses it or has done all three things. */}
      <ActivationChecklist snippets={snippets} />

      {/* Master-Detail Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <div
          data-testid="snippet-library"
          style={{ width: sidebarOpen ? sidebarWidth : 0 }}
          className="flex flex-col border-r bg-muted/50 relative shrink-0 transition-[width] duration-200 ease-in-out overflow-hidden min-w-0 min-h-0"
        >
          {/* Resize Handle */}
          <div
            role="separator"
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerUp}
            aria-orientation="vertical"
            aria-valuenow={sidebarWidth}
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            aria-label={i18n.t("common.resizeSidebar")}
            tabIndex={0}
            className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-muted-foreground/20 transition-colors z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
                data-testid="snippet-search"
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
                  onDismiss={dismissLoadError}
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
                        // No dirty check here on purpose. `selectSnippet` goes
                        // through the router, so `useBlocker` already intercepted
                        // this if the editor had unsaved changes — a second guard
                        // would be a second answer to the same question, and the
                        // two could disagree.
                        if (isCreating) {
                          setDraftSnippet({
                            label: "",
                            shortcut: "",
                            content: "",
                            tags: [],
                          });
                        }
                        selectSnippet(snippet.id);
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
                onClearCreateError={dismissCreateError}
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

      {/*
        Unsaved changes guard. Driven entirely by the router's blocker, so it opens
        for a sidebar click, an arrow key, "Add snippet" or the browser's Back
        alike — one dialog for one question, asked by the thing that actually knows
        whether the navigation is going to happen.
      */}
      <ConfirmDialog
        isOpen={blocker.status === "blocked"}
        // `reset` keeps the user where they are, which is what "Keep editing"
        // means. It is also what the alert dialog calls on Escape or an outside
        // click, so every way out of this dialog other than Discard is a cancel.
        onClose={() => blocker.reset?.()}
        onConfirm={confirmBlockedNavigation}
        title={i18n.t("snippetDetail.unsavedChanges.title")}
        message={i18n.t("snippetDetail.unsavedChanges.message")}
        confirmText={i18n.t("snippetDetail.unsavedChanges.discard")}
        cancelText={i18n.t("snippetDetail.unsavedChanges.keepEditing")}
        confirmVariant="danger"
      />
    </div>
  );
}
