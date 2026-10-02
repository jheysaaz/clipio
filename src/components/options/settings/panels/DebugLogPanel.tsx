/**
 * The debug log, rendered below the "Debug logging" switch that controls it.
 *
 * Renders nothing at all while logging is off, rather than an empty 192px box:
 * a log viewer you have not enabled is noise, and the box was previously
 * rendered above its own switch.
 *
 * spec: specs/options-redesign.spec.md
 */

import { useEffect, useRef, useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  debugLogItem,
  debugModeItem,
  type DebugLogEntry,
} from "@/storage/items";
import { captureError } from "@/lib/sentry";
import { cn } from "@/lib/utils";
import { i18n } from "#i18n";

export function DebugLogPanel() {
  const [enabled, setEnabled] = useState(false);
  const [log, setLog] = useState<DebugLogEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

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
        setLog(Array.isArray(entries) ? entries : []);
      })
      .catch(console.warn);

    const unwatch = debugLogItem.watch((entries) => {
      if (!cancelled) setLog(Array.isArray(entries) ? entries : []);
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
      toast.success(i18n.t("options.developers.debugMode.copiedLog"));
    } catch (err) {
      captureError(err, { action: "copyDebugLog" });
      toast.error(i18n.t("options.developers.debugMode.copyFailed"));
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
          >
            <Icon icon={Copy} className="mr-1" />
            {i18n.t("options.developers.debugMode.copyLog")}
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
        ) : (
          log.map((entry, i) => (
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
                {typeof entry.detail === "string"
                  ? entry.detail
                  : JSON.stringify(entry.detail)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
