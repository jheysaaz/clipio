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
} from "lucide-react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor, type RichTextEditorRef } from "@/components/editor";
import { Separator } from "@/components/ui/separator";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import type { Snippet } from "@/types";
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
  onDelete: (snippetId: string) => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  /** Shown by the dashboard after a successful delete, so it can be undone. */
  onUndoDelete?: (snippet: Snippet) => void;
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
function statusText(status: SyncStatus): string {
  if (status.refused > 0) return i18n.t("snippetDetail.syncStatus.refused");
  if (status.failed > 0) return i18n.t("snippetDetail.syncStatus.failed");
  if (status.pending > 0) return i18n.t("snippetDetail.syncStatus.pending");
  return i18n.t("snippetDetail.syncStatus.saved");
}

export default function SnippetDetailView({
  snippet,
  onDelete,
  sidebarOpen = true,
  onToggleSidebar,
  onUndoDelete,
}: SnippetDetailViewProps) {
  const [editedContent, setEditedContent] = useState(snippet.content);
  const [editedTags, setEditedTags] = useState<string[]>(snippet.tags || []);
  const [newTagInput, setNewTagInput] = useState("");
  const [isAddingTag, setIsAddingTag] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextEditorRef>(null);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [usageCount, setUsageCount] = useState(0);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const status = useStore(writeQueueStore);
  const undoState = useStore(undoAvailabilityStore);
  const controlsForThisSnippet = undoState.snippetId === snippet.id;
  const canUndo = controlsForThisSnippet && undoState.canUndo;
  const canRedo = controlsForThisSnippet && undoState.canRedo;

  const snippetRef = useRef(snippet);
  const fieldsRef = useRef<EditorFields>(fieldsFromSnippet(snippet));
  const changedRef = useRef(false);
  const loadedIdRef = useRef<string | null>(null);

  const currentFields = useMemo<EditorFields>(
    () => ({
      label: snippet.label,
      shortcut: snippet.shortcut,
      content: editedContent,
      tags: editedTags,
    }),
    [snippet.label, snippet.shortcut, editedContent, editedTags]
  );

  const hasChanges =
    currentFields.content !== snippet.content ||
    JSON.stringify(currentFields.tags) !== JSON.stringify(snippet.tags || []);

  useEffect(() => {
    snippetRef.current = snippet;
    fieldsRef.current = currentFields;
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

  /** Reset only when a different snippet is selected, never on a same-id echo. */
  useEffect(() => {
    if (loadedIdRef.current === snippet.id) return;
    loadedIdRef.current = snippet.id;
    autosave.discard();
    setEditedContent(snippet.content);
    setEditedTags(snippet.tags || []);
    setNewTagInput("");
    setIsAddingTag(false);
    setCopied(false);
    setActionError(null);
    void refreshUndoAvailability(snippet.id);
    void refreshSyncStatus();
    // Deliberately keyed on identity only: a same-id echo from our own write
    // must not reset fields the user is still typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snippet.id, autosave]);

  useEffect(() => {
    getSnippetUsageCount(snippet.id)
      .then(setUsageCount)
      .catch((err) => {
        captureError(err, { action: "loadUsageCount", snippetId: snippet.id });
      });
  }, [snippet.id]);

  useEffect(() => {
    if (!hasChanges) {
      autosave.discard();
      return;
    }
    autosave.schedule(currentFields);
  }, [autosave, currentFields, hasChanges]);

  /** Leave the tag input means the tag was committed: flush immediately. */
  useEffect(() => {
    if (isAddingTag) return;
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
  }, [isAddingTag, autosave]);

  const flushChanges = async (): Promise<AutosaveOutcome | null> => {
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
    if (!(event.metaKey || event.ctrlKey)) return;
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

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
      {/* Action Bar */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSidebar}
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
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          data-testid="snippet-undo"
          onClick={() => void step("undo")}
          disabled={!canUndo}
          className="h-8 w-8"
          title={i18n.t("snippetDetail.undo")}
          aria-label={i18n.t("snippetDetail.undo")}
        >
          <Icon icon={Undo2} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-testid="snippet-redo"
          onClick={() => void step("redo")}
          disabled={!canRedo}
          className="h-8 w-8"
          title={i18n.t("snippetDetail.redo")}
          aria-label={i18n.t("snippetDetail.redo")}
        >
          <Icon icon={Redo2} />
        </Button>
        <span
          data-testid="snippet-sync-status"
          role="status"
          aria-live="polite"
          className={`text-[10px] px-2 ${
            status.refused > 0 || status.failed > 0
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
        >
          {statusText(status)}
        </span>
        <Separator orientation="vertical" className="h-5 mx-1" />
        <Button
          variant="ghost"
          size="icon"
          data-testid="snippet-delete"
          onClick={() => setShowDeleteDialog(true)}
          disabled={isDeleting}
          className="h-8 w-8 hover:text-destructive hover:bg-destructive/10"
          title={i18n.t("snippetDetail.deleteSnippet")}
          aria-label={i18n.t("snippetDetail.deleteSnippet")}
        >
          <Icon icon={Trash2} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-testid="snippet-copy"
          onClick={handleCopy}
          className="h-8 w-8"
          title={i18n.t("snippetDetail.copyToClipboard")}
          aria-label={
            copied
              ? i18n.t("snippetDetail.copiedLabel")
              : i18n.t("snippetDetail.copyToClipboard")
          }
          aria-pressed={copied}
        >
          {copied ? (
            <Icon icon={Check} className="text-green-600" />
          ) : (
            <Icon icon={Copy} />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => editorRef.current?.openCommandMenu()}
          className="h-8 w-8"
          title={i18n.t("snippetDetail.insertCommand")}
          aria-label={i18n.t("snippetDetail.insertCommand")}
        >
          <Icon icon={SquareSlash} />
        </Button>
      </div>

      <InlineError
        message={actionError}
        onDismiss={() => setActionError(null)}
      />

      {/* Content Area - Always Editable */}
      <div className="flex-1 overflow-auto p-4">
        <RichTextEditor
          ref={editorRef}
          value={editedContent}
          onChange={setEditedContent}
          placeholder={i18n.t("snippetDetail.editorPlaceholder")}
          onCopyError={() =>
            setActionError(i18n.t("snippetDetail.errors.failedToCopy"))
          }
        />
      </div>

      <Separator />
      <div className="px-3 py-2.5">
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
      <div className="px-3 py-1.5 flex items-center justify-between text-[10px] text-muted-foreground bg-muted/30">
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{usageCount}</span>
          <span>{i18n.t("snippetDetail.uses")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>{i18n.t("snippetDetail.updated")}</span>
          <span className="font-medium">
            {getRelativeTime(snippet.updatedAt)}
          </span>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleConfirmDelete}
        title={i18n.t("snippetDetail.deleteDialog.title")}
        message={i18n.t("snippetDetail.deleteDialog.message", [snippet.label])}
        confirmText={i18n.t("snippetDetail.deleteDialog.confirm")}
        cancelText={i18n.t("snippetDetail.deleteDialog.cancel")}
        confirmVariant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}
