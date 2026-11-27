import { useCallback, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ICON_STROKE } from "@/lib/icons";
import {
  formatStoredDate,
  isValidStoredDate,
  toStoredDate,
  todayStoredDate,
} from "@/lib/editor-date";
import { cn } from "@/lib/utils";
import { useEditorRef } from "platejs/react";
import type { TElement } from "platejs";
import { i18n } from "#i18n";

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
  const [open, setOpen] = useState(false);
  const storedDate = isValidStoredDate(element.date ?? "")
    ? element.date!
    : todayStoredDate();
  const selectedDate = useMemo(
    () => (storedDate ? new Date(`${storedDate}T12:00:00`) : undefined),
    [storedDate]
  );
  const displayDate = formatStoredDate(storedDate);

  const handleDateChange = useCallback(
    (newDate: Date | undefined) => {
      if (!newDate) return;
      const stored = toStoredDate(newDate);
      // Security: only a real YYYY-MM-DD calendar date reaches the node. The
      // pure helper also rejects every other shape a picker can emit.
      if (!stored) return;

      const path = editor.api.findPath(element);
      if (path) {
        editor.tf.setNodes({ date: stored } as Partial<TElement>, {
          at: path,
        });
      }
      setOpen(false);
      editor.tf.focus();
    },
    [editor, element]
  );

  return (
    <span {...attributes} className="relative inline">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          nativeButton
          render={
            <button
              type="button"
              contentEditable={false}
              data-testid="datepicker-trigger"
              title={i18n.t("editor.datePicker.change", [displayDate])}
              aria-label={i18n.t("editor.datePicker.label")}
              className={cn(
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 align-baseline mx-0.5",
                "font-mono text-ui-micro! leading-none",
                "bg-muted border border-border",
                "shadow-[0_1px_0_1px_var(--secondary),0_0.125rem_0.1875rem_rgba(0,0,0,0.05)]",
                "text-muted-foreground",
                "dark:shadow-[0_1px_0_1px_rgba(0,0,0,0.3),0_0.125rem_0.1875rem_rgba(0,0,0,0.2)]",
                "hover:bg-accent",
                "transition-colors duration-150"
              )}
            >
              <Icon
                icon={CalendarDays}
                size="xs"
                strokeWidth={ICON_STROKE.micro}
              />
              <span>{displayDate}</span>
            </button>
          }
        />
        <PopoverContent
          data-testid="datepicker-popover"
          align="start"
          side="bottom"
          className="w-auto p-2"
        >
          <Calendar
            mode="single"
            selected={selectedDate}
            defaultMonth={selectedDate}
            onSelect={handleDateChange}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      <span className="hidden">{children}</span>
    </span>
  );
}
