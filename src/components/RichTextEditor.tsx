import { useState, useRef, useEffect, useCallback } from "react";
import { Bold, Italic, Strikethrough, Clipboard } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

interface SelectionState {
  start: number;
  end: number;
  text: string;
  position: { top: number; left: number };
}

interface SlashMenuState {
  isOpen: boolean;
  position: { top: number; left: number };
  searchQuery: string;
  selectedIndex: number;
}

const SLASH_COMMANDS = [
  {
    id: "clipboard",
    label: "Clipboard",
    description: "Insert clipboard content placeholder",
    icon: Clipboard,
    insert: "{{clipboard}}",
  },
];

export default function RichTextEditor({
  value,
  onChange,
  placeholder = "Enter content...",
  className,
}: RichTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [slashMenu, setSlashMenu] = useState<SlashMenuState>({
    isOpen: false,
    position: { top: 0, left: 0 },
    searchQuery: "",
    selectedIndex: 0,
  });
  const toolbarRef = useRef<HTMLDivElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);

  // Get caret coordinates in textarea
  const getCaretCoordinates = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return { top: 0, left: 0 };

    const { selectionStart } = textarea;
    const textBeforeCaret = value.substring(0, selectionStart);
    const lines = textBeforeCaret.split("\n");
    const currentLineIndex = lines.length - 1;
    const currentLineText = lines[currentLineIndex];

    // Create a hidden div to measure text
    const mirror = document.createElement("div");
    const computed = window.getComputedStyle(textarea);

    mirror.style.cssText = `
      position: absolute;
      visibility: hidden;
      white-space: pre-wrap;
      word-wrap: break-word;
      font-family: ${computed.fontFamily};
      font-size: ${computed.fontSize};
      line-height: ${computed.lineHeight};
      padding: ${computed.padding};
      width: ${textarea.clientWidth}px;
    `;
    mirror.textContent = currentLineText || " ";
    document.body.appendChild(mirror);

    const lineHeight = parseInt(computed.lineHeight) || 16;
    const paddingTop = parseInt(computed.paddingTop) || 0;
    const paddingLeft = parseInt(computed.paddingLeft) || 0;

    const rect = textarea.getBoundingClientRect();
    const top =
      rect.top +
      paddingTop +
      currentLineIndex * lineHeight -
      textarea.scrollTop +
      lineHeight;
    const left =
      rect.left +
      paddingLeft +
      Math.min(mirror.scrollWidth, textarea.clientWidth - paddingLeft * 2);

    document.body.removeChild(mirror);

    return { top, left: Math.min(left, rect.right - 150) };
  }, [value]);

  // Handle text selection for formatting toolbar
  const handleSelect = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = value.substring(start, end);

    if (selectedText.length > 0) {
      const rect = textarea.getBoundingClientRect();

      // Calculate position based on selection
      const textBeforeSelection = value.substring(0, start);
      const lines = textBeforeSelection.split("\n");
      const lineIndex = lines.length - 1;
      const computed = window.getComputedStyle(textarea);
      const lineHeight = parseInt(computed.lineHeight) || 16;
      const paddingTop = parseInt(computed.paddingTop) || 0;

      const top =
        rect.top +
        paddingTop +
        lineIndex * lineHeight -
        textarea.scrollTop -
        40;
      const left = rect.left + 10;

      setSelection({
        start,
        end,
        text: selectedText,
        position: { top: Math.max(top, rect.top - 40), left },
      });
    } else {
      setSelection(null);
    }
  }, [value]);

  // Handle input changes and detect slash commands
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursorPos = e.target.selectionStart;

      onChange(newValue);

      // Check for slash command trigger
      const textBeforeCursor = newValue.substring(0, cursorPos);
      const lastSlashIndex = textBeforeCursor.lastIndexOf("/");

      if (lastSlashIndex !== -1) {
        const textAfterSlash = textBeforeCursor.substring(lastSlashIndex + 1);
        // Only show menu if slash is at start of line or after whitespace
        const charBeforeSlash =
          lastSlashIndex > 0 ? textBeforeCursor[lastSlashIndex - 1] : "\n";

        if (
          (charBeforeSlash === "\n" ||
            charBeforeSlash === " " ||
            lastSlashIndex === 0) &&
          !textAfterSlash.includes(" ")
        ) {
          const coords = getCaretCoordinates();
          setSlashMenu({
            isOpen: true,
            position: coords,
            searchQuery: textAfterSlash.toLowerCase(),
            selectedIndex: 0,
          });
          return;
        }
      }

      setSlashMenu((prev) => ({ ...prev, isOpen: false }));
    },
    [onChange, getCaretCoordinates]
  );

  // Apply formatting to selected text
  const applyFormat = useCallback(
    (format: "bold" | "italic" | "strikethrough") => {
      if (!selection || !textareaRef.current) return;

      const { start, end, text } = selection;
      let formattedText = "";
      let wrapper = "";

      switch (format) {
        case "bold":
          wrapper = "**";
          break;
        case "italic":
          wrapper = "_";
          break;
        case "strikethrough":
          wrapper = "~~";
          break;
      }

      // Check if already formatted, then remove formatting
      if (text.startsWith(wrapper) && text.endsWith(wrapper)) {
        formattedText = text.slice(wrapper.length, -wrapper.length);
      } else {
        formattedText = `${wrapper}${text}${wrapper}`;
      }

      const newValue =
        value.substring(0, start) + formattedText + value.substring(end);
      onChange(newValue);

      // Update selection
      setSelection(null);

      // Restore focus and selection
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(
            start,
            start + formattedText.length
          );
        }
      }, 0);
    },
    [selection, value, onChange]
  );

  // Insert slash command
  const insertSlashCommand = useCallback(
    (command: (typeof SLASH_COMMANDS)[0]) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursorPos = textarea.selectionStart;
      const textBeforeCursor = value.substring(0, cursorPos);
      const lastSlashIndex = textBeforeCursor.lastIndexOf("/");

      if (lastSlashIndex !== -1) {
        const newValue =
          value.substring(0, lastSlashIndex) +
          command.insert +
          value.substring(cursorPos);
        onChange(newValue);

        // Close menu and restore focus
        setSlashMenu((prev) => ({ ...prev, isOpen: false }));
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            const newCursorPos = lastSlashIndex + command.insert.length;
            textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          }
        }, 0);
      }
    },
    [value, onChange]
  );

  // Handle keyboard navigation in slash menu
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!slashMenu.isOpen) return;

      const filteredCommands = SLASH_COMMANDS.filter(
        (cmd) =>
          cmd.label.toLowerCase().includes(slashMenu.searchQuery) ||
          cmd.description.toLowerCase().includes(slashMenu.searchQuery)
      );

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSlashMenu((prev) => ({
            ...prev,
            selectedIndex: Math.min(
              prev.selectedIndex + 1,
              filteredCommands.length - 1
            ),
          }));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSlashMenu((prev) => ({
            ...prev,
            selectedIndex: Math.max(prev.selectedIndex - 1, 0),
          }));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredCommands[slashMenu.selectedIndex]) {
            insertSlashCommand(filteredCommands[slashMenu.selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setSlashMenu((prev) => ({ ...prev, isOpen: false }));
          break;
      }
    },
    [slashMenu, insertSlashCommand]
  );

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        toolbarRef.current &&
        !toolbarRef.current.contains(e.target as Node)
      ) {
        setSelection(null);
      }
      if (
        slashMenuRef.current &&
        !slashMenuRef.current.contains(e.target as Node)
      ) {
        setSlashMenu((prev) => ({ ...prev, isOpen: false }));
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter slash commands based on search query
  const filteredCommands = SLASH_COMMANDS.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(slashMenu.searchQuery) ||
      cmd.description.toLowerCase().includes(slashMenu.searchQuery)
  );

  return (
    <div className="relative h-full">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onSelect={handleSelect}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn(
          "h-full min-h-full font-sans text-xs resize-none border-0 shadow-none focus-visible:ring-0 p-0",
          className
        )}
      />

      {/* Formatting Toolbar */}
      {selection && (
        <div
          ref={toolbarRef}
          className="fixed z-50 flex items-center gap-0.5 p-0.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md shadow-lg"
          style={{
            top: selection.position.top,
            left: selection.position.left,
          }}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => applyFormat("bold")}
            title="Bold"
          >
            <Bold className="h-3 w-3" strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => applyFormat("italic")}
            title="Italic"
          >
            <Italic className="h-3 w-3" strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => applyFormat("strikethrough")}
            title="Strikethrough"
          >
            <Strikethrough className="h-3 w-3" strokeWidth={2} />
          </Button>
        </div>
      )}

      {/* Slash Command Menu */}
      {slashMenu.isOpen && filteredCommands.length > 0 && (
        <div
          ref={slashMenuRef}
          className="fixed z-50 w-56 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg overflow-hidden"
          style={{
            top: slashMenu.position.top,
            left: slashMenu.position.left,
          }}
        >
          <div className="p-1">
            {filteredCommands.map((command, index) => {
              const Icon = command.icon;
              return (
                <button
                  key={command.id}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors",
                    index === slashMenu.selectedIndex
                      ? "bg-zinc-100 dark:bg-zinc-800"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  )}
                  onClick={() => insertSlashCommand(command)}
                >
                  <div className="flex items-center justify-center h-7 w-7 rounded bg-zinc-100 dark:bg-zinc-800">
                    <Icon
                      className="h-3.5 w-3.5 text-zinc-600 dark:text-zinc-400"
                      strokeWidth={1.5}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                      {command.label}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      {command.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
