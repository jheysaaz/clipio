import { Info } from "lucide-react";
import { useState } from "react";

export function InfoTooltip({ text }: { text: string }) {
  const [isVisible, setIsVisible] = useState(false);
  const id = `info-tooltip-${text.slice(0, 10).replace(/\s+/g, "-")}`;

  return (
    <div
      className="group relative inline-flex items-center"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      <Info
        tabIndex={0}
        role="button"
        aria-label={text}
        aria-describedby={id}
        className="h-3.5 w-3.5 text-muted-foreground cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full"
        strokeWidth={1.5}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setIsVisible(false);
        }}
      />
      <div
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-lg bg-foreground text-background text-xs px-3 py-2 z-50 shadow-xl transition-opacity ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-foreground" />
      </div>
    </div>
  );
}
