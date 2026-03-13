import {
  useEffect,
  useMemo,
  useRef,
  useCallback,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";
import { cn } from "~/lib/utils";
import { createPlateEditor, Plate, PlateContent } from "platejs/react";
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
import { copyMarkdownAsRichText } from "~/lib/copyMarkdownAsRichText";
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
} from "./components/placeholders";
import {
  BoldLeaf,
  ItalicLeaf,
  UnderlineLeaf,
  StrikethroughLeaf,
  CodeLeaf,
} from "./components/leaves";
import { LinkElementComponent } from "./components/LinkElement";
import { FloatingToolbar } from "./components/FloatingToolbar";
import { SlashCommandMenu } from "./components/SlashCommandMenu";
import { GifPicker } from "./components/GifPicker";
import { ImagePicker } from "./components/ImagePicker";
import { saveMedia, compressMedia } from "~/storage/backends/media";
import { MEDIA_LIMITS } from "~/config/constants";
import { captureError, captureMessage } from "~/lib/sentry";
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
      onCopyError,
    },
    ref
  ) {
    const initialValueRef = useRef(value);
    const isExternalUpdate = useRef(false);
    const [showSlashMenu, setShowSlashMenu] = useState(false);
    const [slashMenuRange, setSlashMenuRange] = useState<
      import("platejs").TRange | null
    >(null);
    const [slashSearchQuery, setSlashSearchQuery] = useState("");
    const [manualTrigger, setManualTrigger] = useState(false);

    // Image upload state
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [imageUploadError, setImageUploadError] = useState<string | null>(
      null
    );
    // Track slash context when image/gif is triggered from slash menu
    const pendingSlashContext = useRef<{
      range: import("platejs").TRange | null;
      query: string;
      manual: boolean;
    } | null>(null);

    // GIF picker state
    const [showGifPicker, setShowGifPicker] = useState(false);
    const [gifPickerRange, setGifPickerRange] = useState<
      import("platejs").TRange | null
    >(null);

    // Image picker state
    const [showImagePicker, setShowImagePicker] = useState(false);
    const [imagePickerRange, setImagePickerRange] = useState<
      import("platejs").TRange | null
    >(null);

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
          ClipboardPlaceholderPlugin.withComponent(ClipboardPlaceholderElement),
          DatePlaceholderPlugin.withComponent(DatePlaceholderElement),
          CursorPlaceholderPlugin.withComponent(CursorPlaceholderElement),
          DatepickerPlaceholderPlugin.withComponent(
            DatepickerPlaceholderElement
          ),
          ImagePlaceholderPlugin.withComponent(ImagePlaceholderElement),
          GifPlaceholderPlugin.withComponent(GifPlaceholderElement),
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

    // Sync external value changes
    useEffect(() => {
      if (isExternalUpdate.current) {
        isExternalUpdate.current = false;
        return;
      }

      const currentMarkdown = serializeToMarkdown(editor.children);
      if (currentMarkdown !== value && value !== initialValueRef.current) {
        const newValue = deserializeContent(value);
        editor.tf.setValue(newValue);
        initialValueRef.current = value;
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

        isExternalUpdate.current = true;
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
        range: import("platejs").TRange | null,
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
          const ctx = pendingSlashContext.current;
          if (ctx) {
            deleteSlashTrigger(ctx.manual, ctx.range, ctx.query);
            pendingSlashContext.current = null;
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
      pendingSlashContext.current = {
        range: slashMenuRange,
        query: slashSearchQuery,
        manual: manualTrigger,
      };

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
      pendingSlashContext.current = {
        range: slashMenuRange,
        query: slashSearchQuery,
        manual: manualTrigger,
      };

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
        const ctx = pendingSlashContext.current;
        if (ctx) {
          deleteSlashTrigger(ctx.manual, ctx.range, ctx.query);
          pendingSlashContext.current = null;
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
      pendingSlashContext.current = null;
      setShowGifPicker(false);
      setGifPickerRange(null);
      editor.tf.focus();
    }, [editor]);

    // Open Image picker from slash menu
    const handleOpenImagePicker = useCallback(() => {
      // Capture slash context before closing menu
      pendingSlashContext.current = {
        range: slashMenuRange,
        query: slashSearchQuery,
        manual: manualTrigger,
      };

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
        const ctx = pendingSlashContext.current;
        if (ctx) {
          deleteSlashTrigger(ctx.manual, ctx.range, ctx.query);
          pendingSlashContext.current = null;
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
      pendingSlashContext.current = null;
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
          pendingSlashContext.current = null;
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
              placeholder={placeholder}
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
