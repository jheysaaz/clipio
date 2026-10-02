/**
 * Storage — where snippets live and how much room is left.
 *
 * ## Why this is not two progress bars
 *
 * The previous version drew a sync quota bar and a local estimate bar side by
 * side. That had three problems:
 *
 * 1. **The colours implied a severity that does not exist.** An amber bar on a
 *    100 KB quota that holds ~100 short text snippets reads as "you are in
 *    trouble". It is not; a 90 KB warning on a text-only library fires almost
 *    immediately and then cries wolf forever.
 * 2. **The two bars were not comparable.** One was a hard browser limit, the
 *    other an estimate against a fictional 5 MB. Showing them with identical
 *    chrome invited reading them as the same kind of number.
 * 3. **Neither answered the user's actual question**, which is "is my library
 *    safe, and is it on all my devices?" — a mode question, not a bytes
 *    question.
 *
 * So this leads with the mode as a sentence, then reports bytes as a quiet
 * row of numbers. Colour is reserved for the one thing that genuinely warrants
 * attention: being close to the sync ceiling.
 *
 * spec: specs/options-redesign.spec.md
 */

import { Cloud, CloudOff, HardDrive, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Icon } from "@/components/ui/icon";
import { useStorageStats } from "@/components/options/useStorageStats";
import { SYNC_QUOTA } from "@/config/constants";
import { cn } from "@/lib/utils";
import { i18n } from "#i18n";

/** The local backend's effective ceiling, used only for a "room left" figure. */
const LOCAL_CEILING_BYTES = 5 * 1024 * 1024;

/**
 * Human-readable size that drops a pointless `.0`.
 *
 * The sync ceiling is exactly 100 KB, so `100.0 KB` reads as a measurement
 * rather than a limit; `100 KB` reads as one.
 */
function formatBytes(bytes: number): string {
  const kb = bytes / 1024;
  if (kb >= 1024) {
    const mb = kb / 1024;
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
  return `${Number.isInteger(kb) ? kb : kb.toFixed(1)} KB`;
}

export function StoragePanel() {
  const stats = useStorageStats();

  const syncUsed = stats.syncBytesUsed;
  const syncFree = Math.max(0, SYNC_QUOTA.TOTAL_BYTES - syncUsed);
  const syncPercent = Math.min(
    100,
    Math.round((syncUsed / SYNC_QUOTA.TOTAL_BYTES) * 100)
  );
  const syncWarnPercent = Math.round(
    (SYNC_QUOTA.WARN_AT / SYNC_QUOTA.TOTAL_BYTES) * 100
  );
  // Colour is spent only on genuinely running out of room.
  const syncTight = syncPercent >= syncWarnPercent;

  const snippetCount = stats.snippetCount;
  const onSync = stats.mode === "sync";

  const ModeIcon: LucideIcon = onSync ? Cloud : CloudOff;

  return (
    <div className="mb-6" data-testid="panel-storage">
      {/* ── The headline: a sentence, not a gauge ─────────────────────────── */}
      <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/30 p-4">
        <Icon
          icon={ModeIcon}
          className={cn(
            "mt-0.5 size-4 shrink-0",
            onSync ? "text-primary" : "text-amber-600 dark:text-amber-400"
          )}
        />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">
            {stats.loading
              ? "—"
              : onSync
                ? i18n.t("options.storage.syncingAcross", snippetCount)
                : i18n.t("options.storage.onlyHere", snippetCount)}
          </p>
          <p className="text-xs text-muted-foreground">
            {stats.loading
              ? ""
              : onSync
                ? i18n.t("options.storage.syncingHint")
                : stats.localReason === "quota"
                  ? i18n.t("options.storage.reasonQuota")
                  : i18n.t("options.storage.reasonManual")}
          </p>
        </div>
      </div>

      {/* ── Figures: right-aligned numbers, no competing bars ─────────────── */}
      <dl className="mt-3 divide-y divide-border/70">
        <StorageFigure
          icon={Cloud}
          label={i18n.t("options.overview.syncStorage")}
          testId="stat-sync-kb"
          loading={stats.loading}
          used={syncUsed}
          total={SYNC_QUOTA.TOTAL_BYTES}
          // One bar, for the one number with a real ceiling.
          percent={onSync ? syncPercent : null}
          tone={syncTight ? "warn" : "normal"}
        />
        <StorageFigure
          icon={HardDrive}
          label={i18n.t("options.overview.localStorage")}
          testId="stat-local-kb"
          loading={stats.loading}
          used={stats.localEstimatedBytes}
          total={LOCAL_CEILING_BYTES}
          // No bar: this is an estimate against a soft figure, so a bar would
          // overstate its precision.
          percent={null}
          tone="muted"
          estimated
        />
      </dl>

      {syncTight && !stats.loading && (
        <p className="mt-3 flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
          <Icon icon={TriangleAlert} className="mt-px size-3.5 shrink-0" />
          {i18n.t("options.storage.nearQuota", [formatBytes(syncFree)])}
        </p>
      )}
    </div>
  );
}

function StorageFigure({
  icon,
  label,
  testId,
  loading,
  used,
  total,
  percent,
  tone,
  estimated = false,
}: {
  icon: LucideIcon;
  label: string;
  testId: string;
  loading: boolean;
  used: number;
  total: number;
  /** `null` renders no bar at all. */
  percent: number | null;
  tone: "normal" | "warn" | "muted";
  estimated?: boolean;
}) {
  const free = Math.max(0, total - used);

  return (
    <div className="flex items-center gap-3 py-2.5">
      <Icon icon={icon} className="size-3.5 shrink-0 text-muted-foreground" />
      <dt className="min-w-0 flex-1 text-xs text-muted-foreground">{label}</dt>

      {percent !== null && !loading && percent > 0 && (
        <div
          // Decorative: the same figure is stated numerically beside it, and a
          // second progressbar for the same value would be noise to a screen
          // reader. Hidden at 0% so an empty library shows no empty track.
          aria-hidden="true"
          className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width]",
              tone === "warn" ? "bg-amber-500" : "bg-primary"
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      <dd
        data-testid={testId}
        className="w-28 shrink-0 text-right text-xs tabular-nums text-foreground"
      >
        {loading
          ? "—"
          : (() => {
              const usedText = formatBytes(used);
              // The `~` marks an estimate. It is noise once the estimate
              // rounds to zero — `~0.0 KB` on an empty library claims a
              // precision the number does not have.
              const prefix = estimated && usedText !== "0 KB" ? "~" : "";
              return `${prefix}${usedText}${
                percent !== null ? ` / ${formatBytes(total)}` : ""
              }`;
            })()}
      </dd>

      {!loading && (
        <dd className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {i18n.t("options.storage.roomLeft", [formatBytes(free)])}
        </dd>
      )}
    </div>
  );
}
