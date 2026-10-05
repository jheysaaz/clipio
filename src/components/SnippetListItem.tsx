import { stripInlineMarkdownMarks } from "@/lib/markdown";
import { stripMediaPlaceholders } from "@/lib/media-placeholders";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import type { Snippet } from "@/types";
import { cn } from "@/lib/utils";
import { TIMING } from "@/config/constants";
import { isWriteRefusal } from "@/store/snippets";
import { captureError } from "@/lib/sentry";
import { i18n } from "#i18n";
import { toast } from "sonner";

// Max characters for content preview
const PREVIEW_MAX_LENGTH = 60;

// Strip markdown formatting and get plain text for preview
function stripMarkdown(content: string): string {
  let text = content;
  // Remove markdown formatting, via the canonical implementation.
  //
  // The five regexes that used to be copied here included the pre-fix italic
  // rule, so a snippet reading `first_name and last_name` lost both
  // underscores in the sidebar preview. The placeholder mapping, legacy-HTML
  // strip and entity decode below stay local, because they are this surface's
  // decisions rather than markdown mechanics — notably `{{date:…}}` becomes
  // "{{today}}" here, and a link keeps its label rather than becoming its URL.
  text = stripInlineMarkdownMarks(text);
  // Convert placeholders to readable text
  text = text.replace(/\{\{clipboard\}\}/g, "{{clipboard}}");
  text = text.replace(/\{\{date:([a-z]+)\}\}/g, "{{today}}");
  text = text.replace(/\{\{cursor\}\}/g, "{{cursor}}");
  text = text.replace(/\{\{datepicker:(\d{4}-\d{2}-\d{2})\}\}/g, "{{date}}");
  // Via the shared parser, which understands the optional width suffix. The
  // hand-typed regexes here did not, so a resized image — written as
  // `{{image:<id>:200}}` the moment the user drags it — was left in place and
  // the raw placeholder was displayed next to the snippet label.
  text = stripMediaPlaceholders(text);
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

export function getContentPreview(content: string): string {
  // Strip markdown formatting, then clean up whitespace
  const stripped = stripMarkdown(content)
    .replace(/[\n\r]+/g, " ")
    .trim();
  if (stripped.length <= PREVIEW_MAX_LENGTH) return stripped;
  return stripped.slice(0, PREVIEW_MAX_LENGTH).trim() + "…";
}

interface SnippetListItemProps {
  snippet: Snippet;
  snippetId: string;
  isSelected: boolean;
  onClick: () => void;
  onUpdate?: (updatedSnippet: Snippet) => void;
}

export default function SnippetListItem({
  snippet,
  snippetId,
  isSelected,
  onClick,
  onUpdate,
}: SnippetListItemProps) {
  const [editingField, setEditingField] = useState<"label" | "shortcut" | null>(
    null
  );
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Timer for deferring the row's onClick so a double-click can cancel it.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const contentPreview = getContentPreview(snippet.content);

  useEffect(() => {
    if (editingField && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingField]);

  // NOTE: the e.stopPropagation() here does NOT stop the row's onClick from
  // firing. A double-click emits click, click, dblclick — the two clicks reach
  // the row before this handler ever runs. Since Dashboard's selection handler
  // is not idempotent (it consults `detailHasChanges` and can open the
  // unsaved-changes guard), double-clicking a label to rename it also selects
  // the snippet twice.
  //
  // Fixed on the row below by ignoring clicks that turn out to be the first
  // click of a double-click, rather than here.
  /**
   * Defer the row's onClick by one double-click interval.
   *
   * A double-click emits click, click, dblclick — so by the time the
   * dblclick handler runs, the row has already handled two clicks. Propagate
   * alone cannot prevent that, because propagation has already happened.
   *
   * Holding the click briefly and cancelling it if a dblclick arrives means a
   * double-click to edit does not also select the snippet. That matters because
   * selection is not idempotent: Dashboard consults `detailHasChanges` and can
   * route through the unsaved-changes guard, so a stray selection could raise
   * the confirm dialog about work the user was in the middle of.
   */
  const handleRowClick = () => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      onClick();
    }, TIMING.DOUBLE_CLICK_MS);
  };

  /** Cancel a pending row click because this became a double-click. */
  const cancelPendingRowClick = () => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
  };

  // Clean up a pending timer if the row unmounts mid-defer.
  useEffect(
    () => () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
    },
    []
  );

  const handleDoubleClickLabel = (e: React.MouseEvent) => {
    cancelPendingRowClick();
    e.preventDefault();
    e.stopPropagation();
    setEditValue(snippet.label);
    setEditingField("label");
  };

  const handleDoubleClickShortcut = (e: React.MouseEvent) => {
    cancelPendingRowClick();
    e.preventDefault();
    e.stopPropagation();
    setEditValue(snippet.shortcut);
    setEditingField("shortcut");
  };

  /**
   * Commit an inline rename.
   *
   * The edit closes immediately and the promise is caught, deliberately and
   * separately. `onUpdate` is the whole write — it talks to storage — and this
   * used to fire and forget it, so a rejection became an unhandled promise: the
   * input closed, the old name stayed in the list, and there was no toast, no
   * banner and no report. The user renamed a snippet and it silently did not
   * rename.
   *
   * The field is not reopened on failure. The store still holds the old value —
   * a rejected write never reached it — so the row is already showing the truth,
   * and reopening the input over it would invite the user to retype a change that
   * was never applied. The toast says what happened instead.
   */
  const handleSave = () => {
    if (editValue.trim() && editingField) {
      const currentValue =
        editingField === "label" ? snippet.label : snippet.shortcut;
      if (editValue.trim() !== currentValue) {
        void Promise.resolve(
          onUpdate?.({ ...snippet, [editingField]: editValue.trim() })
        ).catch((error: unknown) => {
          if (isWriteRefusal(error)) {
            toast.error(error.userMessage);
            return;
          }
          console.error("Error renaming snippet:", error);
          captureError(error, {
            action: "renameSnippet",
            snippetId: snippet.id,
          });
          toast.error(i18n.t("snippetDetail.errors.failedToSave"));
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
      id={snippetId}
      data-testid="snippet-list-item"
      variant="ghost"
      role="option"
      aria-selected={isSelected}
      className={cn(
        "w-full justify-start items-start text-left h-auto py-2 px-2.5 rounded-lg transition-colors overflow-hidden relative max-w-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        isSelected
          ? "bg-muted text-foreground border-l-2 border-l-primary"
          : "hover:bg-muted/50 border-l-2 border-l-transparent"
      )}
      onClick={handleRowClick}
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
              className="font-medium text-xs text-foreground flex-1 min-w-0 bg-transparent border-none outline-none focus:ring-0 p-0"
            />
          ) : (
            <h3
              className="font-medium text-xs text-foreground truncate flex-1 min-w-0 cursor-text"
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
              className="font-mono text-[10px] px-1.5 py-0.5 bg-transparent border border-border rounded outline-none w-16 text-center shrink-0"
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
          <p className="text-[10px] text-muted-foreground leading-relaxed truncate">
            {contentPreview}
          </p>
        )}
      </div>
    </Button>
  );
}
