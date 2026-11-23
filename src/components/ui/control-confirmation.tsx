import { Check } from "lucide-react";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * A short, icon-plus-text confirmation shown beside the control that caused it.
 * It is deliberately not a live region: the shared provider announces it.
 */
export function ControlConfirmation({
  label,
  className,
  testId,
}: {
  label: string;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300",
        className
      )}
    >
      <Icon icon={Check} size="sm" />
      {label}
    </span>
  );
}
