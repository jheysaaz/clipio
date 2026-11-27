/**
 * The debug log, rendered below the "Debug logging" switch that controls it.
 *
 * Renders nothing at all while logging is off, rather than an empty 192px box:
 * a log viewer you have not enabled is noise, and the box was previously
 * rendered above its own switch.
 *
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Trash2 } from "lucide-react";

import { useFeedback } from "@/components/feedback/FeedbackProvider";
import { useControlConfirmation } from "@/components/feedback/use-control-confirmation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  debugLogItem,
  debugModeItem,
  type DebugLogEntry,
} from "@/storage/items";
import {
  filterLogEntries,
  normaliseLogEntries,
  summarizeLog,
  type DiagnosticContext,
} from "@/lib/diagnostics";
import { captureError } from "@/lib/sentry";
import { cn } from "@/lib/utils";
import { i18n } from "#i18n";

export function DebugLogPanel() {
  const [enabled, setEnabled] = useState(false);
  const [log, setLog] = useState<DebugLogEntry[]>([]);
  const [context, setContext] = useState<DiagnosticContext | "all">("all");
  const [query, setQuery] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const { confirmed, show, reset } = useControlConfirmation();
  const { announce, showBanner, dismissBanner } = useFeedback();

  useEffect(() => {
    debugModeItem
      .getValue()
      .then((v) => setEnabled(v === true))
      .catch(console.warn);
    const unwatchMode = debugModeItem.watch((v) => setEnabled(v === true));
    return () => unwatchMode();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    debugLogItem
      .getValue()
      .then((entries) => {
        if (cancelled) return;
        setLog(normaliseLogEntries(entries));
      })
      .catch(console.warn);

    const unwatch = debugLogItem.watch((entries) => {
      if (!cancelled) setLog(normaliseLogEntries(entries));
    });
    return () => {
      cancelled = true;
      unwatch();
    };
  }, [enabled]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  const filtered = useMemo(
    () => filterLogEntries(log, { context, query }),
    [log, context, query]
  );
  const summary = useMemo(() => summarizeLog(log), [log]);

  const copyLog = async () => {
    if (log.length === 0) return;
    const text = log
      .map(
        (e) =>
          `[${new Date(e.ts).toISOString()}] [${e.context}] ${e.event} ${e.detail}`
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      const message = i18n.t("options.developers.debugMode.copiedLog");
      show();
      announce(message);
      dismissBanner("debug-copy", { runOnDismiss: false });
    } catch (err) {
      captureError(err, { action: "copyDebugLog" });
      reset();
      showBanner({
        source: "debug-copy",
        scope: "diagnostics",
        severity: "error",
        message: i18n.t("options.developers.debugMode.copyFailed"),
      });
    }
  };

  const clearLog = async () => {
    try {
      await debugLogItem.setValue([]);
      setLog([]);
    } catch (err) {
      captureError(err, { action: "clearDebugLog" });
    }
  };

  if (!enabled) return null;

  return (
    <div className="mt-6" data-testid="panel-debug-log">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          {i18n.t("options.developers.debugMode.logHeading")}
        </p>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={copyLog}
            disabled={log.length === 0}
            aria-pressed={confirmed}
          >
            <Icon icon={confirmed ? Check : Copy} className="mr-1" />
            {confirmed
              ? i18n.t("options.developers.debugMode.copiedLog")
              : i18n.t("options.developers.debugMode.copyLog")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={clearLog}
            disabled={log.length === 0}
          >
            <Icon icon={Trash2} className="mr-1" />
            {i18n.t("options.developers.debugMode.clearLog")}
          </Button>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="debug-log-context-filter"
            className="text-xs text-muted-foreground"
          >
            {i18n.t("options.developers.debugMode.filterLabel")}
          </label>
          <select
            id="debug-log-context-filter"
            data-testid="debug-log-context-filter"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            value={context}
            onChange={(event) =>
              setContext(event.target.value as DiagnosticContext | "all")
            }
          >
            <option value="all">
              {i18n.t("options.developers.debugMode.allContexts")}
            </option>
            <option value="content">
              {i18n.t("options.developers.debugMode.contentContext")}
            </option>
            <option value="background">
              {i18n.t("options.developers.debugMode.backgroundContext")}
            </option>
            <option value="storage">
              {i18n.t("options.developers.debugMode.storageContext")}
            </option>
          </select>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="debug-log-search" className="sr-only">
            {i18n.t("options.developers.debugMode.searchLabel")}
          </label>
          <input
            id="debug-log-search"
            data-testid="debug-log-search"
            type="search"
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            placeholder={i18n.t(
              "options.developers.debugMode.searchPlaceholder"
            )}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div
        className="mb-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground"
        data-testid="debug-log-counts"
      >
        <span>
          {i18n.t("options.developers.debugMode.countsHeading")}: content=
          {summary.content}, background={summary.background}, storage=
          {summary.storage}
        </span>
        <span>
          {i18n.t("options.developers.debugMode.suspiciousCount")}:{" "}
          {summary.suspicious}
        </span>
        <span>
          {i18n.t("options.developers.debugMode.showingCount", [
            filtered.length,
            log.length,
          ])}
        </span>
      </div>

      {/* `[font-variant-ligatures:none]`: the log prints tokens like `->`,
          `!=` and `/*` where a programming ligature fuses two characters and
          misrepresents what was actually recorded. */}
      <div
        ref={logRef}
        data-testid="debug-log"
        className="max-h-64 min-h-24 space-y-1 overflow-y-auto rounded-lg border border-border bg-muted/30 p-2 font-mono text-xs [font-variant-ligatures:none]"
      >
        {log.length === 0 ? (
          <p className="py-2 text-center font-sans text-muted-foreground">
            {i18n.t("options.developers.debugMode.emptyLog")}
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-2 text-center font-sans text-muted-foreground">
            {i18n.t("options.developers.debugMode.noMatches")}
          </p>
        ) : (
          filtered.map((entry, i) => (
            <div key={`${entry.ts}-${i}`} className="flex gap-2 leading-5">
              <span className="shrink-0 text-muted-foreground">
                {new Date(entry.ts).toTimeString().slice(0, 8)}
              </span>
              <span
                className={cn(
                  "shrink-0 font-semibold",
                  entry.context === "content"
                    ? "text-blue-500"
                    : entry.context === "background"
                      ? "text-purple-500"
                      : "text-amber-500"
                )}
              >
                [{entry.context}]
              </span>
              <span className="shrink-0 text-foreground">{entry.event}</span>
              <span className="truncate text-muted-foreground">
                {entry.detail}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
