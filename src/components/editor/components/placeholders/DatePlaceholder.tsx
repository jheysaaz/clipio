import { useState, useCallback, useEffect, useRef } from "react";
import { Calendar } from "lucide-react";
import { cn } from "~/lib/utils";
import { useEditorRef } from "platejs/react";
import type { TElement } from "platejs";
import { DATE_FORMATS } from "../../types";

interface DatePlaceholderElementProps {
  children: React.ReactNode;
  attributes: Record<string, unknown>;
  element: TElement & { format?: string };
}

export function DatePlaceholderElement({
  children,
  attributes,
  element,
}: DatePlaceholderElementProps) {
  const editor = useEditorRef();
  const [showFormatMenu, setShowFormatMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const format = element.format || "iso";
  const formatInfo =
    DATE_FORMATS.find((f) => f.id === format) || DATE_FORMATS[0];

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowFormatMenu((prev) => !prev);
  }, []);

  const handleSelectFormat = useCallback(
    (newFormat: string) => {
      // Security: Validate format is one of allowed values
      const validFormats = DATE_FORMATS.map((f) => f.id);
      if (!validFormats.includes(newFormat as (typeof validFormats)[number]))
        return;

      const path = editor.api.findPath(element);
      if (path) {
        editor.tf.setNodes({ format: newFormat } as Partial<TElement>, {
          at: path,
        });
      }
      setShowFormatMenu(false);
      editor.tf.focus();
    },
    [editor, element]
  );

  useEffect(() => {
    if (!showFormatMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowFormatMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showFormatMenu]);

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
        title={`Click to change format. Current: ${formatInfo.example}`}
      >
        <Calendar className="h-2.5 w-2.5" strokeWidth={2.5} />
        <span>today</span>
        <span className="text-muted-foreground">· {formatInfo.label}</span>
      </span>
      {showFormatMenu && (
        <div
          ref={menuRef}
          className={cn(
            "absolute left-0 top-full mt-1 z-50 min-w-36",
            "rounded-lg border border-border",
            "bg-popover shadow-lg p-1"
          )}
        >
          <div className="text-[10px] font-medium text-muted-foreground px-2 py-1 uppercase tracking-wide">
            Date Format
          </div>
          {DATE_FORMATS.map((fmt) => (
            <button
              key={fmt.id}
              type="button"
              onClick={() => handleSelectFormat(fmt.id)}
              className={cn(
                "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs text-left transition-colors",
                fmt.id === format ? "bg-accent" : "hover:bg-accent"
              )}
            >
              <span className="font-medium text-foreground">{fmt.label}</span>
              <span className="text-muted-foreground">{fmt.example}</span>
            </button>
          ))}
        </div>
      )}
      <span className="hidden">{children}</span>
    </span>
  );
}
