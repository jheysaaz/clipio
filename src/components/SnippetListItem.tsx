import { stripInlineMarkdownMarks } from "@/lib/markdown";
import { stripMediaPlaceholders } from "@/lib/media-placeholders";
import { decodeHtmlEntities, stripHtmlTags } from "@/lib/html-text";
import { useStore } from "@tanstack/react-store";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { Snippet } from "@/types";
import { cn } from "@/lib/utils";
import { draftPreviewsStore } from "@/store/write-queue";
import { i18n } from "#i18n";

// Max characters for content preview
const PREVIEW_MAX_LENGTH = 60;

// Strip markdown formatting and get plain text for preview
function stripMarkdown(content: string): string {
  let text = content;
  // Remove markdown formatting via the canonical implementation; the sidebar
  // preview's only local decisions are placeholder wording and legacy HTML.
  text = stripInlineMarkdownMarks(text);
  text = text.replace(/\{\{date:([a-z]+)\}\}/g, "{{today}}");
  text = text.replace(/\{\{datepicker:(\d{4}-\d{2}-\d{2})\}\}/g, "{{date}}");
  text = stripMediaPlaceholders(text);
  text = stripHtmlTags(text);
  text = decodeHtmlEntities(text);
  return text;
}

export function getContentPreview(content: string): string {
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
  /** Row sizing is owned by the virtual list; callers pass a fixed height. */
  className?: string;
}

export default function SnippetListItem({
  snippet,
  snippetId,
  isSelected,
  onClick,
  className,
}: SnippetListItemProps) {
  const liveFields = useStore(draftPreviewsStore)[snippet.id];

  // The authoritative record is intentionally not overwritten by our own
  // commits, so reading only `snippet.content` froze the preview at the value the
  // popup loaded. The staged draft is what the user is looking at right now.
  const contentPreview = getContentPreview(
    liveFields?.content ?? snippet.content
  );

  return (
    <Button
      id={snippetId}
      data-testid="snippet-list-item"
      variant="ghost"
      role="option"
      aria-selected={isSelected}
      className={cn(
        "h-auto min-h-12 max-w-full w-full items-start justify-start overflow-hidden relative rounded-lg px-2.5 py-2 text-left transition-colors",
        className,
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        // One fill, stronger than hover; no accent bar, ring or second marker.
        // The ghost variant's hover fill would otherwise repaint a selected
        // row, making it weaker than both its resting state and its neighbours.
        isSelected
          ? "bg-selected text-foreground hover:bg-selected dark:hover:bg-selected"
          : "text-foreground hover:bg-muted/50"
      )}
      onClick={onClick}
    >
      <div className="flex flex-col gap-1 w-0 min-w-full overflow-hidden">
        <div className="flex items-center gap-2 w-full min-w-0 max-w-full overflow-hidden">
          <h3
            className={cn(
              "min-w-0 flex-1 truncate text-ui-sm! text-foreground",
              isSelected ? "font-semibold" : "font-medium"
            )}
          >
            {snippet.label}
          </h3>
          <Kbd
            className="pointer-events-auto h-auto max-w-20 shrink-0 truncate rounded-sm border border-border bg-secondary px-1.5 py-0.75 font-mono text-ui-xs! leading-none shadow-xs [font-variant-ligatures:none]"
            title={i18n.t("snippetEditor.shortcutLabel", [snippet.shortcut])}
          >
            {snippet.shortcut}
          </Kbd>
        </div>
        {contentPreview && (
          <p className="truncate text-ui-xs! font-normal leading-snug text-muted-foreground">
            {contentPreview}
          </p>
        )}
      </div>
    </Button>
  );
}
