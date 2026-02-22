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
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { RichTextEditor, type RichTextEditorRef } from "~/components/editor";
import {
  markdownToHtml,
  markdownToPlainText,
} from "~/components/editor/serialization";
import { Separator } from "~/components/ui/separator";
import ConfirmDialog from "~/components/ConfirmDialog";
import { Badge } from "~/components/ui/badge";
import type { Snippet } from "~/types";
import { InlineError } from "~/components/ui/inline-error";
import { getRelativeTime } from "~/utils/dateUtils";
import {
  getSnippetUsageCount,
  incrementSnippetUsage,
} from "~/utils/usageTracking";
import { i18n } from "#i18n";

interface SnippetDetailViewProps {
  snippet: Snippet;
  onDelete: (snippetId: string) => void;
  onUpdate: (updatedSnippet: Snippet) => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export default function SnippetDetailView({
  snippet,
  onDelete,
  onUpdate,
  sidebarOpen = true,
  onToggleSidebar,
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

  useEffect(() => {
    setEditedContent(snippet.content);
    setEditedTags(snippet.tags || []);
    setNewTagInput("");
    setIsAddingTag(false);
    setCopied(false);
    loadUsageCount();
  }, [snippet.id]);

  const loadUsageCount = async () => {
    const count = await getSnippetUsageCount(snippet.id);
    setUsageCount(count);
  };

  const handleCopy = async () => {
    try {
      const plainText = markdownToPlainText(editedContent);
      const html = markdownToHtml(editedContent);

      // Write both plain text and HTML to clipboard for rich paste support
      const clipboardItem = new ClipboardItem({
        "text/plain": new Blob([plainText], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      });
      await navigator.clipboard.write([clipboardItem]);

      setCopied(true);
      setTimeout(() => setCopied(false), 2000);

      // Increment usage count
      const newCount = await incrementSnippetUsage(snippet.id);
      setUsageCount(newCount);
    } catch (err) {
      console.error("Failed to copy:", err);
      setActionError(i18n.t("snippetDetail.toasts.failedToCopy"));
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
      console.error("Error saving snippet:", error);
      setActionError(i18n.t("snippetDetail.toasts.failedToSave"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(snippet.id);
    } catch (error) {
      console.error("Error deleting snippet:", error);
      setActionError(i18n.t("snippetDetail.toasts.failedToDelete"));
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Action Bar */}
      <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-1">
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
            <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.5} />
          ) : (
            <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowDeleteDialog(true)}
          disabled={isDeleting}
          className="h-8 w-8 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50"
          title={i18n.t("snippetDetail.deleteSnippet")}
          aria-label={i18n.t("snippetDetail.deleteSnippet")}
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
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
            <Check className="h-3.5 w-3.5 text-green-600" strokeWidth={1.5} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
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
          <SquareSlash className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        <Separator orientation="vertical" className="h-5 mx-1" />
        {/* Screen-reader live region for save status */}
        <span role="status" aria-live="polite" className="sr-only">
          {isSaved ? i18n.t("snippetDetail.toasts.saved") : ""}
        </span>
        <Button
          variant="default"
          size="sm"
          onClick={handleSave}
          disabled={(!hasChanges && !isSaved) || isSaving}
          className="h-8 text-xs"
        >
          {isSaved ? (
            <>
              <Check
                className="h-3.5 w-3.5 mr-1.5 text-green-300"
                strokeWidth={1.5}
              />
              {i18n.t("snippetDetail.savedLabel")}
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
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
        />
      </div>

      {/* Footer */}
      {/* Tags Section */}
      <Separator />
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1 text-zinc-400 dark:text-zinc-500 mr-1">
            <Tag className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            <span className="text-[10px] font-medium uppercase tracking-wide">
              {i18n.t("snippetDetail.tags")}
            </span>
          </div>
          {editedTags.map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className="text-[10px] px-2 py-0.5 h-5 font-normal border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 gap-1 group cursor-default hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
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
                <X className="h-2.5 w-2.5" strokeWidth={2} />
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
              className="h-5 px-2 text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border-dashed border-zinc-300 dark:border-zinc-600 hover:border-zinc-400 dark:hover:border-zinc-500"
              title={i18n.t("snippetDetail.addTagTitle")}
            >
              <Plus className="h-2.5 w-2.5 mr-0.5" strokeWidth={2} />
              {i18n.t("snippetDetail.addTag")}
            </Button>
          )}
        </div>
      </div>

      {/* Stats Section */}
      <Separator />
      <div className="px-3 py-1.5 flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400 bg-zinc-50/50 dark:bg-zinc-900/30">
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
