import { useCallback } from "react";
import { Bold, Italic, Strikethrough, Underline, Code } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { useFloatingToolbar, useFloatingToolbarState } from "@platejs/floating";
import { useEditorRef, useEditorSelector } from "platejs/react";

export function FloatingToolbar() {
  const editor = useEditorRef();
  const editorId = editor.uid || "plate-editor";
  const focusedEditorId = editorId;

  const floatingState = useFloatingToolbarState({
    editorId,
    focusedEditorId,
    hideToolbar: false,
    showWhenReadOnly: false,
  });

  const { ref, props, hidden } = useFloatingToolbar(floatingState);

  const isBoldActive = useEditorSelector(
    (editor) => editor.api.hasMark("bold"),
    []
  );
  const isItalicActive = useEditorSelector(
    (editor) => editor.api.hasMark("italic"),
    []
  );
  const isUnderlineActive = useEditorSelector(
    (editor) => editor.api.hasMark("underline"),
    []
  );
  const isStrikethroughActive = useEditorSelector(
    (editor) => editor.api.hasMark("strikethrough"),
    []
  );
  const isCodeActive = useEditorSelector(
    (editor) => editor.api.hasMark("code"),
    []
  );

  const handleToggleMark = useCallback(
    (mark: string) => {
      editor.tf.toggleMark(mark);
      editor.tf.focus();
    },
    [editor]
  );

  if (hidden) return null;

  return (
    <div
      ref={ref}
      {...props}
      className={cn(
        "flex items-center gap-0.5 p-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg z-50"
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-7",
          isBoldActive && "bg-zinc-200 dark:bg-zinc-700"
        )}
        onClick={() => handleToggleMark("bold")}
        title="Bold (⌘B)"
        type="button"
      >
        <Bold className="h-3.5 w-3.5" strokeWidth={2} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-7",
          isItalicActive && "bg-zinc-200 dark:bg-zinc-700"
        )}
        onClick={() => handleToggleMark("italic")}
        title="Italic (⌘I)"
        type="button"
      >
        <Italic className="h-3.5 w-3.5" strokeWidth={2} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-7",
          isUnderlineActive && "bg-zinc-200 dark:bg-zinc-700"
        )}
        onClick={() => handleToggleMark("underline")}
        title="Underline (⌘U)"
        type="button"
      >
        <Underline className="h-3.5 w-3.5" strokeWidth={2} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-7",
          isStrikethroughActive && "bg-zinc-200 dark:bg-zinc-700"
        )}
        onClick={() => handleToggleMark("strikethrough")}
        title="Strikethrough (⌘⇧S)"
        type="button"
      >
        <Strikethrough className="h-3.5 w-3.5" strokeWidth={2} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-7",
          isCodeActive && "bg-zinc-200 dark:bg-zinc-700"
        )}
        onClick={() => handleToggleMark("code")}
        title="Code (⌘E)"
        type="button"
      >
        <Code className="h-3.5 w-3.5" strokeWidth={2} />
      </Button>
    </div>
  );
}
