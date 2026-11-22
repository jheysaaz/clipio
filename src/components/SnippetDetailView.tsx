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
  SquareSlash,
  Undo2,
  Redo2,
  Save,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor, type RichTextEditorRef } from "@/components/editor";
import { Separator } from "@/components/ui/separator";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import type { Snippet, SnippetFormData } from "@/types";
import { InlineError } from "@/components/ui/inline-error";
import { getRelativeTime } from "@/lib/date-utils";
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
  type SyncStatus,
} from "@/store/write-queue";
import { snippetsStore } from "@/store/snippets";
import {
  getSnippetUsageCount,
  incrementSnippetUsage,
} from "@/storage/usage-tracking";
import { i18n } from "#i18n";
import { captureError } from "@/lib/sentry";
import { copyMarkdownAsRichText } from "@/lib/copy-markdown-as-rich-text";

interface SnippetDetailViewProps {
  snippet: Snippet;
  onDelete: (snippetId: string) => void | Promise<void>;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  /** Shown by the dashboard after a successful delete, so it can be undone. */
  onUndoDelete?: (snippet: Snippet) => void;
  /**
   * New snippets use this same pane. The only differences are an identity form
   * in the body, an explicit Create action, and actions that have nothing to act
   * on yet (undo, redo, copy, delete) disabled or hidden.
   */
  isNew?: boolean;
  draft?: SnippetFormData;
  onDraftChange?: (draft: SnippetFormData) => void;
  onAutoSave?: (draft: SnippetFormData) => void;
  onCreate?: () => void;
  onCancel?: () => void;
  isCreating?: boolean;
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

/** The compact status line is the only place save state is announced now. */
function statusText(status: SyncStatus, isNew: boolean): string {
  if (isNew && !status.saving && status.pending === 0) {
    return i18n.t("snippetDetail.syncStatus.draft");
  }
  if (status.refused > 0) return i18n.t("snippetDetail.syncStatus.refused");
  if (status.failed > 0) return i18n.t("snippetDetail.syncStatus.failed");
  if (status.saving || status.pending > 0) {
    return i18n.t("snippetDetail.syncStatus.saving");
  }
  return i18n.t("snippetDetail.syncStatus.saved");
}

export default function SnippetDetailView({
  snippet,
  onDelete,
  sidebarOpen = true,
  onToggleSidebar,
  onUndoDelete,
  isNew = false,
  draft,
  onDraftChange,
  onAutoSave,
  onCreate,
  onCancel,
  isCreating = false,
  createError = null,
  onClearCreateError,
  existingSnippets = [],
}: SnippetDetailViewProps) {
  // Memoised: this object is an autosave effect dependency. A fresh object each
  // render would restart the debounce timer forever and nothing would stage.
  const form = useMemo<SnippetFormData>(
    () =>
      draft ?? {
        label: snippet.label,
        shortcut: snippet.shortcut,
        content: snippet.content,
        tags: snippet.tags ?? [],
      },
    [draft, snippet.label, snippet.shortcut, snippet.content, snippet.tags]
  );

  const [editedContent, setEditedContent] = useState(form.content);
  const [editedTags, setEditedTags] = useState<string[]>(form.tags ?? []);
  const [newTagInput, setNewTagInput] = useState("");
  const [dismissedOutcomeId, setDismissedOutcomeId] = useState<string | null>(
    null
  );
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [shortcutError, setShortcutError] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextEditorRef>(null);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [usageCount, setUsageCount] = useState(0);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const status = useStore(writeQueueStore);
  const queuedOutcome = useStore(queueOutcomesStore)[snippet.id];
  const outcome =
    queuedOutcome?.opId === dismissedOutcomeId ? undefined : queuedOutcome;
  const undoState = useStore(undoAvailabilityStore);
  const controlsForThisSnippet = !isNew && undoState.snippetId === snippet.id;
  const canUndo = controlsForThisSnippet && undoState.canUndo;
  const canRedo = controlsForThisSnippet && undoState.canRedo;

  const snippetRef = useRef(snippet);
  const fieldsRef = useRef<EditorFields>(fieldsFromSnippet(snippet));
  const changedRef = useRef(false);
  const loadedIdRef = useRef<string | null>(null);
  const formRef = useRef<SnippetFormData>(form);
  // A new form starts with the trigger prefix already filled in. That is not
  // user content: without this baseline, the blank form would stage itself after
  // the first debounce and a create session that never typed anything would
  // leave a draft behind.
  const [initialShortcut, setInitialShortcut] = useState(form.shortcut);

  const currentFields = useMemo<EditorFields>(
    () => ({
      label: form.label,
      shortcut: form.shortcut,
      content: editedContent,
      tags: editedTags,
    }),
    [form.label, form.shortcut, editedContent, editedTags]
  );

  const hasChanges =
    currentFields.content !== snippet.content ||
    JSON.stringify(currentFields.tags) !== JSON.stringify(snippet.tags || []);

  const hasDraftContent =
    !!form.label.trim() ||
    (!!form.shortcut.trim() && form.shortcut !== initialShortcut) ||
    !!editedContent.trim() ||
    editedTags.length > 0;

  const canCreate =
    !!currentFields.label.trim() &&
    !!currentFields.shortcut.trim() &&
    !/\s/.test(currentFields.shortcut) &&
    !!currentFields.content.trim() &&
    !shortcutError;

  useEffect(() => {
    snippetRef.current = snippet;
    fieldsRef.current = currentFields;
    formRef.current = {
      ...form,
      content: editedContent,
      tags: editedTags,
    };
    changedRef.current = hasChanges;
  });

  const persistFields = useCallback(
    async (fields: EditorFields) => {
      // Stage, never commit. The background owns the queue; this document can
      // disappear on blur before a synchronous write would finish. Reading the
      // store at write time also gives the edit the newest revision.
      const stored = snippetsStore.state.snippets.find(
        (item) => item.id === snippet.id
      );
      if (stored) await stageEdit(stored, fields);
    },
    [snippet.id]
  );

  const autosave = useMemo(
    () => createAutosave<EditorFields>(persistFields, TAG_AUTOSAVE_DELAY_MS),
    [persistFields]
  );

  const persistDraft = useCallback(
    async (next: SnippetFormData) => {
      if (onAutoSave) await onAutoSave(next);
    },
    [onAutoSave]
  );

  const draftAutosave = useMemo(
    () => createAutosave<SnippetFormData>(persistDraft, TAG_AUTOSAVE_DELAY_MS),
    [persistDraft]
  );

  /** Reset only when a different snippet is selected, never on a same-id echo. */
  useEffect(() => {
    if (loadedIdRef.current === snippet.id) return;
    loadedIdRef.current = snippet.id;
    setInitialShortcut(form.shortcut);
    autosave.discard();
    draftAutosave.discard();
    setEditedContent(form.content);
    setEditedTags(form.tags ?? []);
    setNewTagInput("");
    setDismissedOutcomeId(null);
    setShortcutError("");
    setIsAddingTag(false);
    setCopied(false);
    setActionError(null);
    void refreshUndoAvailability(isNew ? null : snippet.id);
    void refreshSyncStatus();
    // Deliberately keyed on identity only: a same-id echo from our own write
    // must not reset fields the user is still typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snippet.id, autosave, draftAutosave]);

  useEffect(() => {
    if (isNew) return;
    void getSnippetUsageCount(snippet.id)
      .then(setUsageCount)
      .catch((err) => {
        captureError(err, { action: "loadUsageCount", snippetId: snippet.id });
      });
  }, [snippet.id, isNew]);

  useEffect(() => {
    if (isNew) {
      if (!hasDraftContent) {
        draftAutosave.discard();
        return;
      }
      draftAutosave.schedule({
        ...form,
        content: editedContent,
        tags: editedTags,
      });
      return;
    }
    if (!hasChanges) {
      autosave.discard();
      return;
    }
    autosave.schedule(currentFields);
  }, [
    autosave,
    draftAutosave,
    currentFields,
    form,
    hasChanges,
    hasDraftContent,
    editedContent,
    editedTags,
    isNew,
  ]);

  /** Leaving the tag input means the tag was committed: flush immediately. */
  useEffect(() => {
    if (isAddingTag || isNew) return;
    void (async () => {
      const outcome = await autosave.flush();
      if (outcome && !outcome.ok) {
        setActionError(
          outcome.error instanceof Error
            ? outcome.error.message
            : i18n.t("snippetDetail.errors.failedToStage")
        );
      }
    })();
  }, [isAddingTag, autosave, isNew]);

  const flushChanges = async (): Promise<AutosaveOutcome | null> => {
    if (isNew) {
      const outcome = await draftAutosave.flush();
      return outcome;
    }
    const outcome = await autosave.flush();
    if (!changedRef.current) return outcome;
    const result = await flushDraft(
      snippetRef.current.id,
      snippetsStore.state.snippets
    );
    if (!result.ok && result.error) {
      const key = problemKeys[result.error as DraftProblem];
      setActionError(
        key ? i18n.t(key) : i18n.t("snippetDetail.errors.failedToStage")
      );
      return { ok: false, error: result.error };
    }
    changedRef.current = false;
    return outcome;
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
    setEditedContent(result.fields.content);
    setEditedTags([...(result.fields.tags ?? [])]);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (isNew || !(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === "z" && event.shiftKey) {
      event.preventDefault();
      void step("redo");
    } else if (key === "z" || key === "y") {
      event.preventDefault();
      void step("undo");
    }
  };

  const handleCopy = async () => {
    try {
      await copyMarkdownAsRichText(editedContent);

      setCopied(true);
      setTimeout(() => setCopied(false), 2000);

      const newCount = await incrementSnippetUsage(snippet.id);
      setUsageCount(newCount);
    } catch (err) {
      captureError(err, { action: "copy.snippet", snippetId: snippet.id });
      setActionError(i18n.t("snippetDetail.errors.failedToCopy"));
    }
  };

  const handleShortcutChange = (value: string) => {
    if (!onDraftChange) return;
    if (value.includes(" ")) {
      setShortcutError(i18n.t("newSnippet.shortcutError"));
      return;
    }
    const conflict = detectShortcutConflict(value, existingSnippets);
    if (conflict) {
      setShortcutError(
        conflict.type === "exact"
          ? i18n.t("newSnippet.shortcutErrorDuplicate", [
              value,
              conflict.conflictingSnippet.label,
            ])
          : i18n.t("newSnippet.shortcutErrorPrefix", [
              value,
              conflict.conflictingSnippet.shortcut,
            ])
      );
    } else {
      setShortcutError("");
    }
    onDraftChange({ ...form, shortcut: value });
  };

  const handleConfirmDelete = async () => {
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
      setShowDeleteDialog(false);
    }
  };

  const statusIsError = status.refused > 0 || status.failed > 0;
  const statusIsSaving =
    !isNew && (status.saving || status.pending > 0) && !statusIsError;
  const isNewSaving = isNew && status.saving && !statusIsError;

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
      {/* Action bar — deliberately shorter than the footer, with grouped,
          differentiated controls instead of a row of identical ghost icons. */}
      <div className="px-2 py-0.5 border-b border-border flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggleSidebar}
          className="text-muted-foreground"
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
            <Icon icon={PanelLeftClose} stroke="emphasis" />
          ) : (
            <Icon icon={PanelLeft} stroke="emphasis" />
          )}
        </Button>
        <Separator orientation="vertical" className="h-3.5 mx-0.5" />
        {!isNew && (
          <div className="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              data-testid="snippet-undo"
              onClick={() => void step("undo")}
              disabled={!canUndo}
              className="text-muted-foreground"
              title={i18n.t("snippetDetail.undo")}
              aria-label={i18n.t("snippetDetail.undo")}
            >
              <Icon icon={Undo2} stroke="emphasis" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              data-testid="snippet-redo"
              onClick={() => void step("redo")}
              disabled={!canRedo}
              className="text-muted-foreground"
              title={i18n.t("snippetDetail.redo")}
              aria-label={i18n.t("snippetDetail.redo")}
            >
              <Icon icon={Redo2} stroke="emphasis" />
            </Button>
          </div>
        )}
        <span
          data-testid="snippet-sync-status"
          role="status"
          aria-live="polite"
          className={`flex items-center gap-1 px-1.5 text-[10px] font-medium ${
            statusIsError
              ? "text-destructive"
              : statusIsSaving || isNewSaving
                ? "text-primary"
                : "text-muted-foreground"
          }`}
        >
          {statusIsError ? (
            <Icon icon={AlertCircle} size="sm" stroke="emphasis" />
          ) : statusIsSaving || isNewSaving ? (
            <Icon
              icon={Loader2}
              size="sm"
              stroke="emphasis"
              className="animate-spin"
            />
          ) : (
            <Icon icon={Check} size="sm" stroke="emphasis" />
          )}
          {statusText(status, isNew)}
        </span>

        <div className="flex-1" />

        {isNew ? (
          <>
            <Button
              data-testid="snippet-create-cancel"
              variant="ghost"
              size="icon-xs"
              onClick={onCancel}
              className="text-muted-foreground"
              title={i18n.t("newSnippet.cancel")}
              aria-label={i18n.t("newSnippet.cancel")}
            >
              <Icon icon={X} stroke="emphasis" />
            </Button>
            <Button
              data-testid="snippet-create-save"
              variant="default"
              size="xs"
              onClick={onCreate}
              disabled={!canCreate || isCreating}
              className="ml-0.5"
            >
              <Icon icon={Save} size="sm" stroke="emphasis" />
              {isCreating
                ? i18n.t("newSnippet.creating")
                : i18n.t("newSnippet.create")}
            </Button>
            <Separator orientation="vertical" className="h-3.5 mx-0.5" />
            <Button
              variant="destructive"
              size="icon-xs"
              data-testid="snippet-delete"
              disabled
              title={i18n.t("snippetDetail.deleteSnippet")}
              aria-label={i18n.t("snippetDetail.deleteSnippet")}
            >
              <Icon icon={Trash2} stroke="emphasis" />
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              data-testid="snippet-copy"
              onClick={handleCopy}
              className={copied ? "text-green-600" : "text-foreground"}
              title={i18n.t("snippetDetail.copyToClipboard")}
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
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => editorRef.current?.openCommandMenu()}
              className="text-muted-foreground"
              title={i18n.t("snippetDetail.insertCommand")}
              aria-label={i18n.t("snippetDetail.insertCommand")}
            >
              <Icon icon={SquareSlash} stroke="emphasis" />
            </Button>
            <Separator orientation="vertical" className="h-3.5 mx-0.5" />
            <Button
              variant="destructive"
              size="icon-xs"
              data-testid="snippet-delete"
              onClick={() => setShowDeleteDialog(true)}
              disabled={isDeleting}
              title={i18n.t("snippetDetail.deleteSnippet")}
              aria-label={i18n.t("snippetDetail.deleteSnippet")}
            >
              <Icon icon={Trash2} stroke="emphasis" />
            </Button>
          </>
        )}
      </div>

      <InlineError
        message={
          isNew
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
      {isNew && shortcutError && (
        <p role="alert" className="px-3 py-1 text-xs text-destructive">
          {shortcutError}
        </p>
      )}

      {/* Content Area - Always Editable */}
      <div className="flex-1 overflow-auto p-3">
        {isNew && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="space-y-1">
              <label
                htmlFor="label"
                className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {i18n.t("newSnippet.name")}
              </label>
              <Input
                id="label"
                name="label"
                data-testid="snippet-label-input"
                type="text"
                placeholder={i18n.t("newSnippet.namePlaceholder")}
                value={form.label}
                onChange={(e) =>
                  onDraftChange?.({ ...form, label: e.target.value })
                }
                className="h-7 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="shortcut"
                className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {i18n.t("newSnippet.shortcut")}
              </label>
              <Input
                id="shortcut"
                name="shortcut"
                data-testid="snippet-shortcut-input"
                type="text"
                placeholder={i18n.t("newSnippet.shortcutPlaceholder", [
                  form.shortcut.charAt(0) || "/",
                ])}
                value={form.shortcut}
                onChange={(e) => handleShortcutChange(e.target.value)}
                aria-invalid={!!shortcutError}
                className={`h-7 text-xs font-mono ${shortcutError ? "border-destructive" : ""}`}
              />
              <p
                data-testid="snippet-shortcut-tip"
                className="text-[10px] text-muted-foreground"
              >
                {i18n.t("newSnippet.shortcutTip")}
              </p>
            </div>
          </div>
        )}
        <div data-testid={isNew ? "snippet-content-editor" : undefined}>
          <RichTextEditor
            ref={editorRef}
            value={editedContent}
            onChange={(value) => {
              setEditedContent(value);
              if (isNew) onDraftChange?.({ ...form, content: value });
            }}
            placeholder={
              isNew
                ? i18n.t("newSnippet.contentPlaceholder")
                : i18n.t("snippetDetail.editorPlaceholder")
            }
            ariaLabel={isNew ? i18n.t("newSnippet.content") : undefined}
            onCopyError={() =>
              setActionError(i18n.t("snippetDetail.errors.failedToCopy"))
            }
          />
        </div>
        {isNew && (
          <p
            data-testid="snippet-placeholder-tip"
            className="text-[10px] text-muted-foreground mt-1"
          >
            {i18n.t("newSnippet.placeholderTip")}
          </p>
        )}
      </div>

      <Separator />
      <div className="px-2 py-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1 text-muted-foreground mr-1">
            <Icon icon={Tag} size="sm" />
            <span className="text-[10px] font-medium uppercase tracking-wide">
              {i18n.t("snippetDetail.tags")}
            </span>
          </div>
          {editedTags.map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className="text-[10px] px-2 py-0.5 h-5 font-normal border-border text-muted-foreground gap-1 group cursor-default hover:bg-accent transition-colors"
            >
              {tag}
              <button
                onClick={() =>
                  setEditedTags(editedTags.filter((t) => t !== tag))
                }
                className="opacity-50 hover:opacity-100 transition-opacity -mr-0.5"
                title={`Remove "${tag}"`}
                aria-label={`Remove "${tag}"`}
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
                  if (!editedTags.includes(tag)) {
                    setEditedTags([...editedTags, tag]);
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
                  if (!editedTags.includes(tag)) {
                    setEditedTags([...editedTags, tag]);
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
              variant="outline"
              size="sm"
              onClick={() => {
                setIsAddingTag(true);
                setTimeout(() => tagInputRef.current?.focus(), 0);
              }}
              className="h-5 px-2 text-[10px] text-muted-foreground hover:text-foreground border-dashed border-border hover:border-muted-foreground"
              title={i18n.t("snippetDetail.addTagTitle")}
            >
              <Icon icon={Plus} size="sm" className="mr-0.5" />
              {i18n.t("snippetDetail.addTag")}
            </Button>
          )}
        </div>
      </div>

      <Separator />
      <div className="px-3 py-1 flex items-center justify-between text-[10px] text-muted-foreground bg-muted/30">
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{usageCount}</span>
          <span>{i18n.t("snippetDetail.uses")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {isNew ? (
            <span>{i18n.t("newSnippet.footer")}</span>
          ) : (
            <>
              <span>{i18n.t("snippetDetail.updated")}</span>
              <span className="font-medium">
                {getRelativeTime(snippet.updatedAt)}
              </span>
            </>
          )}
        </div>
      </div>

      {!isNew && (
        <ConfirmDialog
          isOpen={showDeleteDialog}
          onClose={() => setShowDeleteDialog(false)}
          onConfirm={handleConfirmDelete}
          title={i18n.t("snippetDetail.deleteDialog.title")}
          message={i18n.t("snippetDetail.deleteDialog.message", [
            snippet.label,
          ])}
          confirmText={i18n.t("snippetDetail.deleteDialog.confirm")}
          cancelText={i18n.t("snippetDetail.deleteDialog.cancel")}
          confirmVariant="danger"
          isLoading={isDeleting}
        />
      )}
    </div>
  );
}
