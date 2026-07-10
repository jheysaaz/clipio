import { useState, useEffect } from "react";
import { Cloud, HardDrive, FileText, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { InlineError } from "@/components/ui/inline-error";
import { getSnippets } from "@/storage";
import { SYNC_QUOTA } from "@/config/constants";
import {
  latestVersionItem,
  dismissedUpdateVersionItem,
  usageCountsItem,
} from "@/storage/items";
import { i18n } from "#i18n";
import { captureError } from "@/lib/sentry";
import { InfoTooltip } from "./InfoTooltip";
import { useStorageStats } from "./useStorageStats";

export function DashboardSection() {
  const stats = useStorageStats();

  const syncPercent = Math.min(
    100,
    Math.round((stats.syncBytesUsed / SYNC_QUOTA.TOTAL_BYTES) * 100)
  );
  const syncWarnPercent = Math.round(
    (SYNC_QUOTA.WARN_AT / SYNC_QUOTA.TOTAL_BYTES) * 100
  );
  const syncKB = (stats.syncBytesUsed / 1024).toFixed(1);
  const syncTotalKB = (SYNC_QUOTA.TOTAL_BYTES / 1024).toFixed(0);
  const localKB = (stats.localEstimatedBytes / 1024).toFixed(1);
  const localPercent = Math.min(
    100,
    Math.round((stats.localEstimatedBytes / (5 * 1024 * 1024)) * 100)
  );

  // Version & Update
  const [currentVersion] = useState(
    () => browser.runtime.getManifest().version
  );
  const [latestRelease, setLatestRelease] = useState<{
    version: string;
    htmlUrl: string;
    publishedAt: string;
  } | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState("");

  useEffect(() => {
    latestVersionItem
      .getValue()
      .then((v) => setLatestRelease(v))
      .catch(console.warn);
    dismissedUpdateVersionItem
      .getValue()
      .then((v) => setDismissedVersion(v))
      .catch(console.warn);
  }, []);

  // Top 5 Usage
  const [topUsage, setTopUsage] = useState<
    { id: string; label: string; shortcut: string; count: number }[]
  >([]);
  const [usageLoaded, setUsageLoaded] = useState(false);

  useEffect(() => {
    Promise.all([usageCountsItem.getValue(), getSnippets()])
      .then(([counts, snippets]) => {
        const entries = Object.entries(counts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([id, count]) => {
            const snippet = snippets.find((s) => s.id === id);
            return {
              id,
              label: snippet?.label ?? snippet?.shortcut ?? id,
              shortcut: snippet?.shortcut ?? "",
              count,
            };
          });
        setTopUsage(entries);
        setUsageLoaded(true);
      })
      .catch(console.warn);
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">
          {i18n.t("options.overview.title")}
        </h2>
        <p className="text-sm text-muted-foreground mb-5">
          {i18n.t("options.overview.description")}
        </p>

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="rounded-xl border p-4 space-y-1">
            <div className="flex items-center gap-1.5">
              <FileText
                className="h-3.5 w-3.5 text-muted-foreground"
                strokeWidth={1.5}
              />
              <span className="text-xs text-muted-foreground">
                {i18n.t("options.overview.snippets")}
              </span>
            </div>
            <p className="text-2xl font-semibold text-foreground tabular-nums">
              {stats.loading ? "—" : stats.snippetCount}
            </p>
            <p className="text-[10px] text-muted-foreground tabular-nums">
              {stats.loading
                ? ""
                : i18n.t("options.overview.snippetsMax", [
                    SYNC_QUOTA.MAX_ITEMS,
                  ])}
            </p>
          </div>

          <div className="col-span-2 rounded-xl border p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Cloud
                  className="h-3.5 w-3.5 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <span className="text-xs text-muted-foreground">
                  {i18n.t("options.overview.syncStorage")}
                </span>
                <InfoTooltip text={i18n.t("options.overview.syncTooltip")} />
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">
                {stats.loading ? "—" : `${syncKB} / ${syncTotalKB} KB`}
              </span>
            </div>
            <Progress
              value={stats.loading ? 0 : syncPercent}
              className={cn(
                syncPercent >= syncWarnPercent
                  ? "[&>div]:bg-amber-500"
                  : "[&>div]:bg-indigo-500 dark:[&>div]:bg-indigo-400"
              )}
            />
            {stats.mode === "local" && stats.localReason === "quota" && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                {i18n.t("options.overview.quotaExceeded")}
              </p>
            )}
            {stats.mode === "local" && stats.localReason === "manual" && (
              <p className="text-[11px] text-muted-foreground">
                {i18n.t("dashboard.warnings.syncPaused.body")}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <HardDrive
                className="h-3.5 w-3.5 text-muted-foreground"
                strokeWidth={1.5}
              />
              <span className="text-xs text-muted-foreground">
                {i18n.t("options.overview.localStorage")}
              </span>
              <InfoTooltip text={i18n.t("options.overview.localTooltip")} />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {stats.loading ? "—" : `~${localKB} KB`}
            </span>
          </div>
          <Progress
            value={stats.loading ? 0 : localPercent}
            className="[&>div]:bg-muted-foreground"
          />
        </div>
      </div>

      <div className="border-t" />

      {/* Version info */}
      <div className="rounded-xl border p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Extension Version
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Current installed version and available updates.
          </p>
        </div>
        <p className="text-sm text-foreground">Version: {currentVersion}</p>
        {latestRelease && latestRelease.version !== dismissedVersion && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-amber-600 dark:text-amber-400">
              New version available: {latestRelease.version}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-9 shrink-0"
              onClick={() =>
                browser.tabs.create({ url: latestRelease.htmlUrl })
              }
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
              View release
            </Button>
          </div>
        )}
        {(!latestRelease || latestRelease.version === dismissedVersion) && (
          <p className="text-xs text-muted-foreground">Up to date</p>
        )}
      </div>

      {/* Top 5 Usage */}
      <div className="rounded-xl border p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">Top 5 Usage</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            The five most-used snippets by insertion count.
          </p>
        </div>
        {usageLoaded && topUsage.length === 0 && (
          <p className="text-xs text-muted-foreground">No usage data yet.</p>
        )}
        {topUsage.length > 0 && (
          <ul className="space-y-2">
            {topUsage.map(({ id, label, shortcut, count }) => (
              <li
                key={id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate text-sm text-foreground">
                    {label}
                  </span>
                  {shortcut && (
                    <span className="shrink-0 font-mono text-xs bg-muted text-muted-foreground rounded px-1.5 py-0.5 border border-border">
                      {shortcut}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {count} uses
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
