import {
  useEffect,
  useMemo,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from "react";
import { cn } from "@/lib/utils";
import {
  createPlateEditor,
  ParagraphPlugin,
  Plate,
  PlateContent,
} from "platejs/react";
import {
  editorSelectionStore,
  setSlashQuery,
  stashSlashContextForPicker,
  takePendingSlashContext,
  useEditorSelection,
  useOverlayFlag,
  type EditorRange,
} from "@/store/editor-selection";
import { editorMediaStore, useEditorMedia } from "@/store/editor-media";
import {
  BoldPlugin,
  ItalicPlugin,
  UnderlinePlugin,
  StrikethroughPlugin,
  CodePlugin,
} from "@platejs/basic-nodes/react";
import type { TText, TElement, Descendant } from "platejs";

import {
  CLIPBOARD_PLACEHOLDER,
  CURSOR_PLACEHOLDER,
  DATE_PLACEHOLDER,
  DATEPICKER_PLACEHOLDER,
  IMAGE_PLACEHOLDER,
  GIF_PLACEHOLDER,
  type RichTextEditorProps,
  type RichTextEditorRef,
} from "./types";
import { serializeToMarkdown, deserializeContent } from "./serialization";
import { copyMarkdownAsRichText } from "@/lib/copy-markdown-as-rich-text";
import {
  ClipboardPlaceholderPlugin,
  DatePlaceholderPlugin,
  CursorPlaceholderPlugin,
  DatepickerPlaceholderPlugin,
  ImagePlaceholderPlugin,
  GifPlaceholderPlugin,
  LinkPlugin,
} from "./plugins";
import {
  ClipboardPlaceholderElement,
  DatePlaceholderElement,
  CursorPlaceholderElement,
  DatepickerPlaceholderElement,
  ImagePlaceholderElement,
  GifPlaceholderElement,
} from "./placeholders";
import {
  BoldLeaf,
  ItalicLeaf,
  UnderlineLeaf,
  StrikethroughLeaf,
  CodeLeaf,
} from "./leaves";
import { LinkElementComponent } from "./LinkElement";
import { BLOCK_PLUGINS, ParagraphElement } from "./BlockElements";
import { FloatingToolbar } from "./FloatingToolbar";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { GifPicker } from "./GifPicker";
import { ImagePicker } from "./ImagePicker";
import { saveMedia, compressMedia } from "@/storage/backends/media";
import { MEDIA_LIMITS } from "@/config/constants";
import { captureError, captureMessage } from "@/lib/sentry";
import { i18n } from "#i18n";

/**
 * A rich text editor using PlateJS.
 * Features a floating toolbar for formatting and slash commands for inserting placeholders.
 */
const RichTextEditor = forwardRef<RichTextEditorRef, RichTextEditorProps>(
  function RichTextEditor(
    {
      value,
      onChange,
      placeholder = "Start typing...",
      className,
      ariaLabel,
      onCopyError,
    },
    ref
  ) {
    const initialValueRef = useRef(value);
    // The last `value` prop this editor has accounted for. Comparing against the
    // *initial* value instead made a value that came back after an undo look like
    // "no change", so the document kept showing the undone text.
    const lastValueRef = useRef(value);
    // Overlay visibility lives in `@/store/editor-selection` as one field, so two
    // overlays being open is not representable. With three `useState` booleans
    // nothing stopped the GIF picker opening over the image picker — two floating
    // panels competing for the same Escape key and the same saved range.
    //
    // `useOverlayFlag` keeps the call sites below unchanged while every write goes
    // through the store, which is what makes the invariant hold rather than merely
    // be intended.
    const slash = useOverlayFlag("slash");
    const gif = useOverlayFlag("gif");
    const image = useOverlayFlag("image");
    const showSlashMenu = slash.open;
    const setShowSlashMenu = slash.setOpen;
    const showGifPicker = gif.open;
    const setShowGifPicker = gif.setOpen;
    const showImagePicker = image.open;
    const setShowImagePicker = image.setOpen;

    const slashMenuRange = useEditorSelection((s) => s.slashMenuRange);
    const slashSearchQuery = useEditorSelection((s) => s.slashSearchQuery);
    const manualTrigger = useEditorSelection((s) => s.manualTrigger);
    const setSlashSearchQuery = (query: string) => setSlashQuery(query);
    const setManualTrigger = (manual: boolean) =>
      editorSelectionStore.setState((prev) => ({
        ...prev,
        manualTrigger: manual,
      }));
    const setSlashMenuRange = (range: EditorRange | null) =>
      editorSelectionStore.setState((prev) => ({
        ...prev,
        slashMenuRange: range,
      }));

    // Image upload state
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imageUploadError = useEditorMedia((s) => s.imageUploadError);
    const setImageUploadError = (message: string | null) =>
      editorMediaStore.setState((prev) => ({
        ...prev,
        imageUploadError: message,
      }));
    // Track slash context when image/gif is triggered from slash menu

    // Picker ranges live in `@/store/editor-media`: where an open picker inserts,
    // kept separate per picker so closing one does not discard the other's.
    const gifPickerRange = useEditorMedia((s) => s.gifPickerRange);
    const imagePickerRange = useEditorMedia((s) => s.imagePickerRange);
    const setGifPickerRange = (range: EditorRange | null) =>
      editorMediaStore.setState((prev) => ({ ...prev, gifPickerRange: range }));
    const setImagePickerRange = (range: EditorRange | null) =>
      editorMediaStore.setState((prev) => ({
        ...prev,
        imagePickerRange: range,
      }));

    // Create editor instance
    const editor = useMemo(() => {
      const initialValue = deserializeContent(initialValueRef.current);
      return createPlateEditor({
        plugins: [
          BoldPlugin,
          ItalicPlugin,
          UnderlinePlugin,
          StrikethroughPlugin,
          CodePlugin,
          LinkPlugin.withComponent(LinkElementComponent),
          ParagraphPlugin.withComponent(ParagraphElement),
          ClipboardPlaceholderPlugin.withComponent(ClipboardPlaceholderElement),
          DatePlaceholderPlugin.withComponent(DatePlaceholderElement),
          CursorPlaceholderPlugin.withComponent(CursorPlaceholderElement),
          DatepickerPlaceholderPlugin.withComponent(
            DatepickerPlaceholderElement
          ),
          ImagePlaceholderPlugin.withComponent(ImagePlaceholderElement),
          GifPlaceholderPlugin.withComponent(GifPlaceholderElement),
          // The block grammar emits h1-h6, lists, quotes, hr, code and tables.
          // Without a plugin per type Plate renders the node with no component
          // and the content is invisible in the editor.
          ...BLOCK_PLUGINS,
        ],
        value: initialValue,
        override: {
          components: {
            bold: BoldLeaf,
            italic: ItalicLeaf,
            underline: UnderlineLeaf,
            strikethrough: StrikethroughLeaf,
            code: CodeLeaf,
          },
        },
      });
    }, []);

    // Expose openCommandMenu method via ref
    useImperativeHandle(
      ref,
      () => ({
        openCommandMenu: () => {
          editor.tf.focus();
          setManualTrigger(true);
          setShowSlashMenu(true);
          setSlashSearchQuery("");
        },
      }),
      [editor]
    );

    // Sync external value changes. A keystroke echoes the serialised document
    // back as `value`, so by the time this effect runs the two already match and
    // there is nothing to set. An undo/redo restores an earlier value — including
    // the value the editor mounted with — and that always differs from the last
    // value seen, so the document follows it.
    useEffect(() => {
      if (value === lastValueRef.current) return;
      lastValueRef.current = value;
      const currentMarkdown = serializeToMarkdown(editor.children);
      if (currentMarkdown !== value) {
        editor.tf.setValue(deserializeContent(value));
      }
    }, [value, editor]);

    // Handle editor changes and detect slash command
    const handleChange = useCallback(
      ({ value: newValue }: { value: TElement[] }) => {
        const markdown = serializeToMarkdown(newValue);
        const isEmpty =
          markdown === "" ||
          markdown.trim() === "" ||
          (newValue.length === 1 &&
            newValue[0].type === "p" &&
            (newValue[0] as TElement).children.length === 1 &&
            ((newValue[0] as TElement).children[0] as TText).text === "");

        onChange(isEmpty ? "" : markdown);

        // Check for slash command trigger
        const { selection } = editor;
        if (selection && selection.anchor) {
          try {
            const [node] = editor.api.node(selection.anchor.path) || [];
            if (node && "text" in node) {
              const text = (node as TText).text;
              const cursorOffset = selection.anchor.offset;
              const textBeforeCursor = text.slice(0, cursorOffset);

              const lastSlashIndex = textBeforeCursor.lastIndexOf("/");
              if (lastSlashIndex !== -1) {
                const charBeforeSlash = textBeforeCursor[lastSlashIndex - 1];
                const isValidTrigger =
                  lastSlashIndex === 0 ||
                  charBeforeSlash === " " ||
                  charBeforeSlash === "\n";

                if (isValidTrigger) {
                  const query = textBeforeCursor.slice(lastSlashIndex + 1);
                  if (!query.includes(" ")) {
                    if (!showSlashMenu) {
                      setSlashMenuRange(selection);
                    }
                    setSlashSearchQuery(query);
                    setShowSlashMenu(true);
                    return;
                  }
                }
              }
            }
          } catch {
            // Ignore errors in text detection
          }
        }

        if (showSlashMenu) {
          setShowSlashMenu(false);
          setSlashMenuRange(null);
          setSlashSearchQuery("");
        }
      },
      [onChange, editor, showSlashMenu]
    );

    /** Delete the slash trigger text before inserting a node */
    const deleteSlashTrigger = useCallback(
      (
        manual: boolean,
        _range: import("platejs").TRange | null,
        query: string
      ) => {
        if (!manual) {
          const { selection } = editor;
          if (selection) {
            const deleteLength = 1 + query.length;
            editor.tf.select({
              anchor: {
                path: selection.anchor.path,
                offset: selection.anchor.offset - deleteLength,
              },
              focus: selection.focus,
            });
            editor.tf.delete();
          }
        }
      },
      [editor]
    );

    // Insert clipboard placeholder
    const handleInsertClipboard = useCallback(() => {
      if (!slashMenuRange && !manualTrigger) return;

      deleteSlashTrigger(manualTrigger, slashMenuRange, slashSearchQuery);

      editor.tf.insertNodes({
        type: CLIPBOARD_PLACEHOLDER,
        children: [{ text: "" }],
      } as TElement);

      editor.tf.move({ unit: "offset" });

      setShowSlashMenu(false);
      setSlashMenuRange(null);
      setSlashSearchQuery("");
      setManualTrigger(false);

      setTimeout(() => {
        editor.tf.focus();
      }, 0);
    }, [
      editor,
      slashMenuRange,
      slashSearchQuery,
      manualTrigger,
      deleteSlashTrigger,
    ]);

    // Insert date placeholder
    const handleInsertDate = useCallback(
      (format: string) => {
        if (!slashMenuRange && !manualTrigger) return;

        deleteSlashTrigger(manualTrigger, slashMenuRange, slashSearchQuery);

        editor.tf.insertNodes({
          type: DATE_PLACEHOLDER,
          format,
          children: [{ text: "" }],
        } as TElement);

        editor.tf.move({ unit: "offset" });

        setShowSlashMenu(false);
        setSlashMenuRange(null);
        setSlashSearchQuery("");
        setManualTrigger(false);

        setTimeout(() => {
          editor.tf.focus();
        }, 0);
      },
      [
        editor,
        slashMenuRange,
        slashSearchQuery,
        manualTrigger,
        deleteSlashTrigger,
      ]
    );

    // Close slash menu
    const handleCloseSlashMenu = useCallback(() => {
      setShowSlashMenu(false);
      setSlashMenuRange(null);
      setSlashSearchQuery("");
      setManualTrigger(false);
      editor.tf.focus();
    }, [editor]);

    // Check if cursor placeholder already exists in the editor
    const hasCursorPlaceholder = useMemo(() => {
      const checkNodes = (nodes: Descendant[]): boolean => {
        for (const node of nodes) {
          if (
            "type" in node &&
            (node as TElement).type === CURSOR_PLACEHOLDER
          ) {
            return true;
          }
          if ("children" in node) {
            if (checkNodes((node as TElement).children)) {
              return true;
            }
          }
        }
        return false;
      };
      return checkNodes(editor.children);
    }, [editor.children]);

    // Insert cursor placeholder
    const handleInsertCursor = useCallback(() => {
      if ((!slashMenuRange && !manualTrigger) || hasCursorPlaceholder) return;

      deleteSlashTrigger(manualTrigger, slashMenuRange, slashSearchQuery);

      editor.tf.insertNodes({
        type: CURSOR_PLACEHOLDER,
        children: [{ text: "" }],
      } as TElement);

      editor.tf.move({ unit: "offset" });

      setShowSlashMenu(false);
      setSlashMenuRange(null);
      setSlashSearchQuery("");
      setManualTrigger(false);

      setTimeout(() => {
        editor.tf.focus();
      }, 0);
    }, [
      editor,
      slashMenuRange,
      slashSearchQuery,
      hasCursorPlaceholder,
      manualTrigger,
      deleteSlashTrigger,
    ]);

    // Insert datepicker placeholder
    const handleInsertDatepicker = useCallback(() => {
      if (!slashMenuRange && !manualTrigger) return;

      deleteSlashTrigger(manualTrigger, slashMenuRange, slashSearchQuery);

      const today = new Date().toISOString().split("T")[0];
      editor.tf.insertNodes({
        type: DATEPICKER_PLACEHOLDER,
        date: today,
        children: [{ text: "" }],
      } as TElement);

      editor.tf.move({ unit: "offset" });

      setShowSlashMenu(false);
      setSlashMenuRange(null);
      setSlashSearchQuery("");
      setManualTrigger(false);

      setTimeout(() => {
        editor.tf.focus();
      }, 0);
    }, [
      editor,
      slashMenuRange,
      slashSearchQuery,
      manualTrigger,
      deleteSlashTrigger,
    ]);

    // Handle file selected from file input
    const handleFileSelected = useCallback(
      async (file: File) => {
        setImageUploadError(null);

        // Validate type
        if (
          !MEDIA_LIMITS.SUPPORTED_TYPES.includes(
            file.type as (typeof MEDIA_LIMITS.SUPPORTED_TYPES)[number]
          )
        ) {
          setImageUploadError(i18n.t("imageUpload.unsupportedType"));
          captureMessage(
            "User tried to upload unsupported image type",
            "warning",
            {
              mimeType: file.type,
            }
          );
          return;
        }

        // Validate size
        const maxMB = MEDIA_LIMITS.MAX_FILE_SIZE / (1024 * 1024);
        if (file.size > MEDIA_LIMITS.MAX_FILE_SIZE) {
          setImageUploadError(i18n.t("imageUpload.tooLarge", [String(maxMB)]));
          captureMessage("User tried to upload oversized image", "warning", {
            size: file.size,
          });
          return;
        }

        try {
          const entry = await saveMedia(file);

          // Delete slash trigger if image was inserted via slash command
          const ctx = takePendingSlashContext();
          if (ctx) {
            deleteSlashTrigger(ctx.manual, ctx.range, ctx.query);
          }

          editor.tf.insertNodes({
            type: IMAGE_PLACEHOLDER,
            mediaId: entry.id,
            children: [{ text: "" }],
          } as TElement);

          editor.tf.move({ unit: "offset" });

          setTimeout(() => {
            editor.tf.focus();
          }, 0);

          // Background WebP compression (fire-and-forget)
          compressMedia(entry.id).catch((err) => {
            captureError(err as Error, {
              action: "compressMedia",
              mediaId: entry.id,
            });
          });
        } catch (err) {
          const message = (err as Error).message;
          if (message === "media.errors.tooLarge") {
            const maxMB = MEDIA_LIMITS.MAX_FILE_SIZE / (1024 * 1024);
            setImageUploadError(
              i18n.t("imageUpload.tooLarge", [String(maxMB)])
            );
          } else if (message === "media.errors.unsupportedType") {
            setImageUploadError(i18n.t("imageUpload.unsupportedType"));
          } else if (message === "media.errors.storageFull") {
            setImageUploadError(i18n.t("imageUpload.storageFull"));
          } else {
            setImageUploadError(i18n.t("imageUpload.failed"));
            captureError(err as Error, { action: "saveMedia" });
          }
        }
      },
      [editor, deleteSlashTrigger]
    );

    // Open file picker for image upload
    const handleInsertImage = useCallback(() => {
      // Capture slash context before closing menu
      stashSlashContextForPicker(
        slashMenuRange,
        slashSearchQuery,
        manualTrigger
      );

      setShowSlashMenu(false);
      setSlashMenuRange(null);
      setSlashSearchQuery("");
      setManualTrigger(false);

      // Trigger hidden file input
      fileInputRef.current?.click();
    }, [slashMenuRange, slashSearchQuery, manualTrigger]);

    // Open GIF picker
    const handleInsertGif = useCallback(() => {
      // Capture slash context before closing menu
      stashSlashContextForPicker(
        slashMenuRange,
        slashSearchQuery,
        manualTrigger
      );

      setShowSlashMenu(false);
      setSlashMenuRange(null);
      setSlashSearchQuery("");
      setManualTrigger(false);

      setGifPickerRange(editor.selection);
      setShowGifPicker(true);
    }, [editor, slashMenuRange, slashSearchQuery, manualTrigger]);

    // Handle GIF selected from picker
    const handleSelectGif = useCallback(
      (giphyId: string) => {
        const ctx = takePendingSlashContext();
        if (ctx) {
          deleteSlashTrigger(ctx.manual, ctx.range, ctx.query);
        }

        editor.tf.insertNodes({
          type: GIF_PLACEHOLDER,
          giphyId,
          children: [{ text: "" }],
        } as TElement);

        editor.tf.move({ unit: "offset" });

        setShowGifPicker(false);
        setGifPickerRange(null);

        setTimeout(() => {
          editor.tf.focus();
        }, 0);
      },
      [editor, deleteSlashTrigger]
    );

    const handleCloseGifPicker = useCallback(() => {
      setShowGifPicker(false);
      setGifPickerRange(null);
      editor.tf.focus();
    }, [editor]);

    // Open Image picker from slash menu
    const handleOpenImagePicker = useCallback(() => {
      // Capture slash context before closing menu
      stashSlashContextForPicker(
        slashMenuRange,
        slashSearchQuery,
        manualTrigger
      );

      setShowSlashMenu(false);
      setSlashMenuRange(null);
      setSlashSearchQuery("");
      setManualTrigger(false);

      setImagePickerRange(editor.selection);
      setShowImagePicker(true);
    }, [editor, slashMenuRange, slashSearchQuery, manualTrigger]);

    // Handle image selected from picker (by mediaId)
    const handleSelectImage = useCallback(
      (mediaId: string) => {
        const ctx = takePendingSlashContext();
        if (ctx) {
          deleteSlashTrigger(ctx.manual, ctx.range, ctx.query);
        }

        editor.tf.insertNodes({
          type: IMAGE_PLACEHOLDER,
          mediaId,
          children: [{ text: "" }],
        } as TElement);

        editor.tf.move({ unit: "offset" });

        setShowImagePicker(false);
        setImagePickerRange(null);

        setTimeout(() => {
          editor.tf.focus();
        }, 0);
      },
      [editor, deleteSlashTrigger]
    );

    // Handle "Upload new" button inside the picker — delegates to the file-based flow
    const handlePickerUploadNew = useCallback(
      (file?: File) => {
        setShowImagePicker(false);
        setImagePickerRange(null);

        if (file) {
          handleFileSelected(file);
        } else {
          fileInputRef.current?.click();
        }
      },
      [handleFileSelected]
    );

    const handleCloseImagePicker = useCallback(() => {
      setShowImagePicker(false);
      setImagePickerRange(null);
      editor.tf.focus();
    }, [editor]);

    // Intercept cmd+c: serialize the current selection fragment to Markdown and
    // write rich HTML + plain text to the clipboard. Falls back to native browser
    // copy behavior when there is no selection (editor not focused / no fragment).
    const handleEditorCopy = useCallback(
      (event: React.ClipboardEvent) => {
        const fragment = editor.api.getFragment();
        if (!fragment || fragment.length === 0) return; // let browser handle

        // Only intercept when there's an actual (non-collapsed) selection
        if (editor.api.isCollapsed()) return;

        event.preventDefault();
        const markdown = serializeToMarkdown(fragment);
        copyMarkdownAsRichText(markdown).catch((err) => {
          captureError(err, { action: "editor.copy" });
          onCopyError?.(err);
        });
      },
      [editor, onCopyError]
    );

    // Intercept paste: when the clipboard contains an image, save it to IDB and
    // insert an ImagePlaceholderElement at the cursor — exactly as file upload does.
    const handleEditorPaste = useCallback(
      (event: React.ClipboardEvent) => {
        const items = Array.from(event.clipboardData.items);
        const imageItem = items.find((item) => item.type.startsWith("image/"));
        if (!imageItem) return; // let PlateJS handle text/other pastes normally

        event.preventDefault();
        const file = imageItem.getAsFile();
        if (file) {
          // Clear any pending slash context so the file handler doesn't try to
          // delete a slash trigger that doesn't exist in this code path.
          handleFileSelected(file);
        }
      },
      [handleFileSelected]
    );

    return (
      <div className={cn("relative h-full flex flex-col", className)}>
        {/* Hidden file input for image upload */}
        <input
          ref={fileInputRef}
          type="file"
          accept={MEDIA_LIMITS.SUPPORTED_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              handleFileSelected(file);
            }
            // Reset so the same file can be re-selected
            e.target.value = "";
          }}
        />
        {imageUploadError && (
          <div className="px-2 py-1 text-xs text-destructive bg-destructive/10 border-b border-destructive/30">
            {imageUploadError}
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => setImageUploadError(null)}
            >
              ✕
            </button>
          </div>
        )}
        <Plate editor={editor} onChange={handleChange}>
          <div className="relative flex-1 min-h-0">
            <PlateContent
              aria-label={ariaLabel}
              placeholder={placeholder}
              spellCheck={false}
              className={cn(
                "h-full overflow-auto outline-none text-sm leading-relaxed",
                "text-foreground",
                "**:data-slate-placeholder:text-muted-foreground",
                "**:data-slate-placeholder:opacity-100!"
              )}
              onCopy={handleEditorCopy}
              onPaste={handleEditorPaste}
            />
            <FloatingToolbar
              onInsertImage={handleInsertImage}
              onInsertGif={handleInsertGif}
            />
            {showSlashMenu && (
              <SlashCommandMenu
                onInsertClipboard={handleInsertClipboard}
                onInsertDate={handleInsertDate}
                onInsertCursor={handleInsertCursor}
                onInsertDatepicker={handleInsertDatepicker}
                onOpenImagePicker={handleOpenImagePicker}
                onInsertImage={handleInsertImage}
                onInsertGif={handleInsertGif}
                onClose={handleCloseSlashMenu}
                targetRange={slashMenuRange}
                searchQuery={slashSearchQuery}
                hasCursorPlaceholder={hasCursorPlaceholder}
                manualTrigger={manualTrigger}
              />
            )}
            {showGifPicker && (
              <GifPicker
                onSelectGif={handleSelectGif}
                onClose={handleCloseGifPicker}
                targetRange={gifPickerRange}
              />
            )}
            {showImagePicker && (
              <ImagePicker
                onSelectImage={handleSelectImage}
                onUploadNew={handlePickerUploadNew}
                onClose={handleCloseImagePicker}
                targetRange={imagePickerRange}
              />
            )}
          </div>
        </Plate>
      </div>
    );
  }
);

export default RichTextEditor;
