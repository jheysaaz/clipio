import { useState, useRef, useEffect } from "react";
import { Button } from "~/components/ui/button";
import type { Snippet } from "~/types";
import { cn } from "~/lib/utils";

// Max characters for content preview
const PREVIEW_MAX_LENGTH = 60;

// Strip markdown formatting and get plain text for preview
function stripMarkdown(content: string): string {
  let text = content;
  // Remove markdown formatting
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1"); // bold
  text = text.replace(/_([^_]+)_/g, "$1"); // italic
  text = text.replace(/~~([^~]+)~~/g, "$1"); // strikethrough
  text = text.replace(/`([^`]+)`/g, "$1"); // code
  text = text.replace(/<u>([^<]+)<\/u>/g, "$1"); // underline
  // Convert placeholders to readable text
  text = text.replace(/\{\{clipboard\}\}/g, "{{clipboard}}");
  text = text.replace(/\{\{date:([a-z]+)\}\}/g, "{{today}}");
  text = text.replace(/\{\{cursor\}\}/g, "{{cursor}}");
  text = text.replace(/\{\{datepicker:(\d{4}-\d{2}-\d{2})\}\}/g, "{{date}}");
  // Also handle any legacy HTML tags
  text = text.replace(/<[^>]*>/g, "");
  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  return text;
}

function getContentPreview(content: string): string {
  // Strip markdown formatting, then clean up whitespace
  const stripped = stripMarkdown(content)
    .replace(/[\n\r]+/g, " ")
    .trim();
  if (stripped.length <= PREVIEW_MAX_LENGTH) return stripped;
  return stripped.slice(0, PREVIEW_MAX_LENGTH).trim() + "…";
}

interface SnippetListItemProps {
  snippet: Snippet;
  isSelected: boolean;
  onClick: () => void;
  onUpdate?: (updatedSnippet: Snippet) => void;
}

export default function SnippetListItem({
  snippet,
  isSelected,
  onClick,
  onUpdate,
}: SnippetListItemProps) {
  const [editingField, setEditingField] = useState<"label" | "shortcut" | null>(
    null
  );
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const contentPreview = getContentPreview(snippet.content);

  useEffect(() => {
    if (editingField && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingField]);

  const handleDoubleClickLabel = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditValue(snippet.label);
    setEditingField("label");
  };

  const handleDoubleClickShortcut = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditValue(snippet.shortcut);
    setEditingField("shortcut");
  };

  const handleSave = () => {
    if (editValue.trim() && editingField) {
      const currentValue =
        editingField === "label" ? snippet.label : snippet.shortcut;
      if (editValue.trim() !== currentValue) {
        onUpdate?.({
          ...snippet,
          [editingField]: editValue.trim(),
        });
      }
    }
    setEditingField(null);
    setEditValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditingField(null);
      setEditValue("");
    }
  };

  return (
    <Button
      variant="ghost"
      className={cn(
        "w-full justify-start items-start text-left h-auto py-2 px-2.5 rounded-lg transition-colors overflow-hidden relative max-w-full",
        isSelected
          ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 border-l-2 border-l-zinc-900 dark:border-l-zinc-100"
          : "hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50 border-l-2 border-l-transparent"
      )}
      onClick={onClick}
    >
      <div className="flex flex-col gap-1 w-0 min-w-full overflow-hidden">
        {/* Header row: title + shortcut */}
        <div className="flex items-center gap-2 w-full min-w-0 max-w-full overflow-hidden">
          {editingField === "label" ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              onClick={(e) => e.stopPropagation()}
              className="font-medium text-xs text-zinc-900 dark:text-zinc-100 flex-1 min-w-0 bg-transparent border-none outline-none focus:ring-0 p-0"
            />
          ) : (
            <h3
              className="font-medium text-xs text-zinc-900 dark:text-zinc-100 truncate flex-1 min-w-0 cursor-text"
              onDoubleClick={handleDoubleClickLabel}
            >
              {snippet.label}
            </h3>
          )}
          {editingField === "shortcut" ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-[10px] px-1.5 py-0.5 bg-transparent border border-zinc-300 dark:border-zinc-600 rounded outline-none w-16 text-center shrink-0"
            />
          ) : (
            <kbd
              className="kbd-badge cursor-text"
              onDoubleClick={handleDoubleClickShortcut}
              title={`Shortcut: ${snippet.shortcut}`}
            >
              {snippet.shortcut}
            </kbd>
          )}
        </div>
        {/* Content preview */}
        {contentPreview && (
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-relaxed truncate">
            {contentPreview}
          </p>
        )}
      </div>
    </Button>
  );
}
