/**
 * Library — import/export, library stats, usage and the media library.
 *
 * Folds the old separate Snippets, Images and Dashboard sections into one
 * place, because all three answer "what is in my library?" rather than
 * "how do I configure a behaviour?".
 *
 */

import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { Download, FileText, MousePointerClick, Trophy } from "lucide-react";

import { BackupManager } from "@/components/BackupManager";
import { useFeedback } from "@/components/feedback/FeedbackProvider";
import { useControlConfirmation } from "@/components/feedback/use-control-confirmation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ControlConfirmation } from "@/components/ui/control-confirmation";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { exportSnippets, getSnippets } from "@/storage";
import { snippetsContainMedia } from "@/lib/exporters/clipio";
import { usageCountsItem } from "@/storage/items";
import { captureError } from "@/lib/sentry";
import { IMPORT_PARSERS } from "@/lib/importers/registry";
import { IMPORT_PANEL_ANCHOR } from "@/pages/options/LibraryImportPanel";
import { i18n } from "#i18n";

const ImportWizard = lazy(() => import("@/components/ImportWizard"));

export function LibraryPanel() {
  const [stats, setStats] = useState<{
    count: number | null;
    totalUses: number | null;
    mostUsed: { label: string; count: number } | null;
  }>({ count: null, totalUses: null, mostUsed: null });
  const [showWizard, setShowWizard] = useState(false);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const {
    confirmed: exportConfirmed,
    show: showExportConfirmation,
    reset: resetExportConfirmation,
  } = useControlConfirmation();
  const {
    confirmed: importConfirmed,
    show: showImportConfirmation,
    reset: resetImportConfirmation,
  } = useControlConfirmation();
  const [exportConfirmation, setExportConfirmation] = useState("");
  const [importConfirmation, setImportConfirmation] = useState("");
  const { announce, showBanner, dismissBanner } = useFeedback();

  useEffect(() => {
    Promise.all([getSnippets(), usageCountsItem.getValue()])
      .then(([snippets, counts]) => {
        const top = Object.entries(counts).sort(([, a], [, b]) => b - a)[0];
        const topSnippet = top ? snippets.find((s) => s.id === top[0]) : null;
        setStats({
          count: snippets.length,
          totalUses: Object.values(counts).reduce((sum, n) => sum + n, 0),
          mostUsed: top
            ? {
                label: topSnippet?.label ?? topSnippet?.shortcut ?? top[0],
                count: top[1],
              }
            : null,
        });
      })
      .catch((err) => captureError(err, { action: "libraryPanel.load" }));
  }, []);

  const handleExport = async () => {
    try {
      const snippets = await getSnippets();
      const hasMedia = snippetsContainMedia(snippets);
      await exportSnippets();
      const message = i18n.t(
        hasMedia
          ? "options.library.exportedWithMedia"
          : "options.library.exported"
      );
      setExportConfirmation(message);
      showExportConfirmation();
      announce(message);
      dismissBanner("library-export", { runOnDismiss: false });
    } catch (err) {
      captureError(err, { action: "exportSnippets" });
      resetExportConfirmation();
      showBanner({
        source: "library-export",
        scope: "library",
        severity: "error",
        message:
          err instanceof Error
            ? err.message
            : i18n.t("options.errors.failedExport"),
      });
    }
  };

  return (
    <Dialog
      open={showWizard}
      disablePointerDismissal
      onOpenChange={(next) => {
        setShowWizard(next);
        if (!next) importButtonRef.current?.focus();
      }}
    >
      <div className="mb-6 space-y-8">
        {/* Three figures answer three questions about the library: how much is
          there, how much it gets used, and which snippet carries that use. A
          grid keeps them comparable instead of stacking them as separate rows. */}
        <dl className="grid grid-cols-3 gap-3" data-testid="library-stats">
          <div
            data-testid="stat-snippets"
            className="min-w-0 rounded-lg border border-border/70 bg-muted/30 p-3"
          >
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon icon={FileText} className="text-muted-foreground" />
              {i18n.t("options.overview.snippets")}
            </dt>
            <dd className="mt-1 text-lg font-medium tabular-nums text-foreground">
              {stats.count ?? "—"}
            </dd>
          </div>
          <div
            data-testid="stat-total-uses"
            className="min-w-0 rounded-lg border border-border/70 bg-muted/30 p-3"
          >
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon
                icon={MousePointerClick}
                className="text-muted-foreground"
              />
              {i18n.t("options.library.totalUses")}
            </dt>
            <dd className="mt-1 text-lg font-medium tabular-nums text-foreground">
              {stats.totalUses ?? "—"}
            </dd>
          </div>
          <div
            data-testid="stat-most-used"
            className="min-w-0 rounded-lg border border-border/70 bg-muted/30 p-3"
          >
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon icon={Trophy} className="text-muted-foreground" />
              {i18n.t("options.library.mostUsed")}
            </dt>
            <dd className="mt-1 min-w-0">
              {stats.mostUsed ? (
                <>
                  <span className="block truncate text-sm font-medium text-foreground">
                    {stats.mostUsed.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {i18n.t("options.library.uses", [
                      String(stats.mostUsed.count),
                    ])}
                  </span>
                </>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </dd>
          </div>
        </dl>

        {/* The anchor `/library/import` scrolls to and focuses. `tabIndex={-1}`
          makes it programmatically focusable without adding a tab stop, since
          the card's own controls are already reachable. */}
        <section
          id={IMPORT_PANEL_ANCHOR}
          tabIndex={-1}
          className="space-y-2 scroll-mt-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-foreground">
                {i18n.t("options.importExport.importCard.title")}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {i18n.t("options.importExport.importCard.description")}
              </p>
              {importConfirmed && (
                <ControlConfirmation
                  label={importConfirmation}
                  testId="import-confirmation"
                  className="mt-1"
                />
              )}
            </div>
            <DialogTrigger
              render={
                <Button
                  ref={importButtonRef}
                  size="sm"
                  data-testid="import-open"
                  onClick={() => {
                    resetImportConfirmation();
                    setShowWizard(true);
                  }}
                  className="h-8 shrink-0"
                />
              }
            >
              {i18n.t("options.importExport.importCard.button")}
            </DialogTrigger>
          </div>

          <div
            data-testid="import-formats"
            className="flex flex-wrap items-center gap-1.5 pt-1"
          >
            <span className="self-center text-ui-micro! font-medium uppercase tracking-wide text-muted-foreground">
              {i18n.t("options.importExport.importCard.supported")}
            </span>
            {IMPORT_PARSERS.map((parser) => (
              <Badge key={parser.id} variant="secondary" className="gap-1.5">
                {/* Decorative: the format name is already the adjacent text, so
                  the mark carries no meaning on its own for a screen reader. */}
                {parser.iconUrl && (
                  <img
                    src={parser.iconUrl}
                    alt=""
                    className="h-3.5 w-3.5 rounded-sm"
                  />
                )}
                {parser.displayName}
              </Badge>
            ))}
          </div>
        </section>

        {/*
        Import and Export are separate groups rather than two adjacent rows.
        They are opposite directions of data movement with different
        consequences — one replaces what you have, the other is a safety copy —
        and stacking them read as one undifferentiated block. Import leads,
        since filling a new library is the action people reach for first.
      */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-foreground">
                {i18n.t("options.importExport.exportCard.title")}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {i18n.t("options.importExport.exportCard.description")}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              data-testid="export-json"
              onClick={handleExport}
              className="h-8 shrink-0"
            >
              <Icon icon={Download} className="mr-1.5" />
              {i18n.t("options.importExport.exportCard.button")}
            </Button>
            {exportConfirmed && (
              <ControlConfirmation
                label={exportConfirmation}
                className="self-center"
              />
            )}
          </div>
        </section>

        <BackupManager />

        {showWizard && (
          <DialogContent
            showCloseButton={false}
            className="w-full max-w-2xl p-6 sm:max-w-2xl"
          >
            <DialogTitle
              id="import-wizard-title"
              className="text-base font-semibold text-foreground"
            >
              {i18n.t("options.importExport.modal.title")}
            </DialogTitle>
            <Suspense
              fallback={
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <Spinner className="size-5 text-foreground motion-reduce:hidden" />
                  <span className="sr-only motion-reduce:not-sr-only">
                    {i18n.t("common.loading")}
                  </span>
                </div>
              }
            >
              <ImportWizard
                onClose={() => {
                  setShowWizard(false);
                  importButtonRef.current?.focus();
                }}
                onImportComplete={(n) => {
                  const message = i18n.t(
                    "options.importExport.importCard.successMessage",
                    n
                  );
                  setImportConfirmation(message);
                  showImportConfirmation();
                  announce(message);
                  // A previously failed import may have left a scoped banner in
                  // the shell. The local confirmation replaces it without
                  // running its onDismiss side effect here.
                  dismissBanner("library-import", { runOnDismiss: false });
                  setShowWizard(false);
                  importButtonRef.current?.focus();
                }}
              />
            </Suspense>
          </DialogContent>
        )}
      </div>
    </Dialog>
  );
}
