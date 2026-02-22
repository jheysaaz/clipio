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
        "bg-zinc-100 border border-zinc-300",
        "shadow-[0_1px_0_1px_#f4f4f5,0_2px_3px_rgba(0,0,0,0.05)]",
        "text-zinc-700",
        "dark:bg-zinc-800 dark:border-zinc-600",
        "dark:shadow-[0_1px_0_1px_rgba(0,0,0,0.3),0_2px_3px_rgba(0,0,0,0.2)]",
        "dark:text-zinc-300",
        "hover:bg-zinc-200 dark:hover:bg-zinc-700",
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
