import { useEffect } from "react";
import { AlertCircle, X } from "lucide-react";

import { useFeedback } from "@/components/feedback/FeedbackProvider";
import { i18n } from "#i18n";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

type InlineErrorProps = {
  message: string | null;
  onDismiss: () => void;
  className?: string;
};

/**
 * A co-located, persistent inline error.
 *
 * It is presentational: the error is announced through the provider's single
 * assertive live region. It has no timer — an error with a dismiss control is
 * actionable and must never disappear on its own.
 */
export function InlineError({
  message,
  onDismiss,
  className,
}: InlineErrorProps) {
  const { announceError } = useFeedback();

  useEffect(() => {
    if (message) announceError(message);
  }, [message, announceError]);

  if (!message) return null;

  return (
    <div
      data-testid="inline-error"
      className={cn(
        "flex items-start gap-2 bg-destructive/10 px-3 py-2 text-xs text-destructive",
        className
      )}
    >
      <Icon icon={AlertCircle} className="mt-0.5" />
      <p className="flex-1 leading-snug">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        aria-label={i18n.t("common.dismissError")}
      >
        <Icon icon={X} size="sm" stroke="emphasis" />
      </button>
    </div>
  );
}
