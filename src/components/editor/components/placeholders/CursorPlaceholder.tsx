import { useCallback } from "react";
import { MousePointer2 } from "lucide-react";
import { cn } from "~/lib/utils";
import { useEditorRef } from "platejs/react";

interface CursorPlaceholderElementProps {
  children: React.ReactNode;
  attributes: Record<string, unknown>;
}

export function CursorPlaceholderElement({
  children,
  attributes,
}: CursorPlaceholderElementProps) {
  const editor = useEditorRef();

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      editor.tf.focus();
    },
    [editor]
  );

  return (
    <span
      {...attributes}
      contentEditable={false}
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded cursor-pointer select-none align-baseline mx-0.5",
        "font-mono text-[10px] leading-none",
        "bg-muted border border-border",
        "shadow-[0_1px_0_1px_var(--secondary),0_2px_3px_rgba(0,0,0,0.05)]",
        "text-muted-foreground",
        "dark:shadow-[0_1px_0_1px_rgba(0,0,0,0.3),0_2px_3px_rgba(0,0,0,0.2)]",
        "hover:bg-accent",
        "transition-colors duration-150"
      )}
      title="Cursor position - cursor will be placed here after insertion"
    >
      <MousePointer2 className="h-2.5 w-2.5" strokeWidth={2.5} />
      <span>cursor</span>
      <span className="hidden">{children}</span>
    </span>
  );
}
