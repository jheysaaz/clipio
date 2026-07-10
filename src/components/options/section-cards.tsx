import { FileText, Cloud, HardDrive, ImageIcon } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { useStorageStats } from "./useStorageStats";
import { SYNC_QUOTA } from "@/config/constants";

export function SectionCards() {
  const stats = useStorageStats();

  const syncKB = (stats.syncBytesUsed / 1024).toFixed(1);
  const syncTotalKB = (SYNC_QUOTA.TOTAL_BYTES / 1024).toFixed(0);
  const syncPercent = Math.min(
    100,
    Math.round((stats.syncBytesUsed / SYNC_QUOTA.TOTAL_BYTES) * 100)
  );
  const localKB = (stats.localEstimatedBytes / 1024).toFixed(1);
  const localPercent = Math.min(
    100,
    Math.round((stats.localEstimatedBytes / (5 * 1024 * 1024)) * 100)
  );

  if (stats.loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-xl border bg-card p-4">
            <div className="mb-2 h-3 w-20 rounded bg-muted-foreground/20" />
            <div className="mb-1 h-7 w-16 rounded bg-muted-foreground/20" />
            <div className="h-2 w-24 rounded bg-muted-foreground/20" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border bg-card p-4 text-card-foreground shadow-xs">
        <div className="flex items-center gap-2">
          <FileText
            className="size-4 text-muted-foreground"
            strokeWidth={1.5}
          />
          <span className="text-xs font-medium text-muted-foreground">
            Snippets
          </span>
        </div>
        <p className="mt-2 text-2xl font-bold">{stats.snippetCount}</p>
        <p className="mt-1 text-xs text-muted-foreground">Total snippets</p>
      </div>

      <div className="rounded-xl border bg-card p-4 text-card-foreground shadow-xs">
        <div className="flex items-center gap-2">
          <Cloud className="size-4 text-muted-foreground" strokeWidth={1.5} />
          <span className="text-xs font-medium text-muted-foreground">
            Sync Storage
          </span>
        </div>
        <p className="mt-2 text-2xl font-bold">{syncKB} KB</p>
        <p className="mt-1 text-xs text-muted-foreground">
          of {syncTotalKB} KB
        </p>
        <div className="mt-2">
          <Progress value={syncPercent} />
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4 text-card-foreground shadow-xs">
        <div className="flex items-center gap-2">
          <HardDrive
            className="size-4 text-muted-foreground"
            strokeWidth={1.5}
          />
          <span className="text-xs font-medium text-muted-foreground">
            Local Storage
          </span>
        </div>
        <p className="mt-2 text-2xl font-bold">{localKB} KB</p>
        <p className="mt-1 text-xs text-muted-foreground">estimated</p>
        <div className="mt-2">
          <Progress value={localPercent} />
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4 text-card-foreground shadow-xs">
        <div className="flex items-center gap-2">
          <ImageIcon
            className="size-4 text-muted-foreground"
            strokeWidth={1.5}
          />
          <span className="text-xs font-medium text-muted-foreground">
            Storage Mode
          </span>
        </div>
        <p className="mt-2 text-2xl font-bold capitalize">{stats.mode}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {stats.mode === "local"
            ? `Fallback (${stats.localReason})`
            : "Sync across devices"}
        </p>
      </div>
    </div>
  );
}
