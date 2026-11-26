/**
 * `SettingRow` — the single primitive every preference renders through.
 *
 * Replaces the `rounded-xl border p-5` cards the options page used to stack.
 * Rows are separated by hairlines, carry a fixed-width control column so labels
 * never reflow as values change, and expose an optional reset affordance.
 *
 */

import { useEffect, type ReactNode } from "react";
import { Check, RotateCcw, TriangleAlert } from "lucide-react";

import { useFeedback } from "@/components/feedback/FeedbackProvider";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { i18n } from "#i18n";

/** `"saving" | "saved" | "error" | null` — see SettingControl. */
export type SaveStatus = "saving" | "saved" | "error" | null;

/** A half-open range to emphasise inside the row's title. */
export type HighlightRange = {
  start: number;
  end: number;
};

/**
 * Splits `text` around the given ranges so each hit can be wrapped in a `<mark>`.
 *
 * Ranges arrive from the search index as offsets into the *original* title
 * string, so they slice correctly even when the copy contains an accent — the
 * index tokenises the unfolded string precisely so this does not have to guess.
 *
 * Overlapping ranges are merged and out-of-order input is tolerated. Both are
 * cheap to normalise here and expensive to explain to every caller, and the
 * index can legitimately produce two hits inside one word when a query token
 * matches both a whole word and a camel-case part of it.
 *
 * Returns the plain string with no wrapper when there is nothing to highlight,
 * so the common case renders no extra elements at all.
 */
export function highlightParts(
  text: string,
  ranges: readonly HighlightRange[] | undefined
): ReactNode {
  if (!ranges || ranges.length === 0) return text;

  const sorted = [...ranges]
    .filter((r) => r.end > r.start && r.start >= 0 && r.end <= text.length)
    .sort((a, b) => a.start - b.start);

  // Merge overlaps and adjacency, so nested or duplicated hits do not produce
  // crossing <mark> elements.
  const merged: HighlightRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  if (merged.length === 0) return text;

  const parts: ReactNode[] = [];
  let cursor = 0;
  merged.forEach((range, i) => {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(
      <mark
        key={i}
        className="rounded-[0.1875rem] bg-primary/15 px-0.5 text-foreground"
      >
        {text.slice(range.start, range.end)}
      </mark>
    );
    cursor = range.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export function SettingRow({
  title,
  description,
  children,
  onReset,
  canReset = false,
  status = null,
  testId,
  className,
  highlight,
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
  /**
   * Ranges within `title` to emphasise.
   *
   * Only set for a row rendered inside search results, where the user needs to
   * see *why* a row matched. Section rows pass nothing and render as before.
   */
  highlight?: readonly HighlightRange[];
  testId?: string;
  className?: string;
}) {
  const { announce, announceError } = useFeedback();

  useEffect(() => {
    if (status === "error") {
      announceError(i18n.t("options.row.saveFailed"));
    } else if (status === "saved") {
      announce(i18n.t("options.row.saved"));
    }
  }, [status, announce, announceError]);

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
        <p className="text-sm font-medium text-foreground">
          {highlightParts(title, highlight)}
        </p>
        {description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {description}
          </p>
        )}
        {status === "error" && (
          <p
            data-testid={testId ? `${testId}-error` : undefined}
            className="mt-1 flex items-center gap-1 text-xs text-destructive"
          >
            <Icon icon={TriangleAlert} className="size-3" />
            {i18n.t("options.row.saveFailed")}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2">
        {/* Announced through the shared polite region rather than focused: a
            confirmation that steals focus mid-edit is worse than none. */}
        <span className="w-4 shrink-0 text-muted-foreground">
          {status === "saved" && (
            <span
              role="img"
              aria-label={i18n.t("options.row.saved")}
              title={i18n.t("options.row.saved")}
            >
              <Icon icon={Check} className="size-3.5" />
            </span>
          )}
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
