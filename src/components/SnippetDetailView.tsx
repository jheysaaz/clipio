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
import { Separator } from "~/components/ui/separator";
import ConfirmDialog from "~/components/ConfirmDialog";
import { Badge } from "~/components/ui/badge";
import type { Snippet } from "~/types";
import { useToast } from "~/hooks/ToastContext";
import { getRelativeTime } from "~/utils/dateUtils";
import {
  getSnippetUsageCount,
  incrementSnippetUsage,
} from "~/utils/usageTracking";

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
  const { showToast } = useToast();
  const [editedContent, setEditedContent] = useState(snippet.content);
  const [editedTags, setEditedTags] = useState<string[]>(snippet.tags || []);
  const [newTagInput, setNewTagInput] = useState("");
  const [isAddingTag, setIsAddingTag] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextEditorRef>(null);
  const [copied, setCopied] = useState(false);
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
      await navigator.clipboard.writeText(editedContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);

      // Increment usage count
      const newCount = await incrementSnippetUsage(snippet.id);
      setUsageCount(newCount);

      showToast("Copied to clipboard!", "success");
    } catch (err) {
      console.error("Failed to copy:", err);
      showToast("Failed to copy to clipboard", "error");
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
      showToast("Snippet saved!", "success");
    } catch (error) {
      console.error("Error saving snippet:", error);
      showToast("Failed to save snippet. Please try again.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(snippet.id);
      showToast("Snippet deleted!", "success");
    } catch (error) {
      console.error("Error deleting snippet:", error);
      showToast("Failed to delete snippet. Please try again.", "error");
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
          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
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
          title="Delete snippet"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCopy}
          className="h-8 w-8"
          title="Copy to clipboard"
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
          title="Insert command"
        >
          <SquareSlash className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
        <Separator orientation="vertical" className="h-5 mx-1" />
        <Button
          variant="default"
          size="sm"
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className="h-8 text-xs"
        >
          <Save className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </div>

      {/* Content Area - Always Editable */}
      <div className="flex-1 overflow-auto p-4">
        <RichTextEditor
          ref={editorRef}
          value={editedContent}
          onChange={setEditedContent}
          placeholder="Start typing your snippet content here or use '/' for commands..."
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
              Tags
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
              placeholder="Tag name..."
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
              title="Add a new tag"
            >
              <Plus className="h-2.5 w-2.5 mr-0.5" strokeWidth={2} />
              Add tag
            </Button>
          )}
        </div>
      </div>

      {/* Stats Section */}
      <Separator />
      <div className="px-3 py-1.5 flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400 bg-zinc-50/50 dark:bg-zinc-900/30">
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{usageCount}</span>
          <span>uses</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>Updated</span>
          <span className="font-medium">
            {getRelativeTime(snippet.updatedAt)}
          </span>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleConfirmDelete}
        title="Delete Snippet"
        message={`Are you sure you want to delete "${snippet.label}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        confirmVariant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}
