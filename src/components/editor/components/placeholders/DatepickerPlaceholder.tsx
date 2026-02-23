import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "~/lib/utils";
import { useEditorRef } from "platejs/react";
import type { TElement } from "platejs";

interface DatepickerPlaceholderElementProps {
  children: React.ReactNode;
  attributes: Record<string, unknown>;
  element: TElement & { date?: string };
}

export function DatepickerPlaceholderElement({
  children,
  attributes,
  element,
}: DatepickerPlaceholderElementProps) {
  const editor = useEditorRef();
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const date = element.date || new Date().toISOString().split("T")[0];

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowPicker((prev) => !prev);
  }, []);

  const handleDateChange = useCallback(
    (newDate: string) => {
      // Security: Validate date format (YYYY-MM-DD) to prevent injection
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;

      const path = editor.api.findPath(element);
      if (path) {
        editor.tf.setNodes({ date: newDate } as Partial<TElement>, {
          at: path,
        });
      }
      setShowPicker(false);
      editor.tf.focus();
    },
    [editor, element]
  );

  const displayDate = useMemo(() => {
    try {
      const d = new Date(date + "T00:00:00");
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return date;
    }
  }, [date]);

  useEffect(() => {
    if (!showPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPicker]);

  return (
    <span {...attributes} className="relative inline">
      <span
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
        title={`Click to change date. Current: ${displayDate}`}
      >
        <CalendarDays className="h-2.5 w-2.5" strokeWidth={2.5} />
        <span>{displayDate}</span>
      </span>
      {showPicker && (
        <div
          ref={pickerRef}
          className={cn(
            "absolute left-0 top-full mt-1 z-50",
            "rounded-lg border border-border",
            "bg-popover shadow-lg p-2"
          )}
        >
          <input
            type="date"
            value={date}
            onChange={(e) => handleDateChange(e.target.value)}
            className={cn(
              "w-full px-2 py-1.5 rounded-md text-sm",
              "border border-border",
              "bg-background",
              "text-foreground",
              "focus:outline-none focus:ring-2 focus:ring-ring"
            )}
          />
        </div>
      )}
      <span className="hidden">{children}</span>
    </span>
  );
}
