/**
 * Diagnostics snapshot toolkit — collect, summarise and export the state a
 * support report needs.
 *
 * This sits above the registry rows in the Diagnostics section, while the live
 * log viewer sits below the verbose-logging switch. The split is deliberate:
 * a snapshot should be useful even when logging has never been enabled, and a
 * user who enables logging should not have to leave the viewer to filter it.
 */

import { useState } from "react";
import { Check, Copy, Download, RefreshCw } from "lucide-react";

import { collectDiagnostics } from "@/components/options/collect-diagnostics";
import { useFeedback } from "@/components/feedback/FeedbackProvider";
import { useControlConfirmation } from "@/components/feedback/use-control-confirmation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import {
  formatDiagnosticsReport,
  type DiagnosticsSnapshot,
} from "@/lib/diagnostics";
import { captureError } from "@/lib/sentry";
import { i18n } from "#i18n";

function reportFilename(generatedAt: string): string {
  return `clipio-diagnostics-${generatedAt.replace(/[:.]/g, "-")}.md`;
}

export function DiagnosticsToolkitPanel() {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirmed, show, reset } = useControlConfirmation();
  const { announce, showBanner, dismissBanner } = useFeedback();

  const fail = (source: string, key: string) => {
    reset();
    showBanner({
      source,
      severity: "error",
      // The keys are literals at every call site; the generated `i18n.t` type
      // only accepts its key union, which is not expressible through a helper
      // parameter without widening it back to a string here.
      message: i18n.t(key as never),
    });
  };

  const succeed = (message: string) => {
    show();
    announce(message);
    dismissBanner("diagnostics-toolkit", { runOnDismiss: false });
  };

  const collect = async () => {
    setBusy(true);
    try {
      setSnapshot(await collectDiagnostics());
      succeed(i18n.t("options.developers.toolkit.collected"));
    } catch (error) {
      captureError(error, { action: "collectDiagnostics" });
      fail("diagnostics-toolkit", "options.developers.toolkit.collectFailed");
    } finally {
      setBusy(false);
    }
  };

  const copyReport = async () => {
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(formatDiagnosticsReport(snapshot));
      succeed(i18n.t("options.developers.toolkit.copiedReport"));
    } catch (error) {
      captureError(error, { action: "copyDiagnosticsReport" });
      fail("diagnostics-toolkit", "options.developers.toolkit.copyFailed");
    }
  };

  const downloadReport = () => {
    if (!snapshot) return;
    try {
      const url = URL.createObjectURL(
        new Blob([formatDiagnosticsReport(snapshot)], {
          type: "text/markdown;charset=utf-8",
        })
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = reportFilename(snapshot.generatedAt);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      succeed(i18n.t("options.developers.toolkit.downloaded"));
    } catch (error) {
      captureError(error, { action: "downloadDiagnosticsReport" });
      fail("diagnostics-toolkit", "options.developers.toolkit.downloadFailed");
    }
  };

  const errors = snapshot ? Object.entries(snapshot.errors) : [];

  return (
    <div className="mb-6" data-testid="panel-diagnostics-toolkit">
      <div className="mb-3">
        <h2 className="text-sm font-medium text-foreground">
          {i18n.t("options.developers.toolkit.title")}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {i18n.t("options.developers.toolkit.description")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={collect}
          disabled={busy}
          data-testid="button-collect-diagnostics"
          aria-label={
            busy ? i18n.t("options.developers.toolkit.collecting") : undefined
          }
        >
          {busy ? (
            <>
              <Spinner className="mr-1.5 size-3.5 motion-reduce:hidden" />
              {i18n.t("options.developers.toolkit.collecting")}
            </>
          ) : (
            <>
              <Icon icon={RefreshCw} className="mr-1.5" />
              {snapshot
                ? i18n.t("options.developers.toolkit.refresh")
                : i18n.t("options.developers.toolkit.collect")}
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8"
          onClick={copyReport}
          disabled={!snapshot}
          data-testid="button-copy-diagnostics"
          aria-pressed={confirmed}
        >
          <Icon icon={confirmed ? Check : Copy} className="mr-1.5" />
          {confirmed
            ? i18n.t("options.developers.toolkit.copiedReport")
            : i18n.t("options.developers.toolkit.copyReport")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8"
          onClick={downloadReport}
          disabled={!snapshot}
          data-testid="button-download-diagnostics"
        >
          <Icon icon={Download} className="mr-1.5" />
          {i18n.t("options.developers.toolkit.downloadReport")}
        </Button>
      </div>

      {snapshot && (
        <>
          <dl
            className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2"
            data-testid="diagnostics-summary"
          >
            <SummaryRow
              testId="diag-storage-mode"
              label={i18n.t("options.developers.toolkit.storageMode")}
              value={
                snapshot.storage.quotaExceeded
                  ? `${snapshot.storage.mode} · ${i18n.t("options.developers.toolkit.quotaFallback")}`
                  : snapshot.storage.mode
              }
            />
            <SummaryRow
              testId="diag-snippets"
              label={i18n.t("options.developers.toolkit.snippets")}
              value={String(snapshot.storage.snippetCount)}
            />
            <SummaryRow
              testId="diag-cached-snippets"
              label={i18n.t("options.developers.toolkit.cachedSnippets")}
              value={String(snapshot.storage.cachedSnippetCount)}
            />
            <SummaryRow
              testId="diag-backup-snippets"
              label={i18n.t("options.developers.toolkit.backupSnippets")}
              value={String(snapshot.storage.backupSnippetCount)}
            />
            <SummaryRow
              testId="diag-corrupt-keys"
              label={i18n.t("options.developers.toolkit.corruptKeys")}
              value={String(snapshot.storage.corruptKeys.length)}
            />
            <SummaryRow
              testId="diag-sync-data-lost"
              label={i18n.t("options.developers.toolkit.syncDataLost")}
              value={booleanLabel(snapshot.storage.syncDataLost)}
            />
            <SummaryRow
              testId="diag-custom-giphy-key"
              label={i18n.t("options.developers.toolkit.customGiphyKey")}
              value={booleanLabel(snapshot.storage.customGiphyKey)}
            />
            <SummaryRow
              testId="diag-last-sentry-error"
              label={i18n.t("options.developers.toolkit.lastSentryError")}
              value={
                snapshot.storage.lastSentryErrorAt ??
                i18n.t("options.developers.toolkit.never")
              }
            />
            <SummaryRow
              testId="diag-debug-mode"
              label={i18n.t("options.developers.toolkit.debugMode")}
              value={booleanLabel(snapshot.debugMode)}
            />
            <SummaryRow
              testId="diag-log-entries"
              label={i18n.t("options.developers.toolkit.logEntries")}
              value={String(snapshot.log.total)}
            />
            <SummaryRow
              testId="diag-suspicious-events"
              label={i18n.t("options.developers.toolkit.suspiciousEvents")}
              value={String(snapshot.log.suspicious)}
            />
            <SummaryRow
              testId="diag-tab-health"
              label={i18n.t("options.developers.toolkit.tabHealth")}
              value={`${i18n.t("options.developers.toolkit.tabsActive", [snapshot.tabs.active])} · ${i18n.t("options.developers.toolkit.tabsMissing", [snapshot.tabs.missing])}`}
            />
          </dl>

          {snapshot.tabs.error && (
            <p
              className="mt-2 text-xs text-amber-600 dark:text-amber-400"
              data-testid="diag-tab-error"
            >
              {i18n.t("options.developers.toolkit.tabQueryError", [
                snapshot.tabs.error,
              ])}
            </p>
          )}

          {errors.length > 0 && (
            <div
              className="mt-2 text-xs text-amber-600 dark:text-amber-400"
              data-testid="diag-collection-warnings"
            >
              <p>{i18n.t("options.developers.toolkit.warningsHeading")}</p>
              <ul className="ml-4 list-disc">
                {errors.map(([source, message]) => (
                  <li key={source}>{`${source}: ${message}`}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-2 text-xs text-muted-foreground">
            {i18n.t("options.developers.toolkit.privacyNote")}
          </p>
        </>
      )}
    </div>
  );
}

function booleanLabel(value: boolean): string {
  return value
    ? i18n.t("options.developers.toolkit.yes")
    : i18n.t("options.developers.toolkit.no");
}

function SummaryRow({
  testId,
  label,
  value,
}: {
  testId: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex justify-between gap-2 border-b border-border/60 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
