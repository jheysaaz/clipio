import { Info } from "lucide-react";

export function InfoTooltip({ text }: { text: string }) {
  return (
    <div className="group relative inline-flex items-center">
      <Info
        className="h-3.5 w-3.5 text-muted-foreground cursor-help"
        strokeWidth={1.5}
      />
      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-lg bg-foreground text-background text-xs px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-xl">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-foreground" />
      </div>
    </div>
  );
}
