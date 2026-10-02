/**
 * `SettingRow` — the single primitive every preference renders through.
 *
 * Replaces the `rounded-xl border p-5` cards the options page used to stack.
 * Rows are separated by hairlines, carry a fixed-width control column so labels
 * never reflow as values change, and expose an optional reset affordance.
 *
 * spec: specs/options-redesign.spec.md
 */

import { type ReactNode } from "react";
import { Check, RotateCcw, TriangleAlert } from "lucide-react";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { i18n } from "#i18n";

/** `"saving" | "saved" | "error" | null` — see SettingControl. */
export type SaveStatus = "saving" | "saved" | "error" | null;

export function SettingRow({
  title,
  description,
  children,
  onReset,
  canReset = false,
  status = null,
  testId,
  className,
}: {
  title: string;
  description?: string;
  /** The control. Always the last element in the right-hand column. */
  children: ReactNode;
  /** When provided, a reset-to-default button renders beside the control. */
  onReset?: () => void;
  /** Whether the current value differs from the shipped default. */
  canReset?: boolean;
  /**
   * Result of the last write.
   *
   * Settings apply instantly, so a failed write is otherwise invisible: the
   * control flips, storage does not, and nothing tells the user their change
   * was lost. This puts it in the row.
   */
  status?: SaveStatus;
  testId?: string;
  className?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex min-h-11 items-center gap-6 border-b border-border/70 py-3",
        "last:border-b-0",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {description}
          </p>
        )}
        {status === "error" && (
          <p
            role="alert"
            data-testid={testId ? `${testId}-error` : undefined}
            className="mt-1 flex items-center gap-1 text-xs text-destructive"
          >
            <Icon icon={TriangleAlert} className="size-3" />
            {i18n.t("options.row.saveFailed")}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2">
        {/* Announced politely rather than focused: a confirmation that steals
            focus mid-edit is worse than no confirmation. */}
        <span
          role="status"
          aria-live="polite"
          className="w-4 shrink-0 text-muted-foreground"
        >
          {status === "saved" && <Icon icon={Check} className="size-3.5" />}
        </span>

        {onReset && (
          <button
            type="button"
            onClick={onReset}
            disabled={!canReset}
            aria-label={i18n.t("options.row.resetToDefault")}
            title={i18n.t("options.row.resetToDefault")}
            data-testid={testId ? `${testId}-reset` : undefined}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
              "hover:bg-accent hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              // Hidden rather than merely transparent when there is nothing to
              // reset, so it never takes a tab stop while invisible.
              "disabled:pointer-events-none disabled:hidden"
            )}
          >
            <Icon icon={RotateCcw} />
          </button>
        )}
        <div className="flex w-[11rem] items-center justify-end">
          {children}
        </div>
      </div>
    </div>
  );
}