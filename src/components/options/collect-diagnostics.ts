/**
 * Browser-facing side of the Diagnostics snapshot.
 *
 * Every source is read independently: a storage quota error, a revoked tabs
 * permission or a corrupt log entry should degrade one line of the report, not
 * blank the whole panel. Failures are recorded by source name and surface both
 * in the UI and in `## Collection warnings` of the exported report.
 */

import {
  getBackupInfo,
  getSnippets,
  getStorageStatus,
  storageManager,
} from "@/storage";
import {
  cachedSnippetsItem,
  debugLogItem,
  debugModeItem,
  giphyApiKeyItem,
  lastSentryErrorAtItem,
  syncDataLostItem,
} from "@/storage/items";
import { MESSAGE, sendMessage } from "@/lib/protocol";
import {
  buildDiagnosticsSnapshot,
  isDiagnosableTab,
  tabHost,
  type DiagnosticsSnapshot,
  type TabHealth,
} from "@/lib/diagnostics";

type SourceErrors = Record<string, string>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readSource<T>(
  source: string,
  errors: SourceErrors,
  fallback: T,
  read: () => Promise<T>
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    errors[source] = errorMessage(error);
    return fallback;
  }
}

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

async function collectTabHealth(errors: SourceErrors): Promise<TabHealth> {
  try {
    const tabs = await browser.tabs.query({});
    const eligible = tabs.filter((tab) => isDiagnosableTab(tab));

    const checks = await Promise.all(
      eligible.map(async (tab) => {
        // `isDiagnosableTab` narrows these at runtime; the browser's Tab type
        // keeps them optional because tabs without a url or id do exist.
        const tabId = tab.id as number;
        const url = tab.url as string;
        const alive = await sendMessage(MESSAGE.CONTENT_PING, undefined, tabId)
          .then(() => true)
          .catch(() => false);
        return { tabId, host: tabHost(url), alive };
      })
    );

    const active = checks.filter((check) => check.alive).length;
    return {
      eligible: eligible.length,
      active,
      missing: eligible.length - active,
      entries: checks,
    };
  } catch (error) {
    const message = errorMessage(error);
    errors.tabs = message;
    return {
      eligible: 0,
      active: 0,
      missing: 0,
      entries: [],
      error: message,
    };
  }
}

/**
 * Gather a snapshot. `generatedAt` is injectable so a test can assert on it
 * without depending on the clock; production uses the current time.
 */
export async function collectDiagnostics(
  generatedAt: string = new Date().toISOString()
): Promise<DiagnosticsSnapshot> {
  const errors: SourceErrors = {};

  const [
    status,
    snippets,
    cached,
    backup,
    corruptKeys,
    syncDataLost,
    lastError,
    apiKey,
    debugMode,
    log,
    version,
    tabs,
  ] = await Promise.all([
    readSource(
      "storageStatus",
      errors,
      {
        mode: "sync" as const,
        quotaExceeded: false,
        localReason: "quota" as const,
      },
      () => getStorageStatus()
    ),
    readSource("snippets", errors, [] as unknown[], () => getSnippets()),
    readSource("cachedSnippets", errors, [] as unknown[], () =>
      cachedSnippetsItem.getValue()
    ),
    readSource("backup", errors, { snippetCount: 0 }, () => getBackupInfo()),
    readSource("corruptKeys", errors, [] as string[], () =>
      storageManager.listCorruptKeys()
    ),
    readSource("syncDataLost", errors, false, () =>
      syncDataLostItem.getValue()
    ),
    readSource("lastSentryErrorAt", errors, null as string | null, () =>
      lastSentryErrorAtItem.getValue()
    ),
    readSource("giphyApiKey", errors, "", () => giphyApiKeyItem.getValue()),
    readSource("debugMode", errors, false, () => debugModeItem.getValue()),
    readSource("debugLog", errors, [] as unknown[], () =>
      debugLogItem.getValue()
    ),
    readSource(
      "version",
      errors,
      "unknown",
      async () => browser.runtime.getManifest().version ?? "unknown"
    ),
    collectTabHealth(errors),
  ]);

  return buildDiagnosticsSnapshot({
    generatedAt,
    version,
    storage: {
      mode: status.mode,
      quotaExceeded: status.quotaExceeded,
      localReason: status.localReason,
      snippetCount: countOf(snippets),
      cachedSnippetCount: countOf(cached),
      backupSnippetCount: backup.snippetCount,
      corruptKeys,
      syncDataLost,
      lastSentryErrorAt: lastError,
      // The key itself never enters the snapshot, only whether one is set.
      customGiphyKey: apiKey.trim().length > 0,
    },
    debugMode,
    log,
    tabs,
    errors,
  });
}
