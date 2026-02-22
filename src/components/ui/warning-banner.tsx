import { AlertTriangle, X } from "lucide-react";
import { cn } from "~/lib/utils";

interface WarningBannerProps {
  children: React.ReactNode;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
  className?: string;
}

export function WarningBanner({
  children,
  action,
  onDismiss,
  className,
}: WarningBannerProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-[10px]",
        className
      )}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.5} />
      <p className="flex-1 leading-snug">
        {children}
        {action && (
          <>
            {" "}
            <button
              onClick={action.onClick}
              className="underline hover:no-underline font-medium"
            >
              {action.label}
            </button>
          </>
        )}
      </p>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
