import { useState, useEffect } from "react";
import { getSnippets, getStorageStatus } from "@/storage";

export interface StorageStats {
  snippetCount: number;
  syncBytesUsed: number;
  localEstimatedBytes: number;
  mode: "sync" | "local";
  localReason: "quota" | "manual";
  loading: boolean;
}

export function useStorageStats(): StorageStats {
  const [stats, setStats] = useState<StorageStats>({
    snippetCount: 0,
    syncBytesUsed: 0,
    localEstimatedBytes: 0,
    mode: "sync",
    localReason: "quota",
    loading: true,
  });

  useEffect(() => {
    Promise.all([
      getSnippets(),
      getStorageStatus(),
      (browser.storage.sync.getBytesInUse as (keys: null) => Promise<number>)(
        null
      ).catch(() => 0),
    ])
      .then(([snippets, status, syncBytes]) => {
        setStats({
          snippetCount: snippets.length,
          syncBytesUsed: syncBytes,
          localEstimatedBytes: JSON.stringify(snippets).length,
          mode: status.mode,
          localReason: status.localReason,
          loading: false,
        });
      })
      .catch(() => setStats((s) => ({ ...s, loading: false })));
  }, []);

  return stats;
}
