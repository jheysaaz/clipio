import { useState, useRef, useCallback, useEffect } from "react";
import {
  Settings,
  ArrowDownUp,
  Moon,
  Sun,
  Download,
  Check,
  Info,
  Cloud,
  HardDrive,
  FileText,
  Bug,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { cn } from "~/lib/utils";
import { useTheme } from "~/hooks/ThemeContext";
import { InlineError } from "~/components/ui/inline-error";
import { lazy, Suspense } from "react";
const ImportWizard = lazy(() => import("~/components/ImportWizard"));
import { WarningBanner } from "~/components/ui/warning-banner";
import { exportSnippets, getSnippets, getStorageStatus } from "~/storage";
import { SYNC_QUOTA, FLAGS } from "~/config/constants";
import { i18n } from "#i18n";
import { captureError, sendTestError } from "~/lib/sentry";

// ---------------------------------------------------------------------------
// Sidebar nav items
// ---------------------------------------------------------------------------

type NavSection = "general" | "import-export";

interface NavItem {
  id: NavSection;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: "general",
    label: i18n.t("options.nav.general"),
    icon: <Settings className="h-4 w-4" strokeWidth={1.5} />,
  },
  {
    id: "import-export",
    label: i18n.t("options.nav.importExport"),
    icon: <ArrowDownUp className="h-4 w-4" strokeWidth={1.5} />,
  },
];

// ---------------------------------------------------------------------------
// Info tooltip
// ---------------------------------------------------------------------------

function InfoTooltip({ text }: { text: string }) {
  return (
    <div className="group relative inline-flex items-center">
      <Info
        className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500 cursor-help"
        strokeWidth={1.5}
      />
      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-lg bg-zinc-900 dark:bg-zinc-700 text-white text-xs px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-xl">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-900 dark:border-t-zinc-700" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Storage stats hook
// ---------------------------------------------------------------------------

interface StorageStats {
  snippetCount: number;
  syncBytesUsed: number;
  localEstimatedBytes: number;
  mode: "sync" | "local";
  loading: boolean;
}

function useStorageStats(): StorageStats {
  const [stats, setStats] = useState<StorageStats>({
    snippetCount: 0,
    syncBytesUsed: 0,
    localEstimatedBytes: 0,
    mode: "sync",
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
          loading: false,
        });
      })
      .catch(() => setStats((s) => ({ ...s, loading: false })));
  }, []);

  return stats;
}

// ---------------------------------------------------------------------------
// Section: General
// ---------------------------------------------------------------------------

function GeneralSection() {
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

  return (
    <div className="space-y-8">
      {/* Storage stats */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          {i18n.t("options.overview.title")}
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-5">
          {i18n.t("options.overview.description")}
        </p>

        <div className="grid grid-cols-3 gap-3 mb-3">
          {/* Snippet count */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-1">
            <div className="flex items-center gap-1.5">
              <FileText
                className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500"
                strokeWidth={1.5}
              />
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {i18n.t("options.overview.snippets")}
              </span>
            </div>
            <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
              {stats.loading ? "—" : stats.snippetCount}
            </p>
            <p className="text-[10px] text-zinc-400 dark:text-zinc-600 tabular-nums">
              {stats.loading
                ? ""
                : i18n.t("options.overview.snippetsMax", [
                    SYNC_QUOTA.MAX_ITEMS,
                  ])}
            </p>
          </div>

          {/* Sync storage */}
          <div className="col-span-2 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Cloud
                  className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500"
                  strokeWidth={1.5}
                />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {i18n.t("options.overview.syncStorage")}
                </span>
                <InfoTooltip text={i18n.t("options.overview.syncTooltip")} />
              </div>
              <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
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
            {stats.mode === "local" && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                {i18n.t("options.overview.quotaExceeded")}
              </p>
            )}
          </div>
        </div>

        {/* Local storage */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <HardDrive
                className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500"
                strokeWidth={1.5}
              />
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {i18n.t("options.overview.localStorage")}
              </span>
              <InfoTooltip text={i18n.t("options.overview.localTooltip")} />
            </div>
            <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              {stats.loading ? "—" : `~${localKB} KB`}
            </span>
          </div>
          <Progress
            value={stats.loading ? 0 : localPercent}
            className="[&>div]:bg-zinc-400 dark:[&>div]:bg-zinc-600"
          />
        </div>
      </div>

      <div className="border-t border-zinc-100 dark:border-zinc-800" />

      {/* General settings placeholder */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          {i18n.t("options.generalSection.title")}
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
          {i18n.t("options.generalSection.description")}
        </p>
        <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 p-8 flex items-center justify-center">
          <p className="text-sm text-zinc-400 dark:text-zinc-600">
            {i18n.t("options.generalSection.comingSoon")}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Import & Export
// ---------------------------------------------------------------------------

function ImportExportSection() {
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [exportedFeedback, setExportedFeedback] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);

  const handleExport = async () => {
    try {
      await exportSnippets();
      setExportedFeedback(true);
      setTimeout(() => setExportedFeedback(false), 3000);
    } catch (err) {
      console.error("[Clipio] Export failed:", err);
      captureError(err, { action: "exportSnippets" });
      setExportError(i18n.t("options.toasts.failedExport"));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {i18n.t("options.importExport.title")}
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          {i18n.t("options.importExport.description")}
        </p>
      </div>

      {/* Export card */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {i18n.t("options.importExport.exportCard.title")}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {i18n.t("options.importExport.exportCard.description")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            className="shrink-0"
          >
            {exportedFeedback ? (
              <>
                <Check
                  className="h-3.5 w-3.5 mr-1.5 text-green-600"
                  strokeWidth={1.5}
                />
                {i18n.t("options.importExport.exportCard.exported")}
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                {i18n.t("options.importExport.exportCard.button")}
              </>
            )}
          </Button>
        </div>
      </div>

      <InlineError
        message={exportError}
        onDismiss={() => setExportError(null)}
        className="rounded-lg border border-red-200 dark:border-red-800"
      />

      {/* Import card */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {i18n.t("options.importExport.importCard.title")}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {i18n.t("options.importExport.importCard.description")}
            </p>
          </div>
          <Button
            ref={importButtonRef}
            size="sm"
            onClick={() => {
              setImportedCount(null);
              setShowImportWizard(true);
            }}
            className="shrink-0"
          >
            {i18n.t("options.importExport.importCard.button")}
          </Button>
        </div>

        {importedCount !== null && (
          <p
            aria-live="polite"
            role="status"
            className="text-xs text-green-600 dark:text-green-400"
          >
            {i18n.t(
              "options.importExport.importCard.successMessage",
              importedCount
            )}
          </p>
        )}

        {/* Supported formats */}
        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap gap-1.5">
          <span className="text-[10px] text-zinc-400 dark:text-zinc-600 uppercase tracking-wide font-medium self-center">
            {i18n.t("options.importExport.importCard.supported")}
          </span>
          {["Clipio", "TextBlaze"].map((f) => (
            <span
              key={f}
              className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
            >
              {f}
            </span>
          ))}
        </div>
      </div>

      {/* Import wizard modal */}
      {showImportWizard && (
        <div
          className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 flex items-center justify-center p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setShowImportWizard(false);
              importButtonRef.current?.focus();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-wizard-title"
            className="bg-white dark:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xl w-full max-w-lg p-6 max-h-[min(90vh,640px)] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-5">
              <h2
                id="import-wizard-title"
                className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
              >
                {i18n.t("options.importExport.modal.title")}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  setShowImportWizard(false);
                  importButtonRef.current?.focus();
                }}
                aria-label={i18n.t("common.closeModal")}
              >
                <span aria-hidden="true">×</span>
              </Button>
            </div>
            <Suspense
              fallback={
                <div className="flex items-center justify-center py-12">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
                </div>
              }
            >
              <ImportWizard
                onClose={() => {
                  setShowImportWizard(false);
                  importButtonRef.current?.focus();
                }}
                onImportComplete={(count) => {
                  setImportedCount(count);
                  setShowImportWizard(false);
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

// ---------------------------------------------------------------------------
// OptionsPage root
// ---------------------------------------------------------------------------

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 320;
const SIDEBAR_DEFAULT = 220;

export default function OptionsPage() {
  const [activeSection, setActiveSection] = useState<NavSection>("general");
  const { theme, toggleTheme } = useTheme();

  // Uninstall data-loss warning (shown once on first open)
  const [showUninstallWarning, setShowUninstallWarning] = useState(false);

  useEffect(() => {
    browser.storage.local
      .get(FLAGS.DISMISSED_UNINSTALL_WARNING)
      .then((flags) => {
        if (flags[FLAGS.DISMISSED_UNINSTALL_WARNING] !== true) {
          setShowUninstallWarning(true);
          browser.storage.local
            .set({ [FLAGS.DISMISSED_UNINSTALL_WARNING]: true })
            .catch(console.warn);
        }
      })
      .catch(console.warn);
  }, []);

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const isResizing = useRef(false);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;
    setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, e.clientX)));
  }, []);

  const handleMouseUp = useCallback(() => {
    if (!isResizing.current) return;
    isResizing.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return (
    <div className="flex min-h-screen bg-white dark:bg-zinc-950 select-none">
      {/* Sidebar */}
      <aside
        style={{ width: sidebarWidth }}
        className="shrink-0 relative flex flex-col bg-zinc-50 dark:bg-zinc-900/70 border-r border-zinc-200 dark:border-zinc-800"
      >
        {/* Brand */}
        <div className="px-4 pt-6 pb-4">
          <div className="flex items-center gap-2.5 mb-0.5">
            <div className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center shrink-0">
              <img src="/icon/16.png" alt="Clipio" className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
              Clipio
            </span>
          </div>
          <p className="text-[10px] text-zinc-400 dark:text-zinc-600 ml-9">
            {i18n.t("options.sidebarSettings")}
          </p>
        </div>

        <div className="mx-3 mb-3 h-px bg-zinc-200 dark:bg-zinc-800" />

        {/* Nav */}
        <nav className="flex-1 px-2 space-y-0.5 overflow-hidden">
          <p className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest px-2 pb-1.5">
            {i18n.t("options.menu")}
          </p>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              aria-current={activeSection === item.id ? "page" : undefined}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150 truncate",
                activeSection === item.id
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm font-medium border border-zinc-200/80 dark:border-zinc-700/60"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
              )}
            >
              <span
                className={cn(
                  "shrink-0 transition-colors",
                  activeSection === item.id
                    ? "text-zinc-900 dark:text-zinc-100"
                    : "text-zinc-400 dark:text-zinc-500"
                )}
              >
                {item.icon}
              </span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Theme toggle */}
        <div className="mx-3 my-3 h-px bg-zinc-200 dark:bg-zinc-800" />
        <div className="px-2 pb-4">
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 transition-colors"
          >
            {theme === "light" ? (
              <>
                <Moon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                <span className="truncate">
                  {i18n.t("options.theme.darkMode")}
                </span>
              </>
            ) : (
              <>
                <Sun className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                <span className="truncate">
                  {i18n.t("options.theme.lightMode")}
                </span>
              </>
            )}
          </button>
          {/* Dev-only Sentry test button — tree-shaken out in production builds */}
          {import.meta.env.DEV && (
            <button
              onClick={() => sendTestError()}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
              title="Send test error to Sentry (dev only)"
            >
              <Bug className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span className="truncate">Send test error</span>
            </button>
          )}
        </div>

        {/* Resize handle */}
        <div
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize group z-10"
          onMouseDown={() => {
            isResizing.current = true;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
        >
          <div className="absolute inset-y-0 right-0 w-0.5 bg-transparent group-hover:bg-zinc-300 dark:group-hover:bg-zinc-600 transition-colors" />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto select-text">
        {showUninstallWarning && (
          <WarningBanner
            action={{
              label: i18n.t("options.warnings.uninstall.action"),
              onClick: () => setActiveSection("import-export"),
            }}
            onDismiss={() => setShowUninstallWarning(false)}
          >
            {i18n.t("options.warnings.uninstall.body")}
          </WarningBanner>
        )}
        <div className="max-w-2xl mx-auto px-8 py-8">
          {activeSection === "general" && <GeneralSection />}
          {activeSection === "import-export" && <ImportExportSection />}
        </div>
      </main>
    </div>
  );
}
