import { stripInlineMarkdownMarks } from "@/lib/markdown";
import { stripMediaPlaceholders } from "@/lib/media-placeholders";
import { decodeHtmlEntities, stripHtmlTags } from "@/lib/html-text";
import { useStore } from "@tanstack/react-store";
import { Button } from "@/components/ui/button";
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
}

export default function SnippetListItem({
  snippet,
  snippetId,
  isSelected,
  onClick,
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
        "w-full justify-start items-start text-left h-auto py-2 px-2.5 rounded-lg transition-colors overflow-hidden relative max-w-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        isSelected
          ? "bg-muted text-foreground border-l-2 border-l-primary"
          : "hover:bg-muted/50 border-l-2 border-l-transparent"
      )}
      onClick={onClick}
    >
      <div className="flex flex-col gap-1 w-0 min-w-full overflow-hidden">
        <div className="flex items-center gap-2 w-full min-w-0 max-w-full overflow-hidden">
          <h3 className="font-medium text-xs text-foreground truncate flex-1 min-w-0">
            {snippet.label}
          </h3>
          <kbd
            className="kbd-badge"
            title={i18n.t("snippetEditor.shortcutLabel", [snippet.shortcut])}
          >
            {snippet.shortcut}
          </kbd>
        </div>
        {contentPreview && (
          <p className="text-[10px] text-muted-foreground leading-relaxed truncate">
            {contentPreview}
          </p>
        )}
      </div>
    </Button>
  );
}
