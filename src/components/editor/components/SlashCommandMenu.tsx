import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Clipboard, Calendar, MousePointer2, CalendarDays } from "lucide-react";
import { cn } from "~/lib/utils";
import { useVirtualFloating, offset, flip, shift } from "@platejs/floating";
import type { SlashCommandMenuProps } from "../types";
import { i18n } from "#i18n";

export function SlashCommandMenu({
  onInsertClipboard,
  onInsertDate,
  onInsertCursor,
  onInsertDatepicker,
  onClose,
  targetRange,
  searchQuery,
  hasCursorPlaceholder,
  manualTrigger = false,
}: SlashCommandMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Memoize commands to prevent recreation on every render
  const commands = useMemo(() => {
    const allCommands = [
      {
        id: "clipboard",
        label: i18n.t("editor.slashMenu.clipboard.label"),
        description: i18n.t("editor.slashMenu.clipboard.description"),
        icon: Clipboard,
        action: onInsertClipboard,
        disabled: false,
      },
      {
        id: "date",
        label: i18n.t("editor.slashMenu.date.label"),
        description: i18n.t("editor.slashMenu.date.description"),
        icon: Calendar,
        action: () => onInsertDate("iso"),
        disabled: false,
      },
      {
        id: "cursor",
        label: i18n.t("editor.slashMenu.cursor.label"),
        description: hasCursorPlaceholder
          ? i18n.t("editor.slashMenu.cursor.alreadyAdded")
          : i18n.t("editor.slashMenu.cursor.description"),
        icon: MousePointer2,
        action: onInsertCursor,
        disabled: hasCursorPlaceholder,
      },
      {
        id: "datepicker",
        label: i18n.t("editor.slashMenu.datepicker.label"),
        description: i18n.t("editor.slashMenu.datepicker.description"),
        icon: CalendarDays,
        action: onInsertDatepicker,
        disabled: false,
      },
    ];

    if (!searchQuery) return allCommands;
    const query = searchQuery.toLowerCase();
    return allCommands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(query) ||
        cmd.description.toLowerCase().includes(query) ||
        cmd.id.toLowerCase().includes(query)
    );
  }, [
    searchQuery,
    hasCursorPlaceholder,
    onInsertClipboard,
    onInsertDate,
    onInsertCursor,
    onInsertDatepicker,
  ]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [commands.length]);

  const getBoundingClientRect = useCallback(() => {
    if (manualTrigger || !targetRange) {
      try {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 || rect.height > 0) {
            return {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              left: rect.left,
            };
          }
        }
      } catch {
        // Fall through to default
      }

      return {
        x: 100,
        y: 150,
        width: 0,
        height: 20,
        top: 150,
        right: 100,
        bottom: 170,
        left: 100,
      };
    }

    try {
      const domRange = window.getSelection()?.getRangeAt(0);
      if (domRange) {
        const rect = domRange.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
        };
      }
    } catch {
      // Ignore errors
    }

    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    };
  }, [targetRange, manualTrigger]);

  const floating = useVirtualFloating({
    getBoundingClientRect,
    open: true,
    middleware: [
      offset(4),
      flip({ fallbackPlacements: ["top-start", "bottom-end", "top-end"] }),
      shift({ padding: 8 }),
    ],
    placement: "bottom-start",
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const enabledCommands = commands.filter((c) => !c.disabled);
      if (enabledCommands.length === 0) {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % commands.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + commands.length) % commands.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const cmd = commands[selectedIndex];
        if (cmd && !cmd.disabled) {
          cmd.action();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [commands, selectedIndex, onClose]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={(node) => {
        menuRef.current = node;
        floating.refs.setFloating(node);
      }}
      style={floating.style}
      role="listbox"
      aria-label={i18n.t("editor.slashMenu.header")}
      aria-activedescendant={
        commands[selectedIndex]
          ? `slash-cmd-${commands[selectedIndex].id}`
          : undefined
      }
      className="z-50 min-w-50 rounded-lg border border-border bg-popover shadow-lg p-1"
    >
      <div className="text-[10px] font-medium text-muted-foreground px-2 py-1 uppercase tracking-wide">
        {i18n.t("editor.slashMenu.header")}
        {searchQuery && ` · "${searchQuery}"`}
      </div>
      {commands.length === 0 ? (
        <div className="px-2 py-3 text-sm text-muted-foreground text-center">
          {i18n.t("editor.slashMenu.noMatches")}
        </div>
      ) : (
        commands.map((command, index) => {
          const Icon = command.icon;
          return (
            <button
              key={command.id}
              id={`slash-cmd-${command.id}`}
              type="button"
              role="option"
              aria-selected={selectedIndex === index}
              aria-disabled={command.disabled}
              disabled={command.disabled}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors",
                command.disabled
                  ? "opacity-50 cursor-not-allowed"
                  : selectedIndex === index
                    ? "bg-accent"
                    : "hover:bg-accent"
              )}
              onClick={() => !command.disabled && command.action()}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div
                className={cn(
                  "flex items-center justify-center w-6 h-6 rounded",
                  command.disabled
                    ? "bg-muted text-muted-foreground"
                    : "bg-accent text-accent-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className={cn(
                    "font-medium",
                    command.disabled
                      ? "text-muted-foreground"
                      : "text-foreground"
                  )}
                >
                  {command.label}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {command.description}
                </div>
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}
