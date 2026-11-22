import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useStore } from "@tanstack/react-store";
import {
  Copy,
  Check,
  Trash2,
  PanelLeftClose,
  PanelLeft,
  Tag,
  X,
  Plus,
  Undo2,
  Redo2,
  MoreHorizontal,
  AlertCircle,
} from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor, type RichTextEditorRef } from "@/components/editor";
import { Badge } from "@/components/ui/badge";
import type { Snippet, SnippetFormData } from "@/types";
import { InlineError } from "@/components/ui/inline-error";
import { isWriteRefusal } from "@/store/snippets";
import {
  createAutosave,
  TAG_AUTOSAVE_DELAY_MS,
  type AutosaveOutcome,
} from "@/lib/autosave";
import {
  fieldsFromSnippet,
  type DraftProblem,
  type EditorFields,
} from "@/lib/snippet-draft";
import { detectShortcutConflict } from "@/lib/snippet-utils";
import {
  discardUnflushedDraft,
  flushDraft,
  redoLastEdit,
  refreshSyncStatus,
  refreshUndoAvailability,
  stageEdit,
  undoAvailabilityStore,
  undoLastEdit,
  writeQueueStore,
  queueOutcomesStore,
} from "@/store/write-queue";
import { snippetsStore } from "@/store/snippets";
import {
  getSnippetUsageCount,
  incrementSnippetUsage,
} from "@/storage/usage-tracking";
import { i18n } from "#i18n";
import { captureError } from "@/lib/sentry";
import { copyMarkdownAsRichText } from "@/lib/copy-markdown-as-rich-text";

/** Saving is quiet until it lasts long enough for a user to notice. */
const SAVING_VISIBLE_DELAY_MS = 400;

interface SnippetEditorProps {
  /** A saved snippet, or the provisional shape that backs an empty draft. */
  snippet: Snippet;
  /**
   * Present only for a new snippet. Its presence — not a second layout or an
   * `isNew` prop — is what makes the editor a draft.
   */
  draft?: SnippetFormData;
  onDraftChange?: (draft: SnippetFormData) => void;
  /** Called once the debounced draft has content; Dashboard creates the record. */
  onAutoSave?: (draft: SnippetFormData) => void;
  onDelete: (snippetId: string) => void | Promise<void>;
  onUndoDelete?: (snippet: Snippet) => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  createError?: string | null;
  onClearCreateError?: () => void;
  existingSnippets?: Snippet[];
}

const problemKeys = {
  emptyLabel: "snippetDetail.errors.emptyLabel",
  emptyShortcut: "snippetDetail.errors.emptyShortcut",
  shortcutSpaces: "snippetDetail.errors.shortcutSpaces",
  shortcutConflict: "snippetDetail.errors.shortcutConflict",
  emptyContent: "snippetDetail.errors.emptyContent",
  malformedMedia: "snippetDetail.errors.malformedMedia",
} as const satisfies Record<DraftProblem, string>;

function sameFields(a: EditorFields, b: EditorFields): boolean {
  return (
    a.label === b.label &&
    a.shortcut === b.shortcut &&
    a.content === b.content &&
    JSON.stringify(a.tags ?? []) === JSON.stringify(b.tags ?? [])
  );
}

function statusText(isDraft: boolean, hasDraftContent: boolean): string {
  if (isDraft && !hasDraftContent) {
    return i18n.t("snippetDetail.syncStatus.draft");
  }
  return i18n.t("snippetDetail.syncStatus.saved");
}

function shortcutErrorFor(
  value: string,
  existingSnippets: Snippet[],
  snippetId: string
): string {
  if (value.includes(" ")) {
    return i18n.t("snippetEditor.shortcutError");
  }
  const conflict = detectShortcutConflict(value, existingSnippets, snippetId);
  if (!conflict) return "";
  return conflict.type === "exact"
    ? i18n.t("snippetEditor.shortcutErrorDuplicate", [
        value,
        conflict.conflictingSnippet.label,
      ])
    : i18n.t("snippetEditor.shortcutErrorPrefix", [
        value,
        conflict.conflictingSnippet.shortcut,
      ]);
}

function modifierKey(): string {
  return /mac/i.test(navigator.platform) ? "⌘" : "Ctrl+";
}

export default function SnippetEditor({
  snippet,
  draft,
  onDraftChange,
  onAutoSave,
  onDelete,
  onUndoDelete,
  sidebarOpen = true,
  onToggleSidebar,
  createError = null,
  onClearCreateError,
  existingSnippets = [],
}: SnippetEditorProps) {
  // A draft is data, not a mode. The first render derives every field from it;
  // later keystrokes live here until the queue commits them.
  const isDraft = draft !== undefined;
  const initialFields = useMemo<EditorFields>(
    () =>
      draft
        ? {
            label: draft.label,
            shortcut: draft.shortcut,
            content: draft.content,
            tags: [...(draft.tags ?? [])],
          }
        : fieldsFromSnippet(snippet),
    [draft, snippet]
  );

  const [fields, setFields] = useState<EditorFields>(initialFields);
  // The visible shortcut may be invalid; `fields.shortcut` keeps the last valid
  // value so the rest of the snippet can keep autosaving.
  const [shortcutInput, setShortcutInput] = useState(initialFields.shortcut);
  const [shortcutError, setShortcutError] = useState("");
  const [dismissedOutcomeId, setDismissedOutcomeId] = useState<string | null>(
    null
  );
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagInput, setNewTagInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [usageCount, setUsageCount] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSaving, setShowSaving] = useState(false);
  const [initialShortcut, setInitialShortcut] = useState(
    initialFields.shortcut
  );

  const tagInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextEditorRef>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const snippetRef = useRef(snippet);
  const fieldsRef = useRef<EditorFields>(fields);
  const changedRef = useRef(false);
  const loadedIdRef = useRef<string | null>(null);

  const status = useStore(writeQueueStore);
  const queuedOutcome = useStore(queueOutcomesStore)[snippet.id];
  const outcome =
    queuedOutcome?.opId === dismissedOutcomeId ? undefined : queuedOutcome;
  const undoState = useStore(undoAvailabilityStore);
  const controlsForThisSnippet = !isDraft && undoState.snippetId === snippet.id;
  const canUndo = controlsForThisSnippet && undoState.canUndo;
  const canRedo = controlsForThisSnippet && undoState.canRedo;

  const hasDraftContent =
    !!fields.label.trim() ||
    !!fields.content.trim() ||
    (fields.tags?.length ?? 0) > 0 ||
    (!!fields.shortcut.trim() && fields.shortcut !== initialShortcut);
  const hasChanges = !sameFields(fields, fieldsFromSnippet(snippet));

  useEffect(() => {
    snippetRef.current = snippet;
    fieldsRef.current = fields;
    changedRef.current = isDraft ? hasDraftContent : hasChanges;
  });

  const persistFields = useCallback(
    async (next: EditorFields) => {
      const stored = snippetsStore.state.snippets.find(
        (item) => item.id === snippet.id
      );
      if (stored) await stageEdit(stored, next);
    },
    [snippet.id]
  );

  const autosave = useMemo(
    () => createAutosave<EditorFields>(persistFields, TAG_AUTOSAVE_DELAY_MS),
    [persistFields]
  );

  const persistDraft = useCallback(
    async (next: EditorFields) => {
      if (!onAutoSave) return;
      onAutoSave({
        label: next.label,
        shortcut: next.shortcut,
        content: next.content,
        tags: next.tags ?? [],
      });
    },
    [onAutoSave]
  );

  const draftAutosave = useMemo(
    () => createAutosave<EditorFields>(persistDraft, TAG_AUTOSAVE_DELAY_MS),
    [persistDraft]
  );

  /** Reset only when a different snippet is selected, never on a same-id echo. */
  useEffect(() => {
    if (loadedIdRef.current === snippet.id) return;
    loadedIdRef.current = snippet.id;
    setInitialShortcut(initialFields.shortcut);
    setFields(initialFields);
    setShortcutInput(initialFields.shortcut);
    setShortcutError("");
    setNewTagInput("");
    setDismissedOutcomeId(null);
    setIsAddingTag(false);
    setCopied(false);
    setActionError(null);
    setMenuOpen(false);
    autosave.discard();
    draftAutosave.discard();
    void refreshUndoAvailability(isDraft ? null : snippet.id);
    void refreshSyncStatus();
    // Keyed on identity only: a same-id echo from our own write must not reset
    // fields the user is still typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snippet.id, autosave, draftAutosave]);

  useEffect(() => {
    if (isDraft) return;
    void getSnippetUsageCount(snippet.id)
      .then(setUsageCount)
      .catch((err) => {
        captureError(err, { action: "loadUsageCount", snippetId: snippet.id });
      });
  }, [snippet.id, isDraft]);

  useEffect(() => {
    if (isDraft) {
      if (!hasDraftContent) {
        draftAutosave.discard();
        return;
      }
      draftAutosave.schedule(fields);
      return;
    }
    if (!hasChanges) {
      autosave.discard();
      return;
    }
    autosave.schedule(fields);
  }, [autosave, draftAutosave, fields, hasChanges, hasDraftContent, isDraft]);

  /** Leaving the tag input means the tag was committed: flush immediately. */
  useEffect(() => {
    if (isAddingTag || isDraft) return;
    void (async () => {
      const result = await autosave.flush();
      if (result && !result.ok) {
        setActionError(
          result.error instanceof Error
            ? result.error.message
            : i18n.t("snippetDetail.errors.failedToStage")
        );
      }
    })();
  }, [isAddingTag, autosave, isDraft]);

  const flushChanges = async (): Promise<AutosaveOutcome | null> => {
    if (isDraft) return draftAutosave.flush();
    const result = await autosave.flush();
    if (!changedRef.current) return result;
    const flush = await flushDraft(
      snippetRef.current.id,
      snippetsStore.state.snippets
    );
    if (!flush.ok && flush.error) {
      const key = problemKeys[flush.error as DraftProblem];
      setActionError(
        key ? i18n.t(key) : i18n.t("snippetDetail.errors.failedToStage")
      );
      return { ok: false, error: flush.error };
    }
    changedRef.current = false;
    return result;
  };

  /** The popup closes on blur, and the queued draft must survive that. */
  useEffect(() => {
    const flushOnHide = () => {
      if (document.visibilityState === "hidden") void flushChanges();
    };
    const flushOnPageHide = () => void flushChanges();
    document.addEventListener("visibilitychange", flushOnHide);
    window.addEventListener("pagehide", flushOnPageHide);
    return () => {
      document.removeEventListener("visibilitychange", flushOnHide);
      window.removeEventListener("pagehide", flushOnPageHide);
      void flushChanges();
    };
    // flushChanges closes over refs for everything that can change, so its
    // identity is deliberately not a dependency: the listeners must be installed
    // once, not re-installed on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    const busy = status.saving || status.pending > 0;
    if (!busy) {
      // Defer the reset out of the effect body; it still happens before paint
      // in practice, but React does not treat it as a cascading render.
      queueMicrotask(() => {
        if (!cancelled) setShowSaving(false);
      });
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(() => {
      if (!cancelled) setShowSaving(true);
    }, SAVING_VISIBLE_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status.saving, status.pending]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  // The toolbar advertises Alt+B and Alt+O, so they must work wherever focus is
  // in the editor — not only when a focusable descendant receives the event.
  useEffect(() => {
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === "b") {
        event.preventDefault();
        onToggleSidebar?.();
      } else if (key === "o") {
        event.preventDefault();
        setMenuOpen(true);
      }
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, [onToggleSidebar]);

  const commitFields = (next: EditorFields) => {
    setFields(next);
    if (isDraft) {
      onDraftChange?.({
        label: next.label,
        shortcut: next.shortcut,
        content: next.content,
        tags: next.tags ?? [],
      });
    }
  };

  const handleShortcutChange = (value: string) => {
    setShortcutInput(value);
    const error = shortcutErrorFor(value, existingSnippets, snippet.id);
    setShortcutError(error);
    // Invalid input stays visible, but never reaches the persisted fields.
    if (!error) commitFields({ ...fields, shortcut: value });
  };

  const step = async (direction: "undo" | "redo") => {
    autosave.discard();
    // `discard` stops the timer, not a write already in flight. Let it finish
    // before removing the draft, or it can stage the stale value back after the
    // restore and shadow the undone text.
    await autosave.settle();
    await discardUnflushedDraft(snippet.id);
    const result =
      direction === "undo"
        ? await undoLastEdit(snippet, fieldsRef.current)
        : await redoLastEdit(snippet, fieldsRef.current);
    if (!result.ok || !result.fields) return;
    setFields({ ...result.fields, tags: [...(result.fields.tags ?? [])] });
    setShortcutInput(result.fields.shortcut);
    setShortcutError("");
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && !isDraft) {
      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        void step("redo");
        return;
      }
      if (key === "z" || key === "y") {
        event.preventDefault();
        void step("undo");
        return;
      }
    }
  };

  const handleCopy = async () => {
    try {
      await copyMarkdownAsRichText(fields.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      const newCount = await incrementSnippetUsage(snippet.id);
      setUsageCount(newCount);
    } catch (err) {
      captureError(err, { action: "copy.snippet", snippetId: snippet.id });
      setActionError(i18n.t("snippetDetail.errors.failedToCopy"));
    }
  };

  const handleDelete = async () => {
    setMenuOpen(false);
    setIsDeleting(true);
    try {
      await onDelete(snippet.id);
      onUndoDelete?.(snippet);
    } catch (error) {
      if (isWriteRefusal(error)) {
        setActionError(error.userMessage);
      } else {
        console.error("Error deleting snippet:", error);
        captureError(error, { action: "deleteSnippet", snippetId: snippet.id });
        setActionError(i18n.t("snippetDetail.errors.failedToDelete"));
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRetry = async () => {
    setActionError(null);
    if (outcome) setDismissedOutcomeId(outcome.opId);
    onClearCreateError?.();
    // A failure with no pending keystrokes still has to re-enqueue the last
    // committed fields; otherwise Retry would do nothing after a popup reload.
    if (!isDraft && !changedRef.current) {
      await persistFields(fieldsRef.current);
      changedRef.current = true;
    }
    await flushChanges();
  };

  const statusIsError = status.refused > 0 || status.failed > 0 || !!outcome;
  const mod = modifierKey();
  const redoShortcut = mod === "⌘" ? "⌘⇧Z" : "Ctrl+Shift+Z";

  const tagEditor = (
    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
      <div className="flex items-center gap-1 text-muted-foreground mr-1">
        <Icon icon={Tag} size="sm" />
        <span className="text-[10px] font-medium uppercase tracking-wide">
          {i18n.t("snippetDetail.tags")}
        </span>
      </div>
      {(fields.tags ?? []).map((tag) => (
        <Badge
          key={tag}
          variant="outline"
          className="text-[10px] px-2 py-0.5 h-5 font-normal border-border text-muted-foreground gap-1 group cursor-default hover:bg-accent transition-colors"
        >
          {tag}
          <button
            type="button"
            onClick={() =>
              commitFields({
                ...fields,
                tags: (fields.tags ?? []).filter((item) => item !== tag),
              })
            }
            className="opacity-70 hover:opacity-100 transition-opacity -mr-0.5"
            title={i18n.t("snippetEditor.removeTag", [tag])}
            aria-label={i18n.t("snippetEditor.removeTag", [tag])}
          >
            <Icon icon={X} size="sm" stroke="emphasis" />
          </button>
        </Badge>
      ))}
      {isAddingTag ? (
        <Input
          ref={tagInputRef}
          value={newTagInput}
          onChange={(e) => setNewTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newTagInput.trim()) {
              const tag = newTagInput.trim().toLowerCase();
              if (!(fields.tags ?? []).includes(tag)) {
                commitFields({
                  ...fields,
                  tags: [...(fields.tags ?? []), tag],
                });
              }
              setNewTagInput("");
              setIsAddingTag(false);
            } else if (e.key === "Escape") {
              setNewTagInput("");
              setIsAddingTag(false);
            }
          }}
          onBlur={() => {
            if (newTagInput.trim()) {
              const tag = newTagInput.trim().toLowerCase();
              if (!(fields.tags ?? []).includes(tag)) {
                commitFields({
                  ...fields,
                  tags: [...(fields.tags ?? []), tag],
                });
              }
            }
            setNewTagInput("");
            setIsAddingTag(false);
          }}
          placeholder={i18n.t("snippetDetail.tagPlaceholder")}
          className="h-5 w-20 text-[10px] px-1.5 py-0 border-dashed"
          autoFocus
        />
      ) : (
        <Button
          variant="ghost"
          size="xs"
          data-testid="snippet-add-tag"
          onClick={() => {
            setIsAddingTag(true);
            setTimeout(() => tagInputRef.current?.focus(), 0);
          }}
          className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
          title={i18n.t("snippetDetail.addTagTitle")}
          aria-label={i18n.t("snippetDetail.addTag")}
        >
          <Icon icon={Plus} size="sm" />
          {i18n.t("snippetEditor.addTagLabel")}
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full min-h-0" onKeyDown={handleKeyDown}>
      {/* Toolbar: identical landmarks in both draft and saved modes. */}
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-border shrink-0">
        <Button
          variant="ghost"
          size="icon"
          data-testid="snippet-toggle-sidebar"
          onClick={onToggleSidebar}
          className="text-muted-foreground size-8"
          title={i18n.t(
            sidebarOpen
              ? "snippetEditor.sidebarHideTooltip"
              : "snippetEditor.sidebarShowTooltip"
          )}
          aria-label={i18n.t(
            sidebarOpen
              ? "snippetEditor.sidebarHideLabel"
              : "snippetEditor.sidebarShowLabel"
          )}
        >
          {sidebarOpen ? (
            <Icon icon={PanelLeftClose} stroke="emphasis" />
          ) : (
            <Icon icon={PanelLeft} stroke="emphasis" />
          )}
        </Button>
        <span className="w-px h-4 bg-border mx-0.5" aria-hidden="true" />
        <Button
          variant="ghost"
          size="icon"
          data-testid="snippet-undo"
          onClick={() => void step("undo")}
          disabled={!canUndo}
          className="text-muted-foreground size-8"
          title={i18n.t("snippetEditor.undoTooltip", [mod])}
          aria-label={i18n.t("snippetEditor.undoLabel")}
        >
          <Icon icon={Undo2} stroke="emphasis" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-testid="snippet-redo"
          onClick={() => void step("redo")}
          disabled={!canRedo}
          className="text-muted-foreground size-8"
          title={i18n.t("snippetEditor.redoTooltip", [redoShortcut])}
          aria-label={i18n.t("snippetEditor.redoLabel")}
        >
          <Icon icon={Redo2} stroke="emphasis" />
        </Button>

        <span
          data-testid="snippet-sync-status"
          role="status"
          aria-live="polite"
          className="flex items-center gap-1 min-w-32 px-2 text-[10px] font-medium text-muted-foreground"
        >
          {statusIsError ? (
            <>
              <Icon icon={AlertCircle} size="sm" stroke="emphasis" />
              <button
                type="button"
                onClick={() => void handleRetry()}
                className="text-destructive underline-offset-2 hover:underline"
                aria-label={i18n.t("snippetDetail.syncStatus.failed")}
                title={i18n.t("snippetEditor.retryTooltip")}
              >
                {i18n.t("snippetDetail.syncStatus.failed")}
              </button>
            </>
          ) : showSaving && (status.saving || status.pending > 0) ? (
            <>
              <Icon
                icon={AlertCircle}
                size="sm"
                stroke="emphasis"
                className="opacity-0"
              />
              {i18n.t("snippetDetail.syncStatus.saving")}
            </>
          ) : (
            <>
              <Icon icon={Check} size="sm" stroke="emphasis" />
              {statusText(isDraft, hasDraftContent)}
            </>
          )}
        </span>

        <div className="flex-1 min-w-2" />
        <Button
          variant="ghost"
          size="icon"
          data-testid="snippet-copy"
          onClick={() => void handleCopy()}
          disabled={isDraft}
          className={
            copied ? "text-green-600 size-8" : "text-foreground size-8"
          }
          title={
            copied
              ? i18n.t("snippetEditor.copiedTooltip", [mod])
              : i18n.t("snippetEditor.copyTooltip", [mod])
          }
          aria-label={
            copied
              ? i18n.t("snippetDetail.copiedLabel")
              : i18n.t("snippetDetail.copyToClipboard")
          }
          aria-pressed={copied}
        >
          {copied ? (
            <Icon icon={Check} stroke="emphasis" />
          ) : (
            <Icon icon={Copy} stroke="emphasis" />
          )}
        </Button>

        <div className="relative" ref={menuRef}>
          <Button
            variant="ghost"
            size="icon"
            data-testid="snippet-more"
            onClick={() => setMenuOpen((open) => !open)}
            disabled={isDraft}
            className="text-muted-foreground size-8"
            title={i18n.t("snippetEditor.moreTooltip")}
            aria-label={i18n.t("snippetEditor.more")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <Icon icon={MoreHorizontal} stroke="emphasis" />
          </Button>
          {menuOpen && (
            <div
              role="menu"
              data-testid="snippet-more-menu"
              className="absolute right-0 top-full z-20 mt-1 w-40 rounded-md border border-border bg-popover p-1 shadow-md"
            >
              <Button
                variant="ghost"
                role="menuitem"
                size="sm"
                data-testid="snippet-delete"
                onClick={() => void handleDelete()}
                disabled={isDeleting}
                className="w-full justify-start text-destructive"
                title={i18n.t("snippetEditor.deleteTooltip")}
                aria-label={i18n.t("snippetDetail.deleteSnippet")}
              >
                <Icon icon={Trash2} stroke="emphasis" />
                {i18n.t("snippetDetail.deleteSnippet")}
              </Button>
            </div>
          )}
        </div>
      </div>

      <InlineError
        message={
          isDraft
            ? createError
            : (actionError ??
              (outcome
                ? (outcome.error ??
                  i18n.t(
                    outcome.status === "refused"
                      ? "snippetDetail.syncStatus.refused"
                      : "snippetDetail.syncStatus.failed"
                  ))
                : null))
        }
        onDismiss={() => {
          setActionError(null);
          if (outcome) setDismissedOutcomeId(outcome.opId);
          onClearCreateError?.();
        }}
      />

      {/* Title row: one input pair, always in the same position. */}
      <div className="px-3 pt-1.5 pb-1 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <label className="sr-only" htmlFor="snippet-name">
            {i18n.t("snippetEditor.name")}
          </label>
          <Input
            id="snippet-name"
            data-testid="snippet-label-input"
            value={fields.label}
            onChange={(e) => commitFields({ ...fields, label: e.target.value })}
            placeholder={i18n.t("snippetEditor.namePlaceholder")}
            aria-label={i18n.t("snippetEditor.name")}
            autoFocus={isDraft}
            className="min-w-0 flex-1 h-7 border-0 bg-transparent px-0 text-sm font-medium shadow-none focus-visible:ring-0 focus-visible:border-0 placeholder:text-muted-foreground"
          />
          <div className="shrink-0">
            <label className="sr-only" htmlFor="snippet-shortcut">
              {i18n.t("snippetEditor.shortcut")}
            </label>
            <Input
              id="snippet-shortcut"
              data-testid="snippet-shortcut-input"
              value={shortcutInput}
              onChange={(e) => handleShortcutChange(e.target.value)}
              placeholder={i18n.t("snippetEditor.shortcutPlaceholder")}
              title={i18n.t("snippetEditor.shortcutTip")}
              aria-label={i18n.t("snippetEditor.shortcut")}
              aria-invalid={!!shortcutError}
              aria-describedby={shortcutError ? "shortcut-error" : undefined}
              className={`h-6 w-20 rounded border-border bg-secondary px-2 text-center font-mono text-[10px]! shadow-none ${
                shortcutError ? "border-destructive" : ""
              }`}
            />
            {shortcutError && (
              <p
                id="shortcut-error"
                data-testid="snippet-shortcut-error"
                role="alert"
                className="mt-1 text-[10px] text-destructive"
              >
                {shortcutError}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Content fills the space between the two fixed chrome rows. */}
      <div
        className="flex-1 min-h-0 px-3 pb-2"
        data-testid="snippet-content-editor"
      >
        <RichTextEditor
          ref={editorRef}
          value={fields.content}
          onChange={(value) => commitFields({ ...fields, content: value })}
          placeholder={i18n.t("snippetEditor.contentPlaceholder")}
          ariaLabel={i18n.t("snippetEditor.content")}
          onCopyError={() =>
            setActionError(i18n.t("snippetDetail.errors.failedToCopy"))
          }
        />
      </div>

      {/* Footer: tags left, usage right; no second status line. */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-t border-border bg-muted/30 shrink-0">
        {tagEditor}
        <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
          {usageCount} {i18n.t("snippetDetail.uses")}
        </span>
      </div>
    </div>
  );
}
