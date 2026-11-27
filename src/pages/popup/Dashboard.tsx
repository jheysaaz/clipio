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
  Settings,
  Clipboard,
  ArrowDownUp,
  PanelLeft,
  PanelLeftClose,
  Trash2,
  CloudOff,
} from "lucide-react";
import {
  FeedbackBanner,
  useFeedback,
} from "@/components/feedback/FeedbackProvider";
import { Icon } from "@/components/ui/icon";
import { InlineAction } from "@/components/ui/inline-action";
import { Kbd } from "@/components/ui/kbd";
const SnippetEditor = lazy(() => import("~/components/SnippetEditor"));
import { InlineError } from "@/components/ui/inline-error";

import type { Snippet, SnippetFormData } from "@/types";
import { createSnippet } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SnippetList } from "@/pages/popup/SnippetList";
import {
  initialiseSnippets,
  EMPTY_DRAFT,
  setIsSaving,
  restoreRecoveredSnippets,
  dismissRecoveryBanner,
  dismissRecoveryError,
  dismissLoadError,
  dismissCreateError,
  findSnippet,
  refreshSnippets,
  rememberSnippetView,
  resolveInitialSnippet,
  setDraft,
  useSnippets,
  snippetsStore,
} from "@/store/snippets";
import { setSearchQuery, useSearch, useVisibleSnippets } from "@/store/search";
import {
  contextMenuDraftItem,
  latestVersionItem,
  dismissedUpdateVersionItem,
  editorDraftsItem,
} from "@/storage/items";
import { captureError } from "@/lib/sentry";
import {
  POPUP_VIEW_SESSION_KEY,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/config/constants";
import { selectNewest } from "@/lib/snippet-utils";
import {
  fieldsFromForm,
  fieldsFromSnippet,
  recoverableCreateDraft,
  validateEditorFields,
} from "@/lib/snippet-draft";
import {
  discardDraft,
  discardStaleCreateDraft,
  discardUnflushedDraft,
  enqueueDelete,
  enqueueRestore,
  flushDraft,
  stageProvisionalDraft,
  waitForSnippetCommit,
  watchWriteQueueStatus,
} from "@/store/write-queue";
import { blankSnippetDraft } from "@/lib/trigger-prefix";
import {
  nudgeSidebarWidth,
  setSidebarWidth,
  setSidebarWidthToMax,
  setSidebarWidthToMin,
  useSidebarWidth,
  setSidebarOpen as storeSetSidebarOpen,
} from "@/store/sidebar";
import { openReleasePage, shouldShowUpdateAlert } from "@/lib/update-checker";
import { NEW_ROUTE, SNIPPET_ROUTE, viewFromPath } from "@/routes/popup";

const CONTEXT_MENU_DRAFT_SESSION_KEY = "__clipioContextMenuDraft__";

/** Browser-side timings used by the popup performance regression test. */
const POPUP_SHELL_MARK = "clipio:popup-shell";
const LIBRARY_READY_MARK = "clipio:library-ready";

function mark(name: string): void {
  if (typeof performance !== "undefined" && performance.mark) {
    performance.mark(name);
  }
}

type DeletedSnippet = {
  snippet: Snippet;
  /** Where it sat in the sidebar, so Undo can put it back in the same row. */
  index: number;
};

export default function Dashboard() {
  const navigate = useNavigate();

  const [deletedSnippet, setDeletedSnippet] = useState<DeletedSnippet | null>(
    null
  );
  const deletedMessageRef = useRef<HTMLDivElement>(null);
  const [pendingNameFocus, setPendingNameFocus] = useState(false);
  const { showBanner, dismissBanner, announce, announceError } = useFeedback();

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
      setDeletedSnippet(null);
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
  const startCreating = useCallback(() => {
    setDeletedSnippet(null);
    void navigate({ to: NEW_ROUTE, replace: true });
  }, [navigate]);

  // The create form and the delete confirmation live in `@/store/snippets`. The
  // draft in particular is not really the component's: it is filled from a
  // context-menu selection *before* the create view mounts, and the pasted text has
  // to survive the route moving to `#/new`. Component state started empty every
  // time, which is how "Save selection" could open a form with nothing in it.
  const draftSnippet = useSnippets((s) => s.draft);
  const setDraftSnippet = setDraft;
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
  const localOnly = useSnippets((s) => s.localOnly);
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
  /**
   * One id for the whole create session. It is state, not a ref: the id appears
   * in the JSX passed to the detail pane, and a ref read during render is both
   * a lint error and a stale-value trap when the create route is entered
   * directly. The id is not the authoritative record — the draft map is — it
   * only gives autosave and Create the same key.
   */
  const [provisionalCreateId, setProvisionalCreateId] = useState<string | null>(
    null
  );
  /** One create per draft: the debounce can fire many times before the commit. */
  const createStartedRef = useRef(false);

  /**
   * The new-snippet detail pane needs a Snippet-shaped value for the shared
   * editor, but the record must not enter the library until Create. The route
   * still addresses it as `#/new`; only the id is provisional.
   */
  const provisionalSnippet = useMemo<Snippet | null>(() => {
    if (!isCreating) return null;
    return {
      ...createSnippet(draftSnippet, "unknown"),
      id: provisionalCreateId ?? "new-provisional",
    };
  }, [isCreating, draftSnippet, provisionalCreateId]);

  // Edits are staged locally and committed by the background queue, so there is
  // no unsaved-changes dialog to guard navigation: the work survives a popup blur
  // or a snippet switch without asking the user to choose between them.

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
    // The shell is interactive before any snippet has been read. Marking the
    // first commit — rather than the end of the load — is what makes a slow
    // library visible as a slow *list*, not a slow *popup*.
    mark(POPUP_SHELL_MARK);
    void initialiseSnippets();
  }, []);

  useEffect(() => {
    if (!loading) mark(LIBRARY_READY_MARK);
  }, [loading]);

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
          createStartedRef.current = false;
          setProvisionalCreateId(null);
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
          createStartedRef.current = false;
          setProvisionalCreateId(null);
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

  // The queue is owned by the background. Watching it here is what lets the
  // editor's one status slot leave `Saving…` when the worker commits the draft.
  useEffect(() => watchWriteQueueStatus(), []);

  // Check for available update banner. The background checker writes these
  // items asynchronously, so a one-shot read can miss a release found after the
  // popup opens. Watch both items so the banner reacts to changes in place.
  const updateReleaseRef = useRef<{
    version: string;
    htmlUrl: string;
    publishedAt: string;
  } | null>(null);
  useEffect(() => {
    let mounted = true;
    const apply = (
      release: typeof updateReleaseRef.current,
      dismissed: string
    ) => {
      updateReleaseRef.current = release;
      setUpdateRelease(release);
      setShowUpdateBanner(shouldShowUpdateAlert(release, dismissed));
    };

    (async () => {
      try {
        const [release, dismissed] = await Promise.all([
          latestVersionItem.getValue(),
          dismissedUpdateVersionItem.getValue(),
        ]);
        if (mounted) apply(release, dismissed ?? "");
      } catch (err) {
        captureError(err, { action: "loadUpdateBanner" });
      }
    })();

    const unwatchRelease = latestVersionItem.watch((release) => {
      if (!mounted) return;
      void dismissedUpdateVersionItem
        .getValue()
        .then((dismissed) => {
          if (mounted) apply(release, dismissed ?? "");
        })
        .catch((err: unknown) => {
          captureError(err, { action: "loadUpdateBanner.watch" });
        });
    });
    const unwatchDismissed = dismissedUpdateVersionItem.watch((dismissed) => {
      if (mounted) apply(updateReleaseRef.current, dismissed ?? "");
    });

    return () => {
      mounted = false;
      unwatchRelease();
      unwatchDismissed();
    };
  }, []);

  useEffect(() => {
    if (loading) announce(i18n.t("dashboard.loadingSnippets"));
  }, [loading, announce]);

  useEffect(() => {
    if (deletedSnippet) deletedMessageRef.current?.focus();
  }, [deletedSnippet]);

  useEffect(() => {
    if (!pendingNameFocus) return;

    const focus = () => {
      const input = document.querySelector<HTMLInputElement>(
        '[data-testid="snippet-label-input"]'
      );
      if (!input) return false;
      input.focus();
      return true;
    };

    if (focus()) {
      // Defer clearing the flag out of the effect body so React does not report
      // a cascading render; the observer below is subscription-only.
      queueMicrotask(() => setPendingNameFocus(false));
      return;
    }

    // The editor is lazy-loaded, so the input can arrive a frame after Undo
    // restores the route. Watch for it rather than guessing a delay.
    const observer = new MutationObserver(() => {
      if (focus()) {
        setPendingNameFocus(false);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pendingNameFocus]);

  useEffect(() => {
    if (!showRecoveryBanner) {
      dismissBanner("recovery", { runOnDismiss: false });
      return;
    }
    showBanner({
      source: "recovery",
      severity: "error",
      testId: "warning-uninstall",
      message: i18n.t(
        "dashboard.warnings.recovery.body",
        recoverySnippets.length
      ),
      action: {
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
      },
      onDismiss: dismissRecoveryBanner,
    });
  }, [
    showRecoveryBanner,
    recoverySnippets.length,
    dismissRecoveryBanner,
    showBanner,
    dismissBanner,
    selectSnippet,
  ]);

  // Storage errors are real errors, so they belong in the provider's assertive
  // live region. The visible explanation lives in the editor's reserved status
  // slot — a banner here would push the toolbar and editor down every time the
  // popup opens. Announce once per unresolved condition, not on every render.
  const announcedQuotaRef = useRef(false);
  useEffect(() => {
    if (quotaWarning) {
      if (!announcedQuotaRef.current) {
        announceError(i18n.t("dashboard.storageError.message"));
        announcedQuotaRef.current = true;
      }
      return;
    }
    announcedQuotaRef.current = false;
  }, [quotaWarning, announceError]);

  useEffect(() => {
    if (!showUpdateBanner || !updateRelease) {
      dismissBanner("update", { runOnDismiss: false });
      return;
    }
    const version = updateRelease.version;
    showBanner({
      source: "update",
      severity: "info",
      testId: "warning-update",
      message: i18n.t("dashboard.warnings.updateAvailable.body", [version]),
      action: {
        label: i18n.t("dashboard.warnings.updateAvailable.action"),
        onClick: () => {
          void openReleasePage(updateRelease.htmlUrl);
          dismissBanner("update", { runOnDismiss: false });
          dismissedUpdateVersionItem.setValue(version).catch(console.warn);
          setShowUpdateBanner(false);
        },
      },
      onDismiss: () => {
        dismissedUpdateVersionItem.setValue(version).catch(console.warn);
        setShowUpdateBanner(false);
      },
    });
  }, [showUpdateBanner, updateRelease, showBanner, dismissBanner]);

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
    // Navigation is a state change too. Let the effect finish before it runs.
    if (initial) queueMicrotask(() => selectSnippet(initial.id));
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

  const ensureProvisionalCreateId = useCallback(() => {
    if (provisionalCreateId) return provisionalCreateId;
    const id = crypto.randomUUID();
    setProvisionalCreateId(id);
    return id;
  }, [provisionalCreateId]);

  function createErrorFor(problem?: string): string {
    return problem === "emptyLabel"
      ? i18n.t("snippetDetail.errors.emptyLabel")
      : problem === "emptyShortcut"
        ? i18n.t("snippetDetail.errors.emptyShortcut")
        : problem === "shortcutSpaces"
          ? i18n.t("snippetDetail.errors.shortcutSpaces")
          : problem === "shortcutConflict"
            ? i18n.t("snippetDetail.errors.shortcutConflict")
            : problem === "emptyContent"
              ? i18n.t("snippetDetail.errors.emptyContent")
              : problem === "malformedMedia"
                ? i18n.t("snippetDetail.errors.malformedMedia")
                : i18n.t("snippetDetail.errors.failedToSave");
  }

  /**
   * Autosave a draft. Once the debounced fields are valid, the first save is also
   * the create: the provisional id becomes the real record and the route follows
   * it. Later autosaves of the same draft stage an edit, never a second create.
   */
  const handleAutoSaveNewSnippet = useCallback(
    async (draft: SnippetFormData) => {
      const id = ensureProvisionalCreateId();
      await stageProvisionalDraft(id, draft);

      const validation = validateEditorFields(
        fieldsFromForm(draft),
        snippetsStore.state.snippets
      );
      // A half-typed draft is still protected in `local:editorDrafts`; it just
      // is not a record yet. The next autosave tries again with the full fields.
      if (!validation.ok || createStartedRef.current) return;

      createStartedRef.current = true;
      setIsSaving(true);
      try {
        const result = await flushDraft(id, snippetsStore.state.snippets);
        if (!result.ok) {
          createStartedRef.current = false;
          snippetsStore.setState((prev) => ({
            ...prev,
            createError: createErrorFor(result.error),
          }));
          return;
        }

        const outcome = await waitForSnippetCommit(id);
        if (outcome) {
          createStartedRef.current = false;
          snippetsStore.setState((prev) => ({
            ...prev,
            createError:
              outcome.error ?? i18n.t("snippetDetail.errors.failedToSave"),
          }));
          return;
        }

        // Re-read rather than appending a local copy: a storage change may have
        // refreshed the library already, and an append would show the snippet
        // twice with stale metadata.
        await refreshSnippets();
        await discardStaleCreateDraft(id, snippetsStore.state.snippets);
        snippetsStore.setState((prev) => ({
          ...prev,
          draft: { ...EMPTY_DRAFT },
          createError: null,
        }));
        setProvisionalCreateId(null);
        selectSnippet(id);
      } catch (error) {
        captureError(error, { action: "dashboard.create" });
        createStartedRef.current = false;
        snippetsStore.setState((prev) => ({
          ...prev,
          createError: i18n.t("snippetDetail.errors.failedToSave"),
        }));
      } finally {
        setIsSaving(false);
      }
    },
    [ensureProvisionalCreateId, selectSnippet]
  );

  /**
   * Start a create session, resuming a draft left by a popup that closed on blur.
   *
   * The id travels with the draft. A fresh id here would stage the recovered
   * fields under a second record, which is exactly how one create turned into two
   * snippets.
   */
  const createSessionDraft = async (
    content?: string
  ): Promise<{ id: string; draft: SnippetFormData }> => {
    if (content === undefined) {
      const drafts = await editorDraftsItem.getValue();
      const recovered = recoverableCreateDraft(
        drafts,
        snippetsStore.state.snippets
      );
      if (recovered) {
        return {
          id: recovered.id,
          draft: {
            label: recovered.fields.label,
            shortcut: recovered.fields.shortcut,
            content: recovered.fields.content,
            tags: [...(recovered.fields.tags ?? [])],
          },
        };
      }
      // A new draft whose id was committed in an earlier session would make the
      // next autosave an edit against revision zero — a conflict with our own
      // write, not with another person. Clear it so it cannot be found again.
      const stale = Object.values(drafts ?? {}).find(
        (item) =>
          item.isNew &&
          snippetsStore.state.snippets.some((s) => s.id === item.id)
      );
      if (stale) await discardUnflushedDraft(stale.id);
    }
    return {
      id: crypto.randomUUID(),
      draft: await blankSnippetDraft(content ?? ""),
    };
  };

  // Async because the shortcut default comes from storage. Set before navigating
  // so the detail pane mounts with a non-empty shortcut.
  const handleAddSnippet = async () => {
    const session = await createSessionDraft();
    createStartedRef.current = false;
    setProvisionalCreateId(session.id);
    setDraftSnippet(session.draft);
    startCreating();
  };

  const handleDeleteSnippet = async (snippetId: string) => {
    const snippetsInStore = snippetsStore.state.snippets;
    const snippet = findSnippet(snippetsInStore, snippetId);
    if (!snippet) return;
    const index = snippetsInStore.findIndex((s) => s.id === snippetId);

    try {
      await discardDraft(snippetId);
      await enqueueDelete(snippet);
      const outcome = await waitForSnippetCommit(snippetId);
      if (outcome) {
        showBanner({
          source: "delete",
          severity: "error",
          message:
            outcome.error ?? i18n.t("snippetDetail.errors.failedToDelete"),
        });
        return;
      }

      snippetsStore.setState((prev) => ({
        ...prev,
        snippets: prev.snippets.filter((s) => s.id !== snippetId),
      }));
      // The address deliberately still names the deleted snippet. No other
      // snippet takes over; the deleted pane owns this address until the user
      // navigates away, which is what keeps Undo available indefinitely.
      setDeletedSnippet({ snippet, index });
      announce(i18n.t("snippetDetail.deleted.live"));
    } catch (error) {
      captureError(error, { action: "dashboard.delete", snippetId });
      showBanner({
        source: "delete",
        severity: "error",
        message: i18n.t("snippetDetail.errors.failedToDelete"),
      });
    }
  };

  /** Restore the retained copy, at the same row, from a no-timer deleted pane. */
  const handleUndoDelete = async () => {
    if (!deletedSnippet) return;
    const { snippet, index } = deletedSnippet;

    try {
      await enqueueRestore(snippet, fieldsFromSnippet(snippet));
      const outcome = await waitForSnippetCommit(snippet.id);
      if (outcome) {
        showBanner({
          source: "undo-delete",
          severity: "error",
          message: outcome.error ?? i18n.t("snippetDetail.errors.failedToSave"),
        });
        return;
      }

      // Reinsert the retained copy rather than refreshing from storage: order
      // is part of what the user is getting back.
      snippetsStore.setState((prev) => {
        const without = prev.snippets.filter((s) => s.id !== snippet.id);
        const at = Math.min(index, without.length);
        return {
          ...prev,
          snippets: [...without.slice(0, at), snippet, ...without.slice(at)],
        };
      });
      setDeletedSnippet(null);
      setPendingNameFocus(true);
      selectSnippet(snippet.id);
    } catch (error) {
      captureError(error, {
        action: "dashboard.restore",
        snippetId: snippet.id,
      });
      showBanner({
        source: "undo-delete",
        severity: "error",
        message: i18n.t("snippetDetail.errors.failedToSave"),
      });
    }
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden select-none">
      <InlineError message={recoveryError} onDismiss={dismissRecoveryError} />

      {/* Master-Detail Layout */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
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
          <div className="px-2 pb-1 pt-2">
            <div className="relative">
              <Icon
                icon={Search}
                size="lg"
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
                className="h-9 rounded-lg pl-8 pr-12 text-ui-sm!"
              />
              {!searchQuery && (
                <Kbd
                  id="search-help"
                  className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center rounded border border-border bg-muted px-1 font-mono text-ui-xs! font-medium text-foreground/70 sm:flex"
                >
                  {/mac/i.test(navigator.platform) ? "⌘K" : "Ctrl+K"}
                </Kbd>
              )}
            </div>
          </div>

          {/* Snippet List */}
          {loading ? (
            <div
              data-testid="snippet-list-skeleton"
              role="status"
              aria-label={i18n.t("dashboard.loadingSnippets")}
              className="min-h-0 flex-1 space-y-1 overflow-hidden p-2"
            >
              {Array.from({ length: 8 }, (_, index) => (
                <div
                  key={index}
                  className="h-12 space-y-2 rounded-lg px-2.5 py-2"
                >
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-3 flex-1" />
                    <Skeleton className="h-3 w-10" />
                  </div>
                  <Skeleton className="h-2.5 w-3/4" />
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <InlineError
                message={loadError}
                onDismiss={dismissLoadError}
                className="border border-red-200 dark:border-red-800 rounded-lg"
              />
            </div>
          ) : filteredSnippets.length === 0 ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
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
            </div>
          ) : (
            <SnippetList
              snippets={filteredSnippets}
              selectedId={selectedSnippet?.id ?? null}
              isCreating={isCreating}
              draft={draftSnippet}
              resetKey={searchQuery}
              onSelect={(id) => {
                // No dirty check here on purpose. Edits are staged in local
                // storage, so switching snippets cannot lose them.
                if (isCreating) setDraftSnippet({ ...EMPTY_DRAFT });
                selectSnippet(id);
              }}
            />
          )}

          {/* Add Snippet + Settings, with a state line beneath them. */}
          <div className="px-2 py-2">
            <div className="flex items-center gap-1.5">
              <Button
                data-testid="add-snippet"
                onClick={handleAddSnippet}
                className="h-9 min-w-0 flex-1 overflow-hidden rounded-lg text-ui-sm!"
              >
                <Icon icon={Plus} size="lg" className="mr-1.5" />
                {i18n.t("dashboard.addSnippet")}
              </Button>
              <Button
                data-testid="settings-button"
                variant="outline"
                size="icon"
                onClick={() => {
                  setDeletedSnippet(null);
                  browser.runtime.openOptionsPage();
                }}
                className="h-9 w-9 shrink-0 rounded-lg"
                title={i18n.t("dashboard.settingsAndExport")}
                aria-label={i18n.t("dashboard.settingsAndExport")}
              >
                <Icon icon={Settings} size="lg" />
              </Button>
            </div>
            {/*
              The indicator has its own reserved line. Putting it in the button
              row took width from Add Snippet and, at a narrow sidebar, pushed
              Settings past the edge. This line keeps both buttons untouched in
              every storage mode.
            */}
            <div
              data-testid="storage-indicator-slot"
              className="flex h-4 items-center overflow-hidden"
            >
              {localOnly && (
                <span
                  data-testid="local-only-indicator"
                  title={i18n.t("dashboard.localOnlyDetail")}
                  aria-label={i18n.t("dashboard.localOnlyDetail")}
                  className="flex min-w-0 items-center gap-1 whitespace-nowrap text-ui-micro! text-muted-foreground"
                >
                  <Icon icon={CloudOff} size="sm" />
                  <span className="truncate">
                    {i18n.t("dashboard.localOnly")}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right Content - Detail */}
        <div
          data-testid="dashboard-main-pane"
          className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
        >
          <FeedbackBanner />

          {loading && !isCreating && !deletedSnippet && (
            <div
              data-testid="snippet-detail-skeleton"
              role="status"
              aria-label={i18n.t("dashboard.loadingSnippets")}
              className="flex flex-1 flex-col gap-4 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="size-8" />
                <Skeleton className="h-6 w-24" />
              </div>
              <Skeleton className="h-9 w-2/3" />
              <Skeleton className="h-7 w-40" />
              <Skeleton className="min-h-0 flex-1" />
            </div>
          )}

          {deletedSnippet && !isCreating && (
            <div className="flex flex-1 flex-col">
              <div className="flex h-11 items-center border-b border-border px-2">
                <Button
                  data-testid="snippet-toggle-sidebar"
                  variant="ghost"
                  size="icon"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  aria-label={i18n.t(
                    sidebarOpen
                      ? "snippetEditor.sidebarHideLabel"
                      : "snippetEditor.sidebarShowLabel"
                  )}
                  title={i18n.t(
                    sidebarOpen
                      ? "snippetEditor.sidebarHideTooltip"
                      : "snippetEditor.sidebarShowTooltip"
                  )}
                  className="size-8"
                >
                  <Icon
                    icon={sidebarOpen ? PanelLeftClose : PanelLeft}
                    stroke="emphasis"
                  />
                </Button>
              </div>
              <div className="flex flex-1 items-center justify-center p-8">
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                    <Icon icon={Trash2} size="xl" />
                  </div>
                  <p
                    ref={deletedMessageRef}
                    tabIndex={-1}
                    data-testid="snippet-deleted-message"
                    className="text-base font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {i18n.t("snippetDetail.deleted.title")}
                  </p>
                  <InlineAction
                    data-testid="snippet-undo-delete"
                    onClick={() => void handleUndoDelete()}
                  >
                    {i18n.t("snippetDetail.deleted.undo")}
                  </InlineAction>
                </div>
              </div>
            </div>
          )}

          {!deletedSnippet && (isCreating || selectedSnippet) && (
            <Suspense
              fallback={
                <div
                  data-testid="editor-skeleton"
                  role="status"
                  aria-label={i18n.t("dashboard.loadingSnippets")}
                  className="flex flex-1 flex-col gap-4 p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Skeleton className="size-8" />
                    <Skeleton className="h-8 w-28" />
                  </div>
                  <Skeleton className="h-10 w-2/3" />
                  <Skeleton className="h-8 w-40" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                </div>
              }
            >
              <SnippetEditor
                key={isCreating ? "new" : selectedSnippet!.id}
                snippet={(isCreating ? provisionalSnippet : selectedSnippet)!}
                draft={isCreating ? draftSnippet : undefined}
                onDraftChange={setDraftSnippet}
                onAutoSave={handleAutoSaveNewSnippet}
                createError={createError}
                onClearCreateError={dismissCreateError}
                existingSnippets={snippets}
                onDelete={handleDeleteSnippet}
                sidebarOpen={sidebarOpen}
                onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
              />
            </Suspense>
          )}
          {!deletedSnippet &&
          !isCreating &&
          !selectedSnippet &&
          snippets.length === 0 &&
          !loading ? (
            /* Empty state when no snippets exist. The pane stands on its own:
               no header strip holding a lone sidebar toggle, and no second
               placeholder strip for "select a snippet" when there is nothing
               to select. The list and its footer remain the navigation chrome. */
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
          ) : null}
        </div>
      </div>
    </div>
  );
}
