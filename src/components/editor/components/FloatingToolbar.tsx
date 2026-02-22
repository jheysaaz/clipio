import { useCallback, useState, useRef, useEffect } from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  Underline,
  Code,
  Link,
  Unlink,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { useFloatingToolbar, useFloatingToolbarState } from "@platejs/floating";
import { useEditorRef, useEditorSelector } from "platejs/react";
import type { TElement } from "platejs";
import { LINK_ELEMENT } from "../types";
import { i18n } from "#i18n";

export function FloatingToolbar() {
  const editor = useEditorRef();
  const editorId = editor.uid || "plate-editor";
  const focusedEditorId = editorId;

  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const linkInputRef = useRef<HTMLInputElement>(null);

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

  // Check if the current selection is inside a link
  const isLinkActive = useEditorSelector((editor) => {
    const { selection } = editor;
    if (!selection) return false;
    try {
      const [linkEntry] = editor.api.nodes<TElement>({
        match: { type: LINK_ELEMENT },
      });
      return !!linkEntry;
    } catch {
      return false;
    }
  }, []);

  const handleToggleMark = useCallback(
    (mark: string) => {
      editor.tf.toggleMark(mark);
      editor.tf.focus();
    },
    [editor]
  );

  // Focus link input when shown
  useEffect(() => {
    if (showLinkInput) {
      setTimeout(() => linkInputRef.current?.focus(), 0);
    }
  }, [showLinkInput]);

  const handleInsertLink = useCallback(() => {
    if (isLinkActive) {
      // Unwrap existing link
      editor.tf.unwrapNodes({ match: { type: LINK_ELEMENT } });
      editor.tf.focus();
      return;
    }
    setShowLinkInput(true);
    setLinkUrl("");
  }, [editor, isLinkActive]);

  const handleConfirmLink = useCallback(() => {
    const url = linkUrl.trim();
    if (!url) {
      setShowLinkInput(false);
      editor.tf.focus();
      return;
    }

    // Sanitize URL: only allow http, https, mailto
    let sanitizedUrl = url;
    if (!/^(https?:\/\/|mailto:)/i.test(sanitizedUrl)) {
      sanitizedUrl = `https://${sanitizedUrl}`;
    }

    // Check if selection is collapsed (no text selected)
    const { selection } = editor;
    if (
      selection &&
      selection.anchor.offset === selection.focus.offset &&
      selection.anchor.path.join(",") === selection.focus.path.join(",")
    ) {
      // No selection — insert a new link node with the URL as label
      editor.tf.insertNodes({
        type: LINK_ELEMENT,
        url: sanitizedUrl,
        children: [{ text: sanitizedUrl }],
      } as TElement & { url: string });
    } else {
      // Wrap selected text in a link
      editor.tf.wrapNodes(
        {
          type: LINK_ELEMENT,
          url: sanitizedUrl,
          children: [],
        } as TElement & { url: string },
        { split: true }
      );
    }

    setShowLinkInput(false);
    setLinkUrl("");
    editor.tf.focus();
  }, [editor, linkUrl]);

  const handleLinkKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleConfirmLink();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowLinkInput(false);
        editor.tf.focus();
      }
    },
    [handleConfirmLink, editor]
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
      {showLinkInput ? (
        <div className="flex items-center gap-1 px-1">
          <input
            ref={linkInputRef}
            type="text"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={handleLinkKeyDown}
            onBlur={() => {
              // Delay to allow click on confirm to fire
              setTimeout(() => {
                setShowLinkInput(false);
              }, 150);
            }}
            placeholder={i18n.t("editor.toolbar.urlPlaceholder")}
            className="h-6 w-40 text-xs px-1.5 bg-transparent border border-zinc-300 dark:border-zinc-600 rounded outline-none focus:border-indigo-500 dark:focus:border-indigo-400 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleConfirmLink}
            title={i18n.t("editor.toolbar.confirmLink")}
            type="button"
          >
            <Link
              className="h-3 w-3 text-indigo-600 dark:text-indigo-400"
              strokeWidth={2}
            />
          </Button>
        </div>
      ) : (
        <>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7",
              isBoldActive && "bg-zinc-200 dark:bg-zinc-700"
            )}
            onClick={() => handleToggleMark("bold")}
            title={i18n.t("editor.toolbar.bold")}
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
            title={i18n.t("editor.toolbar.italic")}
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
            title={i18n.t("editor.toolbar.underline")}
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
            title={i18n.t("editor.toolbar.strikethrough")}
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
            title={i18n.t("editor.toolbar.code")}
            type="button"
          >
            <Code className="h-3.5 w-3.5" strokeWidth={2} />
          </Button>
          <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7",
              isLinkActive && "bg-zinc-200 dark:bg-zinc-700"
            )}
            onClick={handleInsertLink}
            title={
              isLinkActive
                ? i18n.t("editor.toolbar.removeLink")
                : i18n.t("editor.toolbar.insertLink")
            }
            type="button"
          >
            {isLinkActive ? (
              <Unlink className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <Link className="h-3.5 w-3.5" strokeWidth={2} />
            )}
          </Button>
        </>
      )}
    </div>
  );
}
