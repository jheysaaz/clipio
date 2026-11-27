import { useCallback, useState, useRef, useEffect } from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  Underline,
  Code,
  Link,
  Unlink,
  ImageIcon,
  Film,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SiteFavicon } from "@/components/options/SiteFavicon";
import { normalizeEditorLinkUrl } from "@/lib/editor-link";
import { cn } from "@/lib/utils";
import { useFloatingToolbar, useFloatingToolbarState } from "@platejs/floating";
import { useEditorRef, useEditorSelector } from "platejs/react";
import type { TElement } from "platejs";
import { LINK_ELEMENT } from "./types";
import { i18n } from "#i18n";

interface FloatingToolbarProps {
  onInsertImage?: () => void;
  onInsertGif?: () => void;
}

export function FloatingToolbar({
  onInsertImage,
  onInsertGif,
}: FloatingToolbarProps) {
  const editor = useEditorRef();
  const editorId = editor.uid || "plate-editor";
  const focusedEditorId = editorId;

  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const linkInputRef = useRef<HTMLInputElement>(null);

  const floatingState = useFloatingToolbarState({
    editorId,
    focusedEditorId,
    hideToolbar: false,
    showWhenReadOnly: false,
    floatingOptions: {
      strategy: "fixed",
    },
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

  const cancelLinkForm = useCallback(() => {
    setShowLinkInput(false);
    setLinkUrl("");
    setLinkLabel("");
    editor.tf.focus();
  }, [editor]);

  const handleInsertLink = useCallback(() => {
    if (isLinkActive) {
      // Unwrap existing link
      editor.tf.unwrapNodes({ match: { type: LINK_ELEMENT } });
      editor.tf.focus();
      return;
    }
    setShowLinkInput(true);
    setLinkUrl("");
    setLinkLabel("");
  }, [editor, isLinkActive]);

  const handleConfirmLink = useCallback(() => {
    const sanitizedUrl = normalizeEditorLinkUrl(linkUrl);
    if (!sanitizedUrl) {
      cancelLinkForm();
      return;
    }

    const label = linkLabel.trim();

    const { selection } = editor;
    const collapsed =
      !!selection &&
      selection.anchor.offset === selection.focus.offset &&
      selection.anchor.path.join(",") === selection.focus.path.join(",");

    if (label) {
      // The label input is authoritative: selecting text and typing a label
      // replaces that text, rather than wrapping it with its original casing.
      editor.tf.insertNodes(
        {
          type: LINK_ELEMENT,
          url: sanitizedUrl,
          children: [{ text: label }],
        } as TElement & { url: string },
        { at: selection ?? undefined }
      );
    } else if (collapsed) {
      editor.tf.insertNodes({
        type: LINK_ELEMENT,
        url: sanitizedUrl,
        children: [{ text: sanitizedUrl }],
      } as TElement & { url: string });
    } else {
      // No label — keep the selected text as the link's visible text.
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
    setLinkLabel("");
    editor.tf.focus();
  }, [cancelLinkForm, editor, linkLabel, linkUrl]);

  const handleLinkKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleConfirmLink();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelLinkForm();
      }
    },
    [cancelLinkForm, handleConfirmLink]
  );

  if (hidden) return null;

  return (
    <div
      ref={ref}
      {...props}
      role="toolbar"
      aria-label={i18n.t("editor.toolbar.label")}
      className={cn(
        "flex items-center gap-0.5 p-1 rounded-lg border border-border bg-popover shadow-lg z-50"
      )}
    >
      {showLinkInput ? (
        <div className="flex items-center gap-1 px-1" data-testid="link-form">
          {linkUrl.trim() ? (
            <span
              data-testid="link-favicon-preview"
              className="inline-flex shrink-0 items-center"
              title={linkUrl.trim()}
            >
              <SiteFavicon hostname={linkUrl} className="size-4" />
            </span>
          ) : null}
          <Input
            ref={linkInputRef}
            type="text"
            data-testid="link-url-input"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={handleLinkKeyDown}
            placeholder={i18n.t("editor.toolbar.urlPlaceholder")}
            className="h-6 w-36 min-w-0 rounded border border-border bg-transparent px-1.5 py-0 text-xs outline-none focus:border-indigo-500 focus-visible:border-indigo-500 focus-visible:ring-0 md:text-xs dark:bg-transparent dark:focus:border-indigo-400 dark:focus-visible:border-indigo-400 text-foreground placeholder:text-muted-foreground"
          />
          <Input
            type="text"
            data-testid="link-label-input"
            value={linkLabel}
            onChange={(e) => setLinkLabel(e.target.value)}
            onKeyDown={handleLinkKeyDown}
            placeholder={i18n.t("editor.toolbar.textPlaceholder")}
            className="h-6 w-24 min-w-0 rounded border border-border bg-transparent px-1.5 py-0 text-xs outline-none focus:border-indigo-500 focus-visible:border-indigo-500 focus-visible:ring-0 md:text-xs dark:bg-transparent dark:focus:border-indigo-400 dark:focus-visible:border-indigo-400 text-foreground placeholder:text-muted-foreground"
          />
          <Button
            data-testid="link-confirm"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleConfirmLink}
            title={i18n.t("editor.toolbar.confirmLink")}
            aria-label={i18n.t("editor.toolbar.confirmLink")}
            type="button"
          >
            <Icon
              icon={Link}
              size="sm"
              stroke="emphasis"
              className="text-indigo-600 dark:text-indigo-400"
            />
          </Button>
          <Button
            data-testid="link-cancel"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={cancelLinkForm}
            title={i18n.t("common.cancel")}
            aria-label={i18n.t("common.cancel")}
            type="button"
          >
            <Icon icon={X} size="sm" stroke="emphasis" />
          </Button>
        </div>
      ) : (
        <>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-7 w-7", isBoldActive && "bg-accent")}
            onClick={() => handleToggleMark("bold")}
            title={i18n.t("editor.toolbar.bold")}
            aria-label={i18n.t("editor.toolbar.bold")}
            aria-pressed={isBoldActive}
            type="button"
          >
            <Icon icon={Bold} stroke="emphasis" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-7 w-7", isItalicActive && "bg-accent")}
            onClick={() => handleToggleMark("italic")}
            title={i18n.t("editor.toolbar.italic")}
            aria-label={i18n.t("editor.toolbar.italic")}
            aria-pressed={isItalicActive}
            type="button"
          >
            <Icon icon={Italic} stroke="emphasis" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-7 w-7", isUnderlineActive && "bg-accent")}
            onClick={() => handleToggleMark("underline")}
            title={i18n.t("editor.toolbar.underline")}
            aria-label={i18n.t("editor.toolbar.underline")}
            aria-pressed={isUnderlineActive}
            type="button"
          >
            <Icon icon={Underline} stroke="emphasis" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-7 w-7", isStrikethroughActive && "bg-accent")}
            onClick={() => handleToggleMark("strikethrough")}
            title={i18n.t("editor.toolbar.strikethrough")}
            aria-label={i18n.t("editor.toolbar.strikethrough")}
            aria-pressed={isStrikethroughActive}
            type="button"
          >
            <Icon icon={Strikethrough} stroke="emphasis" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-7 w-7", isCodeActive && "bg-accent")}
            onClick={() => handleToggleMark("code")}
            title={i18n.t("editor.toolbar.code")}
            aria-label={i18n.t("editor.toolbar.code")}
            aria-pressed={isCodeActive}
            type="button"
          >
            <Icon icon={Code} stroke="emphasis" />
          </Button>
          <Separator orientation="vertical" className="mx-0.5 h-4" />
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-7 w-7", isLinkActive && "bg-accent")}
            onClick={handleInsertLink}
            title={
              isLinkActive
                ? i18n.t("editor.toolbar.removeLink")
                : i18n.t("editor.toolbar.insertLink")
            }
            aria-label={
              isLinkActive
                ? i18n.t("editor.toolbar.removeLink")
                : i18n.t("editor.toolbar.insertLink")
            }
            aria-pressed={isLinkActive}
            type="button"
          >
            {isLinkActive ? (
              <Icon icon={Unlink} stroke="emphasis" />
            ) : (
              <Icon icon={Link} stroke="emphasis" />
            )}
          </Button>
          {(onInsertImage || onInsertGif) && (
            <Separator orientation="vertical" className="mx-0.5 h-4" />
          )}
          {onInsertImage && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onInsertImage}
              title={i18n.t("editor.toolbar.insertImage")}
              aria-label={i18n.t("editor.toolbar.insertImage")}
              type="button"
            >
              <Icon icon={ImageIcon} stroke="emphasis" />
            </Button>
          )}
          {onInsertGif && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onInsertGif}
              title={i18n.t("editor.toolbar.insertGif")}
              aria-label={i18n.t("editor.toolbar.insertGif")}
              type="button"
            >
              <Icon icon={Film} stroke="emphasis" />
            </Button>
          )}
        </>
      )}
    </div>
  );
}
