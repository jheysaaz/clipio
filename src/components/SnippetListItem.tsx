import { useState, useRef, useEffect } from "react";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import type { Snippet } from "~/types";
import { cn } from "~/lib/utils";

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
        "w-full justify-start items-center text-left h-auto py-2 px-2.5 rounded-lg transition-colors overflow-hidden",
        isSelected
          ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50"
          : "hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50"
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 w-full min-w-0 overflow-hidden">
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
            className="font-mono text-xs px-1.5 py-0 bg-transparent border border-zinc-200 dark:border-zinc-700 rounded outline-none w-16 text-center shrink-0"
          />
        ) : (
          <Badge
            variant="outline"
            className="font-mono text-xs px-1.5 py-0 cursor-text max-w-18 truncate shrink-0"
            onDoubleClick={handleDoubleClickShortcut}
          >
            {snippet.shortcut}
          </Badge>
        )}
      </div>
    </Button>
  );
}
