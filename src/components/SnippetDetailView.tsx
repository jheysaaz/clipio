import { useState, useEffect, useRef } from "react";
import {
  Copy,
  Check,
  Trash2,
  Save,
  PanelLeftClose,
  PanelLeft,
  Tag,
  X,
  Plus,
  SquareSlash,
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
  getSnippetUsageCount,
  incrementSnippetUsage,
} from "@/storage/usage-tracking";
import { i18n } from "#i18n";
import { captureError } from "@/lib/sentry";
import { copyMarkdownAsRichText } from "@/lib/copy-markdown-as-rich-text";

interface SnippetDetailViewProps {
  snippet: Snippet;
  onDelete: (snippetId: string) => void;
  onUpdate: (updatedSnippet: Snippet) => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onHasChanges?: (hasChanges: boolean) => void;
}

export default function SnippetDetailView({
  snippet,
  onDelete,
  onUpdate,
  sidebarOpen = true,
  onToggleSidebar,
  onHasChanges,
}: SnippetDetailViewProps) {
  const [editedContent, setEditedContent] = useState(snippet.content);
  const [editedTags, setEditedTags] = useState<string[]>(snippet.tags || []);
  const [newTagInput, setNewTagInput] = useState("");
  const [isAddingTag, setIsAddingTag] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextEditorRef>(null);
  const [copied, setCopied] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [usageCount, setUsageCount] = useState(0);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Track if content or tags have changed
  const tagsChanged =
    JSON.stringify(editedTags) !== JSON.stringify(snippet.tags || []);
  const hasChanges = editedContent.trim() !== snippet.content || tagsChanged;

  const snippetIdRef = useRef(snippet.id);

  // Reset the editor when a *different* snippet is selected. Guarded on the id,
  // so a same-id content change (e.g. the parent echoing back a save) does not
  // wipe local edits — and that guard is also why `snippet.content` and
  // `snippet.tags` can safely be dependencies: when only they change, this
  // returns immediately.
  useEffect(() => {
    if (snippetIdRef.current === snippet.id) return;
    snippetIdRef.current = snippet.id;
    setEditedContent(snippet.content);
    setEditedTags(snippet.tags || []);
    setNewTagInput("");
    setIsAddingTag(false);
    setCopied(false);
  }, [snippet.id, snippet.content, snippet.tags]);

  // Usage count is a separate concern keyed on the id alone. It used to share
  // the reset effect above, which meant it refetched whenever the body text
  // changed — an extra storage read per save.
  useEffect(() => {
    getSnippetUsageCount(snippet.id)
      .then(setUsageCount)
      .catch((err) => {
        captureError(err, { action: "loadUsageCount", snippetId: snippet.id });
      });
  }, [snippet.id]);

  // `onHasChanges` is reached through a ref instead of being listed as a
  // dependency. The parent passes an inline arrow, so depending on its identity
  // would fire this on *every* render — and a parent that sets state in
  // response would then loop forever.
  const onHasChangesRef = useRef(onHasChanges);
  useEffect(() => {
    onHasChangesRef.current = onHasChanges;
  }, [onHasChanges]);

  // Notify parent when dirty state changes
  useEffect(() => {
    onHasChangesRef.current?.(hasChanges);
  }, [hasChanges]);

  const handleCopy = async () => {
    try {
      await copyMarkdownAsRichText(editedContent);

      setCopied(true);
      setTimeout(() => setCopied(false), 2000);

      // Increment usage count
      const newCount = await incrementSnippetUsage(snippet.id);
      setUsageCount(newCount);
    } catch (err) {
      captureError(err, { action: "copy.snippet", snippetId: snippet.id });
      setActionError(i18n.t("snippetDetail.errors.failedToCopy"));
    }
  };

  const handleSave = async () => {
    if (!hasChanges) return;

    setIsSaving(true);
    try {
      const updated: Snippet = {
        ...snippet,
        content: editedContent.trim(),
        tags: editedTags,
        updatedAt: new Date().toISOString(),
      };
      await onUpdate(updated);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    } catch (error) {
      if (isWriteRefusal(error)) {
        // An expected refusal with an explanation already worked out — storage
        // over quota, naming the limit. Shown as-is and *not* reported: a user
        // hitting the quota ceiling is not an exception, and filing one on every
        // occurrence buried the signal this report exists to raise.
        //
        // Before this, the store's message was thrown as a bare `Error`, caught
        // here, filed to Sentry as localised user-facing copy, and then replaced
        // with a generic "please try again" — so the limit detail was computed and
        // thrown away in the same breath.
        setActionError(error.userMessage);
      } else {
        console.error("Error saving snippet:", error);
        captureError(error, { action: "saveSnippet", snippetId: snippet.id });
        setActionError(i18n.t("snippetDetail.errors.failedToSave"));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(snippet.id);
    } catch (error) {
      // Same split as the save path: a refusal is an explained outcome, not an
      // exception. See the note there.
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
    <div className="flex flex-col h-full">
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
        <Separator orientation="vertical" className="h-5 mx-1" />
        {/* Screen-reader live region for save status */}
        <span role="status" aria-live="polite" className="sr-only">
          {isSaved ? i18n.t("snippetDetail.status.saved") : ""}
        </span>
        <Button
          variant="default"
          size="sm"
          onClick={handleSave}
          disabled={(!hasChanges && !isSaved) || isSaving}
          className="h-8 text-xs"
          data-testid="snippet-save"
        >
          {isSaved ? (
            <>
              <Icon icon={Check} className="text-green-300 mr-1.5" />
              {i18n.t("snippetDetail.savedLabel")}
            </>
          ) : (
            <>
              <Icon icon={Save} className="mr-1.5" />
              {isSaving
                ? i18n.t("snippetDetail.saving")
                : i18n.t("snippetDetail.save")}
            </>
          )}
        </Button>
      </div>

      {/* Inline error — co-located with action bar, always visible until dismissed */}
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

      {/* The uninstall warning used to render here, between the editor and the
          tags. It repeated on every surface — the detail pane, the snippet
          list footer, and the options page — and it persisted across sessions
          until dismissed, which made a one-time caution feel like a permanent
          alarm. Chrome already asks the user to confirm removal, and the
          export action lives in Library. Removed deliberately; the dismissal
          flag is kept so an existing value stays harmless. */}

      {/* Footer */}
      {/* Tags Section */}
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

      {/* Stats Section */}
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
