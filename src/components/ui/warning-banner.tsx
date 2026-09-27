import { i18n } from "#i18n";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

interface WarningBannerProps {
  children: React.ReactNode;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
  className?: string;
  /**
   * Distinguishes this banner from the other WarningBanner instances on the
   * page for e2e selectors. Four banners render in Dashboard.tsx and they all
   * share `aria-label={i18n.t("common.dismiss")}`, so a generic testid would match whichever
   * one happened to come first in the DOM.
   */
  testId?: string;
}

export function WarningBanner({
  children,
  action,
  onDismiss,
  className,
  testId,
}: WarningBannerProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-[10px]",
        className
      )}
      // Note: amber colors are intentionally kept as semantic warning colors (no --warning token in shadcn base)
    >
      <Icon icon={AlertTriangle} size="lg" />
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
          aria-label={i18n.t("common.dismiss")}
          data-testid={testId}
        >
          <Icon icon={X} stroke="emphasis" />
        </button>
      )}
    </div>
  );
}
