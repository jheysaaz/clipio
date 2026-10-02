/**
 * Library — import/export, library stats, usage and the media library.
 *
 * Folds the old separate Snippets, Images and Dashboard sections into one
 * place, because all three answer "what is in my library?" rather than
 * "how do I configure a behaviour?".
 *
 * spec: specs/options-redesign.spec.md
 */

import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { Download, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { exportSnippets, getSnippets } from "@/storage";
import { snippetsContainMedia } from "@/lib/exporters/clipio";
import { usageCountsItem } from "@/storage/items";
import { captureError } from "@/lib/sentry";
import { i18n } from "#i18n";
import { toast } from "sonner";

const ImportWizard = lazy(() => import("@/components/ImportWizard"));

export function LibraryPanel() {
  const [count, setCount] = useState<number | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [topUsage, setTopUsage] = useState<
    { id: string; label: string; shortcut: string; count: number }[]
  >([]);
  const importButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    Promise.all([getSnippets(), usageCountsItem.getValue()])
      .then(([snippets, counts]) => {
        setCount(snippets.length);
        setTopUsage(
          Object.entries(counts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([id, n]) => {
              const snippet = snippets.find((s) => s.id === id);
              return {
                id,
                label: snippet?.label ?? snippet?.shortcut ?? id,
                shortcut: snippet?.shortcut ?? "",
                count: n,
              };
            })
        );
      })
      .catch((err) => captureError(err, { action: "libraryPanel.load" }));
  }, []);

  const handleExport = async () => {
    try {
      const snippets = await getSnippets();
      const hasMedia = snippetsContainMedia(snippets);
      await exportSnippets();
      toast.success(
        hasMedia
          ? i18n.t("options.library.exportedWithMedia")
          : i18n.t("options.library.exported")
      );
    } catch (err) {
      captureError(err, { action: "exportSnippets" });
      toast.error(
        err instanceof Error
          ? err.message
          : i18n.t("options.errors.failedExport")
      );
    }
  };

  return (
    <div className="mb-6 space-y-8">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon icon={FileText} className="text-muted-foreground" />
            {i18n.t("options.overview.snippets")}
          </span>
          <span className="text-sm tabular-nums text-foreground">
            {count ?? "—"}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">
            {i18n.t("options.copy.topUsageHeading")}
          </h2>
        </div>
        {/* The wrapper is always rendered so `card-top-usage` is a stable
            handle in both the populated and empty states — a testid that
            appears only when there is data cannot assert the empty case. */}
        <div data-testid="card-top-usage">
          {topUsage.length === 0 ? (
            <p
              data-testid="top-usage-empty"
              className="text-xs text-muted-foreground"
            >
              {i18n.t("options.copy.topUsageEmpty")}
            </p>
          ) : (
            <ul className="space-y-1">
              {topUsage.map(({ id, label, shortcut, count: n }) => (
                <li
                  key={id}
                  className="flex items-center justify-between gap-3 py-1 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-foreground">{label}</span>
                    {shortcut && (
                      <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {shortcut}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {i18n.t("options.library.uses", [String(n)])}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/*
        Import and Export are separate groups rather than two adjacent rows.
        They are opposite directions of data movement with different
        consequences — one replaces what you have, the other is a safety copy —
        and stacking them read as one undifferentiated block.
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
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-foreground">
              {i18n.t("options.importExport.importCard.title")}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {i18n.t("options.importExport.importCard.description")}
            </p>
          </div>
          <Button
            ref={importButtonRef}
            size="sm"
            data-testid="import-open"
            onClick={() => setShowWizard(true)}
            className="h-8 shrink-0"
          >
            {i18n.t("options.importExport.importCard.button")}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="self-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {i18n.t("options.importExport.importCard.supported")}
          </span>
          {[
            { label: "Clipio", icon: "/icon/128.png" },
            { label: "TextBlaze", icon: "/icon/textblaze.png" },
            { label: "PowerText", icon: "/icon/powertext.png" },
          ].map(({ label, icon }) => (
            <span
              key={label}
              className="flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
            >
              <img src={icon} alt="" className="h-3.5 w-3.5 rounded-sm" />
              {label}
            </span>
          ))}
        </div>
      </section>

      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 dark:bg-black/60">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-wizard-title"
            className="max-h-[min(90vh,640px)] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border bg-background p-6 shadow-xl"
          >
            <h2
              id="import-wizard-title"
              className="text-base font-semibold text-foreground"
            >
              {i18n.t("options.importExport.modal.title")}
            </h2>
            <Suspense
              fallback={
                <div className="flex items-center justify-center py-12">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground" />
                </div>
              }
            >
              <ImportWizard
                onClose={() => {
                  setShowWizard(false);
                  importButtonRef.current?.focus();
                }}
                onImportComplete={(n) => {
                  toast.success(
                    i18n.t("options.importExport.importCard.successMessage", n)
                  );
                  setShowWizard(false);
                  importButtonRef.current?.focus();
                }}
              />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}
