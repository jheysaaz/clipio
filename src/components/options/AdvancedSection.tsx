import { useState, useEffect, useRef } from "react";
import { Cloud, HardDrive, Loader2, Bug, Copy, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { InlineError } from "@/components/ui/inline-error";
import {
  getStorageStatus,
  clearIDBBackup,
  forceSetStorageMode,
} from "@/storage";
import type { StorageMode } from "@/storage";
import {
  SYNC_QUOTA,
  CONTENT_SCRIPT_PING_MESSAGE_TYPE,
} from "@/config/constants";
import {
  giphyApiKeyItem,
  latestVersionItem,
  dismissedUpdateVersionItem,
  debugModeItem,
  debugLogItem,
  typingTimeoutItem,
  type DebugLogEntry,
} from "@/storage/items";
import { TIMING } from "@/config/constants";
import { i18n } from "#i18n";
import { captureError, captureMessage } from "@/lib/sentry";
import { SENTRY_TEST_MESSAGE_TYPE } from "@/config/constants";
import { setReviewPromptState } from "@/lib/review-prompt";
import { toast } from "sonner";

function normalizeDebugEntries(entries: DebugLogEntry[]): DebugLogEntry[] {
  return entries
    .filter(
      (e): e is DebugLogEntry =>
        e != null && typeof e === "object" && typeof e.ts === "number"
    )
    .map((e) => ({
      ts: e.ts,
      context:
        typeof e.context === "string" &&
        ["content", "background", "storage"].includes(e.context)
          ? (e.context as DebugLogEntry["context"])
          : "content",
      event: typeof e.event === "string" ? e.event : JSON.stringify(e.event),
      detail:
        typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail),
    }));
}

export function AdvancedSection() {
  const [giphyKey, setGiphyKey] = useState("");
  const [giphyKeyError, setGiphyKeyError] = useState<string | null>(null);

  const [pingStatus, setPingStatus] = useState<"idle" | "pinging">("idle");
  const [pingError, setPingError] = useState("");

  const [storageMode, setStorageMode] = useState<StorageMode>("sync");
  const [syncUsed, setSyncUsed] = useState<number | null>(null);
  const [switchConfirming, setSwitchConfirming] = useState<StorageMode | null>(
    null
  );
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const [debugEnabled, setDebugEnabled] = useState(false);
  const [debugLog, setDebugLog] = useState<DebugLogEntry[]>([]);
  const debugLogRef = useRef<HTMLDivElement>(null);

  const [clearConfirming, setClearConfirming] = useState(false);

  useEffect(() => {
    giphyApiKeyItem
      .getValue()
      .then((val) => setGiphyKey(val ?? ""))
      .catch(console.warn);
  }, []);

  useEffect(() => {
    getStorageStatus()
      .then((status) => {
        setStorageMode(status.mode);
      })
      .catch(console.warn);
    browser.storage.sync
      .get(null)
      .then((items) => {
        const bytes = Object.entries(items).reduce((sum, [k, v]) => {
          return sum + new Blob([JSON.stringify(k) + JSON.stringify(v)]).size;
        }, 0);
        setSyncUsed(bytes);
      })
      .catch(console.warn);
  }, []);

  useEffect(() => {
    debugModeItem
      .getValue()
      .then((val) => setDebugEnabled(val))
      .catch(console.warn);
    debugLogItem
      .getValue()
      .then((entries) => {
        const normalized = normalizeDebugEntries(entries);
        setDebugLog(normalized);
        if (normalized.some((e, i) => e.detail !== entries[i]?.detail)) {
          debugLogItem.setValue(normalized).catch(() => {});
        }
      })
      .catch(console.warn);

    const unwatch = debugLogItem.watch((entries) => {
      setDebugLog(normalizeDebugEntries(entries));
    });
    return () => {
      unwatch();
    };
  }, []);

  useEffect(() => {
    if (debugLogRef.current) {
      debugLogRef.current.scrollTop = debugLogRef.current.scrollHeight;
    }
  }, [debugLog]);

  const handleSaveGiphyKey = async () => {
    try {
      await giphyApiKeyItem.setValue(giphyKey.trim());
      toast.success(i18n.t("options.developers.giphyApiKey.saved"));
    } catch (err) {
      captureError(err, { action: "saveGiphyApiKey" });
      setGiphyKeyError(
        err instanceof Error ? err.message : "Failed to save API key."
      );
    }
  };

  const handleResetGiphyKey = async () => {
    try {
      await giphyApiKeyItem.setValue("");
      setGiphyKey("");
      toast.success(i18n.t("options.developers.giphyApiKey.resetSuccess"));
    } catch (err) {
      captureError(err, { action: "resetGiphyApiKey" });
    }
  };

  const handleForceSwitch = async (target: StorageMode) => {
    setSwitching(true);
    setSwitchError(null);
    try {
      await forceSetStorageMode(target);
      setStorageMode(target);
      setSwitchConfirming(null);
      toast.success(i18n.t("options.developers.storageMode.switched"));
    } catch (err) {
      captureError(err, { action: "forceSetStorageMode", target });
      setSwitchError(i18n.t("options.developers.storageMode.switchError"));
      setSwitchConfirming(null);
    } finally {
      setSwitching(false);
    }
  };

  const handleDebugToggle = async () => {
    const next = !debugEnabled;
    setDebugEnabled(next);
    try {
      await debugModeItem.setValue(next);
    } catch (err) {
      captureError(err, { action: "setDebugMode" });
    }
  };

  const handleClearDebugLog = async () => {
    try {
      await debugLogItem.setValue([]);
      setDebugLog([]);
    } catch (err) {
      captureError(err, { action: "clearDebugLog" });
    }
  };

  const handleCopyDebugLog = async () => {
    if (debugLog.length === 0) return;
    const text = debugLog
      .map((e) => {
        const time = new Date(e.ts).toISOString();
        return `[${time}] [${e.context}] ${e.event} ${e.detail}`;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(i18n.t("options.developers.debugMode.copiedLog"));
    } catch (err) {
      captureError(err, { action: "copyDebugLog" });
      toast.error(i18n.t("options.developers.debugMode.copyFailed"));
    }
  };

  const handlePing = async () => {
    setPingStatus("pinging");
    setPingError("");
    try {
      const allTabs = await browser.tabs.query({});
      const tab = allTabs.find(
        (t) =>
          t.id !== undefined &&
          t.url &&
          !t.url.startsWith("chrome://") &&
          !t.url.startsWith("chrome-extension://") &&
          !t.url.startsWith("about:") &&
          !t.url.startsWith("edge://") &&
          !t.url.startsWith("moz-extension://")
      );
      if (!tab?.id) {
        setPingStatus("idle");
        toast.error(
          i18n.t("options.developers.contentScriptHealth.errorNoTab")
        );
        return;
      }
      const response = await browser.tabs
        .sendMessage(tab.id, { type: CONTENT_SCRIPT_PING_MESSAGE_TYPE })
        .catch(() => null);
      if (response && (response as { pong?: boolean }).pong) {
        setPingStatus("idle");
        toast.success(i18n.t("options.developers.contentScriptHealth.pong"));
      } else {
        setPingStatus("idle");
        toast.error(
          i18n.t("options.developers.contentScriptHealth.errorNoContentScript")
        );
      }
    } catch {
      setPingStatus("idle");
      toast.error(
        i18n.t("options.developers.contentScriptHealth.errorGeneric")
      );
    }
  };

  const handleClearIdb = async () => {
    try {
      await clearIDBBackup();
      setClearConfirming(false);
      toast.success(i18n.t("options.developers.clearIdb.cleared"));
    } catch (err) {
      captureError(err, { action: "clearIDBBackup" });
      setClearConfirming(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">
          {i18n.t("options.developers.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {i18n.t("options.developers.description")}
        </p>
      </div>

      <div className="flex gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-400">
        <span className="mt-px shrink-0 text-base leading-none">⚠</span>
        <span>{i18n.t("options.developers.experimentalWarning")}</span>
      </div>

      {/* Giphy API Key card */}
      <div className="rounded-xl border p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            {i18n.t("options.developers.giphyApiKey.title")}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {i18n.t("options.developers.giphyApiKey.description")}
          </p>
        </div>

        <div className="flex gap-2">
          <Input
            type="password"
            placeholder={i18n.t("options.developers.giphyApiKey.placeholder")}
            value={giphyKey}
            onChange={(e) => {
              setGiphyKey(e.target.value);
              setGiphyKeyError(null);
            }}
            className="flex-1 font-mono text-sm h-9"
          />
          <Button
            size="sm"
            onClick={handleSaveGiphyKey}
            className="shrink-0 h-9"
          >
            {i18n.t("common.save")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleResetGiphyKey}
            className="shrink-0 h-9"
          >
            {i18n.t("options.developers.giphyApiKey.reset")}
          </Button>
        </div>

        {giphyKeyError && (
          <InlineError
            message={giphyKeyError}
            onDismiss={() => setGiphyKeyError(null)}
            className="rounded-lg border border-red-200 dark:border-red-800"
          />
        )}
      </div>

      {/* Content Script Health */}
      <div className="rounded-xl border p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            {i18n.t("options.developers.contentScriptHealth.title")}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {i18n.t("options.developers.contentScriptHealth.description")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            className="h-9 shrink-0"
            onClick={handlePing}
            disabled={pingStatus === "pinging"}
          >
            {pingStatus === "pinging" ? (
              <>
                <Loader2
                  className="h-3.5 w-3.5 mr-1.5 animate-spin"
                  strokeWidth={1.5}
                />
                {i18n.t("options.developers.contentScriptHealth.pinging")}
              </>
            ) : (
              i18n.t("options.developers.contentScriptHealth.pingButton")
            )}
          </Button>
        </div>
      </div>

      {/* Storage Mode & Quota */}
      <div className="rounded-xl border p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            {i18n.t("options.developers.storageMode.title")}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {i18n.t("options.developers.storageMode.description")}
          </p>
        </div>
        <p className="text-sm text-foreground">
          {i18n.t("options.developers.storageMode.mode", [storageMode])}
        </p>
        {syncUsed !== null && (
          <p className="text-xs text-muted-foreground">
            {i18n.t("options.developers.storageMode.syncUsed", [
              String(syncUsed),
              String(SYNC_QUOTA.TOTAL_BYTES),
            ])}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {switchConfirming ? (
            <>
              <Button
                size="sm"
                variant="destructive"
                className="h-9 shrink-0"
                disabled={switching}
                onClick={() => handleForceSwitch(switchConfirming)}
              >
                {switching
                  ? i18n.t("options.developers.storageMode.switching")
                  : switchConfirming === "local"
                    ? i18n.t(
                        "options.developers.storageMode.confirmSwitchToLocal"
                      )
                    : i18n.t(
                        "options.developers.storageMode.confirmSwitchToSync"
                      )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-9 shrink-0"
                disabled={switching}
                onClick={() => setSwitchConfirming(null)}
              >
                {i18n.t("common.cancel")}
              </Button>
            </>
          ) : (
            <>
              {storageMode !== "sync" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 shrink-0"
                  onClick={() => setSwitchConfirming("sync")}
                >
                  <Cloud className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                  {i18n.t("options.developers.storageMode.switchToSync")}
                </Button>
              )}
              {storageMode !== "local" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 shrink-0"
                  onClick={() => setSwitchConfirming("local")}
                >
                  <HardDrive className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                  {i18n.t("options.developers.storageMode.switchToLocal")}
                </Button>
              )}
            </>
          )}
        </div>
        {switchError && (
          <p className="text-xs text-destructive">{switchError}</p>
        )}
      </div>

      {/* Debug Mode */}
      <div className="rounded-xl border p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <Bug className="h-4 w-4" strokeWidth={1.5} />
              {i18n.t("options.developers.debugMode.title")}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {i18n.t("options.developers.debugMode.description")}
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={debugEnabled}
              onChange={handleDebugToggle}
              aria-label={i18n.t("options.developers.debugMode.toggle")}
            />
            <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary" />
          </label>
        </div>

        {debugEnabled && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {i18n.t("options.developers.debugMode.toggle")}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={handleCopyDebugLog}
                  disabled={debugLog.length === 0}
                  title={i18n.t("options.developers.debugMode.copyLog")}
                >
                  <>
                    <Copy className="h-3 w-3 mr-1" strokeWidth={1.5} />
                    {i18n.t("options.developers.debugMode.copyLog")}
                  </>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={handleClearDebugLog}
                  disabled={debugLog.length === 0}
                >
                  {i18n.t("options.developers.debugMode.clearLog")}
                </Button>
              </div>
            </div>

            <div
              ref={debugLogRef}
              className="h-48 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 space-y-1 font-mono text-xs"
            >
              {debugLog.length === 0 ? (
                <p className="text-muted-foreground py-2 text-center">
                  {i18n.t("options.developers.debugMode.emptyLog")}
                </p>
              ) : (
                debugLog.map((entry, i) => {
                  const time = new Date(entry.ts).toTimeString().slice(0, 12);
                  const ctxColor =
                    entry.context === "content"
                      ? "text-blue-500"
                      : entry.context === "background"
                        ? "text-purple-500"
                        : "text-amber-500";
                  return (
                    <div key={i} className="flex gap-2 leading-5">
                      <span className="shrink-0 text-muted-foreground">
                        {time}
                      </span>
                      <span className={cn("shrink-0 font-semibold", ctxColor)}>
                        [{entry.context}]
                      </span>
                      <span className="shrink-0 text-foreground">
                        {entry.event}
                      </span>
                      <span className="truncate text-muted-foreground">
                        {typeof entry.detail === "string"
                          ? entry.detail
                          : JSON.stringify(entry.detail)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Clear IDB Backup */}
      <div className="rounded-xl border p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            {i18n.t("options.developers.clearIdb.title")}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {i18n.t("options.developers.clearIdb.description")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {clearConfirming ? (
            <>
              <Button
                size="sm"
                variant="destructive"
                className="h-9 shrink-0"
                onClick={handleClearIdb}
              >
                {i18n.t("options.developers.clearIdb.confirm")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-9 shrink-0"
                onClick={() => setClearConfirming(false)}
              >
                {i18n.t("common.cancel")}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-9 shrink-0"
              onClick={() => setClearConfirming(true)}
            >
              {i18n.t("options.developers.clearIdb.button")}
            </Button>
          )}
        </div>
      </div>

      {/* Dev only: Test review prompt */}
      {(import.meta.env.MODE as string) !== "production" && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-6 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            Development – Test Review Prompt
          </h3>
          <p className="text-xs text-muted-foreground">
            Simulate the full review prompt flow — fires the real browser
            notification and transitions state to "shown". Only visible in
            development.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                await setReviewPromptState("shown");
                browser.notifications.create("clipio-review", {
                  type: "basic",
                  iconUrl: browser.runtime.getURL("/icon/128.png"),
                  title: i18n.t("background.reviewPrompt.title"),
                  message: i18n.t("background.reviewPrompt.message"),
                });
              }}
            >
              Simulate notification
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                await setReviewPromptState("pending");
              }}
            >
              Reset to pending
            </Button>
          </div>
        </div>
      )}

      {/* Dev only: Test Sentry */}
      {(import.meta.env.MODE as string) !== "production" && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-6 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            Development – Test Sentry
          </h3>
          <p className="text-xs text-muted-foreground">
            Send test events to Sentry to verify capture in each context. Only
            visible in development.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                captureError(
                  new Error("Clipio Sentry test exception (options)")
                );
              }}
            >
              Send test exception (options)
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                captureMessage("Clipio Sentry test message (options)", "info");
              }}
            >
              Send test message (options)
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  const tabs = await browser.tabs.query({
                    url: ["http://*/*", "https://*/*"],
                  });
                  for (const tab of tabs) {
                    if (tab.id == null) continue;
                    try {
                      await browser.tabs.sendMessage(tab.id, {
                        type: SENTRY_TEST_MESSAGE_TYPE,
                      });
                      return;
                    } catch {}
                  }
                  captureMessage(
                    "No tab with content script found. Open a regular webpage and try again.",
                    "warning"
                  );
                } catch (err) {
                  captureError(err, { action: "sentryTestContentScript" });
                }
              }}
            >
              Trigger test in content script
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Or on any webpage: press{" "}
            {navigator.platform.toLowerCase().includes("mac")
              ? "Cmd+Shift+E"
              : "Ctrl+Shift+E"}{" "}
            to send a test from the content script (dev only). Check the console
            for confirmation.
          </p>
        </div>
      )}
    </div>
  );
}
