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
  type RichTextEditorProps,
  type RichTextEditorRef,
} from "./types";
import { serializeToMarkdown, deserializeContent } from "./serialization";
import {
  ClipboardPlaceholderPlugin,
  DatePlaceholderPlugin,
  CursorPlaceholderPlugin,
  DatepickerPlaceholderPlugin,
} from "./plugins";
import {
  ClipboardPlaceholderElement,
  DatePlaceholderElement,
  CursorPlaceholderElement,
  DatepickerPlaceholderElement,
} from "./components/placeholders";
import {
  BoldLeaf,
  ItalicLeaf,
  UnderlineLeaf,
  StrikethroughLeaf,
  CodeLeaf,
} from "./components/leaves";
import { FloatingToolbar } from "./components/FloatingToolbar";
import { SlashCommandMenu } from "./components/SlashCommandMenu";

/**
 * A rich text editor using PlateJS.
 * Features a floating toolbar for formatting and slash commands for inserting placeholders.
 */
const RichTextEditor = forwardRef<RichTextEditorRef, RichTextEditorProps>(
  function RichTextEditor(
    { value, onChange, placeholder = "Start typing...", className },
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
          ClipboardPlaceholderPlugin.withComponent(ClipboardPlaceholderElement),
          DatePlaceholderPlugin.withComponent(DatePlaceholderElement),
          CursorPlaceholderPlugin.withComponent(CursorPlaceholderElement),
          DatepickerPlaceholderPlugin.withComponent(
            DatepickerPlaceholderElement
          ),
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

    // Insert clipboard placeholder
    const handleInsertClipboard = useCallback(() => {
      if (!slashMenuRange && !manualTrigger) return;

      if (!manualTrigger) {
        const { selection } = editor;
        if (selection) {
          const deleteLength = 1 + slashSearchQuery.length;
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
    }, [editor, slashMenuRange, slashSearchQuery, manualTrigger]);

    // Insert date placeholder
    const handleInsertDate = useCallback(
      (format: string) => {
        if (!slashMenuRange && !manualTrigger) return;

        if (!manualTrigger) {
          const { selection } = editor;
          if (selection) {
            const deleteLength = 1 + slashSearchQuery.length;
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
      [editor, slashMenuRange, slashSearchQuery, manualTrigger]
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

      if (!manualTrigger) {
        const { selection } = editor;
        if (selection) {
          const deleteLength = 1 + slashSearchQuery.length;
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
    ]);

    // Insert datepicker placeholder
    const handleInsertDatepicker = useCallback(() => {
      if (!slashMenuRange && !manualTrigger) return;

      if (!manualTrigger) {
        const { selection } = editor;
        if (selection) {
          const deleteLength = 1 + slashSearchQuery.length;
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
    }, [editor, slashMenuRange, slashSearchQuery, manualTrigger]);

    return (
      <div className={cn("relative h-full flex flex-col", className)}>
        <Plate editor={editor} onChange={handleChange}>
          <div className="relative flex-1 min-h-0">
            <PlateContent
              placeholder={placeholder}
              className={cn(
                "h-full overflow-auto outline-none text-sm leading-relaxed",
                "text-zinc-900 dark:text-zinc-100",
                "**:data-slate-placeholder:text-zinc-400 **:data-slate-placeholder:dark:text-zinc-500",
                "**:data-slate-placeholder:opacity-100!"
              )}
            />
            <FloatingToolbar />
            {showSlashMenu && (
              <SlashCommandMenu
                onInsertClipboard={handleInsertClipboard}
                onInsertDate={handleInsertDate}
                onInsertCursor={handleInsertCursor}
                onInsertDatepicker={handleInsertDatepicker}
                onClose={handleCloseSlashMenu}
                targetRange={slashMenuRange}
                searchQuery={slashSearchQuery}
                hasCursorPlaceholder={hasCursorPlaceholder}
                manualTrigger={manualTrigger}
              />
            )}
          </div>
        </Plate>
      </div>
    );
  }
);

export default RichTextEditor;
