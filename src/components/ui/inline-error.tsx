import { i18n } from "#i18n";
import { useEffect, useRef } from "react";
import { AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

const AUTO_CLEAR_MS = 8000;

interface InlineErrorProps {
  message: string | null;
  /** Called when the error is dismissed (via X or after AUTO_CLEAR_MS). */
  onDismiss: () => void;
  className?: string;
}

/**
 * Accessible inline error banner.
 *
 * - `role="alert"` (implies aria-live="assertive") — announced immediately by
 *   screen readers without moving focus.
 * - Auto-dismisses after 8 seconds (WCAG 2.2.1: timing adjustable — the user
 *   can also dismiss manually with the X button before that).
 * - Co-located with the action that triggered the error, satisfying the
 *   gestalt principle of proximity.
 */
export function InlineError({
  message,
  onDismiss,
  className,
}: InlineErrorProps) {
  // Use a ref so the timer always calls the latest onDismiss without the
  // useEffect needing to re-run (and re-start the timer) when the inline
  // function identity changes between renders.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => onDismissRef.current(), AUTO_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message) return null;

  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 px-3 py-2 bg-destructive/10 border-b border-destructive/20 text-destructive text-xs",
        className
      )}
    >
      <Icon icon={AlertCircle} className="mt-0.5" />
      <p className="flex-1 leading-snug">{message}</p>
      <button
        onClick={onDismiss}
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
        aria-label={i18n.t("common.dismissError")}
      >
        <Icon icon={X} size="sm" stroke="emphasis" />
      </button>
    </div>
  );
}
