import {
  useState,
  useRef,
  useCallback,
  useEffect,
  lazy,
  Suspense,
} from "react";
import {
  Settings,
  ArrowDownUp,
  Moon,
  Sun,
  Monitor,
  Download,
  Check,
  Info,
  Cloud,
  HardDrive,
  FileText,
  MessageSquareText,
  Palette,
  Sparkles,
  Search,
  PanelLeftClose,
  PanelLeft,
  AlertTriangle,
  X,
  Code,
  Images,
  Trash2,
  LayoutList,
  LayoutGrid,
  Globe,
  Plus,
  ExternalLink,
  Loader2,
  Bug,
  RotateCcw,
  Copy,
  Heart,
} from "lucide-react";
import confetti from "canvas-confetti";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";
import { useTheme, type ThemeMode } from "~/hooks/ThemeContext";
import { Alert, AlertDescription, AlertAction } from "~/components/ui/alert";
import { InlineError } from "~/components/ui/inline-error";

import { Label } from "~/components/ui/label";
const ImportWizard = lazy(() => import("~/components/ImportWizard"));
import {
  exportSnippets,
  getSnippets,
  getStorageStatus,
  clearIDBBackup,
  forceSetStorageMode,
} from "~/storage";
import type { StorageMode } from "~/storage";
import {
  SYNC_QUOTA,
  MEDIA_LIMITS,
  CONTENT_SCRIPT_PING_MESSAGE_TYPE,
} from "~/config/constants";
import {
  listMedia,
  getMedia,
  deleteMedia,
  updateMediaAlt,
  type MediaMetadata,
} from "~/storage/backends/media";
import {
  confettiEnabledItem,
  dismissedUninstallWarningItem,
  giphyApiKeyItem,
  blockedSitesItem,
  latestVersionItem,
  usageCountsItem,
  dismissedUpdateVersionItem,
  typingTimeoutItem,
  debugModeItem,
  debugLogItem,
  reviewPromptStateItem,
  lastSentryErrorAtItem,
  type DebugLogEntry,
} from "~/storage/items";
import { TIMING } from "~/config/constants";
import { i18n } from "#i18n";
import { captureError, captureMessage, sendUserFeedback } from "~/lib/sentry";
import { SENTRY_TEST_MESSAGE_TYPE } from "~/config/constants";
import { setReviewPromptState, getStoreReviewUrl } from "~/lib/review-prompt";

// ---------------------------------------------------------------------------
// Sidebar nav items
// ---------------------------------------------------------------------------

type NavSection =
  | "general"
  | "import-export"
  | "appearance"
  | "images"
  | "developers"
  | "feedback";

interface NavItem {
  id: NavSection;
  label: string;
  icon: React.ReactNode;
  keywords?: string[];
}

const NAV_ITEMS: NavItem[] = [
  {
    id: "general",
    label: i18n.t("options.nav.general"),
    icon: <Settings className="h-4 w-4" strokeWidth={1.5} />,
    keywords: [
      "overview",
      "storage",
      "sync",
      "snippets",
      "stats",
      "quota",
      "settings",
      "local",
    ],
  },
  {
    id: "import-export",
    label: i18n.t("options.nav.importExport"),
    icon: <ArrowDownUp className="h-4 w-4" strokeWidth={1.5} />,
    keywords: [
      "import",
      "export",
      "backup",
      "textblaze",
      "powertext",
      "clipio",
      "json",
      "download",
      "upload",
      "migrate",
    ],
  },
  {
    id: "appearance",
    label: i18n.t("options.nav.appearance"),
    icon: <Palette className="h-4 w-4" strokeWidth={1.5} />,
    keywords: [
      "theme",
      "dark",
      "light",
      "system",
      "mode",
      "color",
      "confetti",
      "celebrate",
      "animation",
      "effect",
      "sparkle",
    ],
  },
  {
    id: "images",
    label: i18n.t("options.nav.images"),
    icon: <Images className="h-4 w-4" strokeWidth={1.5} />,
    keywords: [
      "images",
      "photos",
      "pictures",
      "media",
      "thumbnails",
      "gif",
      "storage",
      "library",
    ],
  },
  {
    id: "developers",
    label: i18n.t("options.nav.developers"),
    icon: <Code className="h-4 w-4" strokeWidth={1.5} />,
    keywords: [
      "developers",
      "api",
      "giphy",
      "key",
      "blocked",
      "sites",
      "blocklist",
      "advanced",
      "dev",
    ],
  },
  {
    id: "feedback",
    label: i18n.t("options.nav.feedback"),
    icon: <MessageSquareText className="h-4 w-4" strokeWidth={1.5} />,
    keywords: [
      "feedback",
      "report",
      "bug",
      "suggestion",
      "contact",
      "message",
      "help",
      "support",
    ],
  },
];

// ---------------------------------------------------------------------------
// Info tooltip
// ---------------------------------------------------------------------------

function InfoTooltip({ text }: { text: string }) {
  return (
    <div className="group relative inline-flex items-center">
      <Info
        className="h-3.5 w-3.5 text-muted-foreground cursor-help"
        strokeWidth={1.5}
      />
      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 rounded-lg bg-foreground text-background text-xs px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-xl">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-foreground" />
      </div>
    </div>
  );
}

/** Shows a site favicon; falls back to a Globe icon on error */
function SiteFavicon({ hostname }: { hostname: string }) {
  const domain = hostname.startsWith("*.") ? hostname.slice(2) : hostname;
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <Globe
        className="h-3.5 w-3.5 text-muted-foreground shrink-0"
        strokeWidth={1.5}
      />
    );
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
      alt=""
      width={14}
      height={14}
      className="shrink-0 rounded-sm"
      onError={() => setFailed(true)}
    />
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
  localReason: "quota" | "manual";
  loading: boolean;
}

function useStorageStats(): StorageStats {
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

// ---------------------------------------------------------------------------
// Section: General
// ---------------------------------------------------------------------------

function GeneralSection({
  onNavigate,
}: {
  onNavigate?: (section: NavSection) => void;
}) {
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

  // --- Blocked sites ---
  const [blockedSites, setBlockedSites] = useState<string[]>([]);
  const [addSiteValue, setAddSiteValue] = useState("");
  const [addSiteError, setAddSiteError] = useState<string | null>(null);
  const [siteStatusMsg, setSiteStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    blockedSitesItem
      .getValue()
      .then((val) => setBlockedSites(val ?? []))
      .catch(console.warn);
  }, []);

  /** Normalise input: strip protocol, path, trailing dots/slashes. Preserve leading *. for wildcards */
  function normaliseHostname(raw: string): string {
    let s = raw.trim().toLowerCase();
    // Strip protocol
    s = s.replace(/^https?:\/\//i, "");
    // Strip path and query
    s = s.split("/")[0].split("?")[0].split("#")[0];
    // Strip trailing dots
    s = s.replace(/\.+$/, "");
    return s;
  }

  /** Accepts plain hostnames (example.com) and wildcard patterns (*.example.com) */
  function isValidHostname(hostname: string): boolean {
    if (hostname.startsWith("*.")) {
      const rest = hostname.slice(2);
      return (
        /^[a-z0-9]([a-z0-9\-\.]*[a-z0-9])?$/i.test(rest) && rest.includes(".")
      );
    }
    return (
      /^[a-z0-9]([a-z0-9\-\.]*[a-z0-9])?$/i.test(hostname) &&
      hostname.includes(".")
    );
  }

  /** Return the bare domain for favicon lookup (strips leading *.) */
  function faviconDomain(hostname: string): string {
    return hostname.startsWith("*.") ? hostname.slice(2) : hostname;
  }

  const handleAddSite = async () => {
    const hostname = normaliseHostname(addSiteValue);
    if (!isValidHostname(hostname)) {
      setAddSiteError(
        i18n.t("options.generalSection.blockedSites.errorInvalid")
      );
      return;
    }
    if (blockedSites.includes(hostname)) {
      setAddSiteError(
        i18n.t("options.generalSection.blockedSites.errorDuplicate")
      );
      return;
    }
    try {
      const updated = [...blockedSites, hostname];
      await blockedSitesItem.setValue(updated);
      setBlockedSites(updated);
      setAddSiteValue("");
      setAddSiteError(null);
      setSiteStatusMsg(i18n.t("options.generalSection.blockedSites.added"));
      setTimeout(() => setSiteStatusMsg(null), 2000);
    } catch (err) {
      captureError(err, { action: "addBlockedSite" });
    }
  };

  const handleRemoveSite = async (hostname: string) => {
    try {
      const updated = blockedSites.filter((s) => s !== hostname);
      await blockedSitesItem.setValue(updated);
      setBlockedSites(updated);
      setSiteStatusMsg(i18n.t("options.generalSection.blockedSites.removed"));
      setTimeout(() => setSiteStatusMsg(null), 2000);
    } catch (err) {
      captureError(err, { action: "removeBlockedSite" });
    }
  };

  return (
    <div className="space-y-8">
      {/* Storage stats */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">
          {i18n.t("options.overview.title")}
        </h2>
        <p className="text-sm text-muted-foreground mb-5">
          {i18n.t("options.overview.description")}
        </p>

        <div className="grid grid-cols-3 gap-3 mb-3">
          {/* Snippet count */}
          <div className="rounded-xl border p-4 space-y-1">
            <div className="flex items-center gap-1.5">
              <FileText
                className="h-3.5 w-3.5 text-muted-foreground"
                strokeWidth={1.5}
              />
              <span className="text-xs text-muted-foreground">
                {i18n.t("options.overview.snippets")}
              </span>
            </div>
            <p className="text-2xl font-semibold text-foreground tabular-nums">
              {stats.loading ? "—" : stats.snippetCount}
            </p>
            <p className="text-[10px] text-muted-foreground tabular-nums">
              {stats.loading
                ? ""
                : i18n.t("options.overview.snippetsMax", [
                    SYNC_QUOTA.MAX_ITEMS,
                  ])}
            </p>
          </div>

          {/* Sync storage */}
          <div className="col-span-2 rounded-xl border p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Cloud
                  className="h-3.5 w-3.5 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <span className="text-xs text-muted-foreground">
                  {i18n.t("options.overview.syncStorage")}
                </span>
                <InfoTooltip text={i18n.t("options.overview.syncTooltip")} />
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">
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
            {stats.mode === "local" && stats.localReason === "quota" && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                {i18n.t("options.overview.quotaExceeded")}
              </p>
            )}
            {stats.mode === "local" && stats.localReason === "manual" && (
              <p className="text-[11px] text-muted-foreground">
                {i18n.t("dashboard.warnings.syncPaused.body")}
              </p>
            )}
          </div>
        </div>

        {/* Local storage */}
        <div className="rounded-xl border p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <HardDrive
                className="h-3.5 w-3.5 text-muted-foreground"
                strokeWidth={1.5}
              />
              <span className="text-xs text-muted-foreground">
                {i18n.t("options.overview.localStorage")}
              </span>
              <InfoTooltip text={i18n.t("options.overview.localTooltip")} />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {stats.loading ? "—" : `~${localKB} KB`}
            </span>
          </div>
          <Progress
            value={stats.loading ? 0 : localPercent}
            className="[&>div]:bg-muted-foreground"
          />
        </div>
      </div>

      <div className="border-t" />

      {/* Blocked sites */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1 flex items-center gap-2">
          {i18n.t("options.generalSection.blockedSites.title")}
          <InfoTooltip
            text={i18n.t("options.generalSection.blockedSites.wildcardTip")}
          />
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          {i18n.t("options.generalSection.blockedSites.description")}
        </p>

        <div className="rounded-xl border p-5 space-y-4">
          {/* Add site form */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Globe
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
                strokeWidth={1.5}
              />
              <Input
                type="text"
                placeholder={i18n.t(
                  "options.generalSection.blockedSites.addPlaceholder"
                )}
                value={addSiteValue}
                onChange={(e) => {
                  setAddSiteValue(e.target.value);
                  setAddSiteError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddSite();
                }}
                className="pl-8 h-9 text-sm font-mono"
              />
            </div>
            <Button
              size="sm"
              onClick={handleAddSite}
              disabled={!addSiteValue.trim()}
              className="shrink-0 h-9 gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              {i18n.t("options.generalSection.blockedSites.addButton")}
            </Button>
          </div>

          {addSiteError && (
            <InlineError
              message={addSiteError}
              onDismiss={() => setAddSiteError(null)}
              className="rounded-lg border border-red-200 dark:border-red-800"
            />
          )}

          {/* Site list */}
          {blockedSites.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              {i18n.t("options.generalSection.blockedSites.empty")}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {blockedSites.map((hostname) => (
                <li
                  key={hostname}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border bg-muted/40 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <SiteFavicon hostname={hostname} />
                    <span className="font-mono text-foreground truncate">
                      {hostname}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => handleRemoveSite(hostname)}
                    aria-label={`${i18n.t("options.generalSection.blockedSites.remove")} ${hostname}`}
                  >
                    <X className="h-3 w-3 mr-1" strokeWidth={1.5} />
                    {i18n.t("options.generalSection.blockedSites.remove")}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {siteStatusMsg && (
            <p
              className="text-xs text-green-600 dark:text-green-400"
              role="status"
              aria-live="polite"
            >
              {siteStatusMsg}
            </p>
          )}
        </div>
      </div>

      <div className="border-t" />

      {/* Feedback card */}
      <div className="rounded-xl border p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-foreground">
              {i18n.t("options.feedback.cardTitle")}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {i18n.t("options.feedback.cardDescription")}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                browser.tabs.create({
                  url: "https://github.com/sponsors/jheysaaz",
                })
              }
              title={i18n.t("options.feedback.donationTitle")}
            >
              <Heart className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
              {i18n.t("options.feedback.donationAction")}
            </Button>
            <Button size="sm" onClick={() => onNavigate?.("feedback")}>
              {i18n.t("options.feedback.cardAction")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Appearance
// ---------------------------------------------------------------------------

function AppearanceSection() {
  const { themeMode, setThemeMode } = useTheme();

  // --- Confetti preference ---
  const [confettiEnabled, setConfettiEnabled] = useState(true);

  useEffect(() => {
    confettiEnabledItem
      .getValue()
      .then((val) => {
        if (val === false) {
          setConfettiEnabled(false);
        }
      })
      .catch(console.warn);
  }, []);

  const handleConfettiToggle = (enabled: boolean) => {
    setConfettiEnabled(enabled);
    confettiEnabledItem.setValue(enabled).catch(console.warn);
  };

  const handlePreviewConfetti = () => {
    confetti({
      particleCount: 80,
      spread: 90,
      origin: { x: 0.5, y: 0.6 },
      colors: [
        "#6366f1",
        "#8b5cf6",
        "#ec4899",
        "#f59e0b",
        "#10b981",
        "#3b82f6",
      ],
      ticks: 100,
      gravity: 1.1,
      scalar: 0.9,
    });
  };

  const THEME_OPTIONS: {
    mode: ThemeMode;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      mode: "light",
      label: i18n.t("options.theme.light"),
      icon: <Sun className="h-5 w-5" strokeWidth={1.5} />,
    },
    {
      mode: "dark",
      label: i18n.t("options.theme.dark"),
      icon: <Moon className="h-5 w-5" strokeWidth={1.5} />,
    },
    {
      mode: "system",
      label: i18n.t("options.theme.system"),
      icon: <Monitor className="h-5 w-5" strokeWidth={1.5} />,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">
          {i18n.t("options.nav.appearance")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {i18n.t("options.appearance.description")}
        </p>
      </div>

      {/* Theme card */}
      <div className="rounded-xl border p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            {i18n.t("options.appearance.themeTitle")}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {i18n.t("options.appearance.themeDescription")}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {THEME_OPTIONS.map(({ mode, label, icon }) => {
            const active = themeMode === mode;
            return (
              <button
                key={mode}
                onClick={() => setThemeMode(mode)}
                className={cn(
                  "flex flex-col items-center justify-center gap-2.5 rounded-xl border p-4 text-sm transition-all duration-150",
                  active
                    ? "border-foreground bg-background shadow-sm font-medium text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                <span
                  className={cn(
                    "transition-colors",
                    active ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {icon}
                </span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Confetti card */}
      <div className="rounded-xl border p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <Sparkles
                className="h-3.5 w-3.5 text-muted-foreground"
                strokeWidth={1.5}
              />
              {i18n.t("options.appearance.confettiTitle")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {i18n.t("options.appearance.confettiDescription")}
            </p>
          </div>

          {/* Toggle switch */}
          <button
            role="switch"
            aria-checked={confettiEnabled}
            onClick={() => handleConfettiToggle(!confettiEnabled)}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              confettiEnabled ? "bg-foreground" : "bg-input"
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-lg transition-transform duration-200",
                confettiEnabled ? "translate-x-4" : "translate-x-0"
              )}
            />
          </button>
        </div>

        {/* Preview area */}
        <div className="rounded-lg bg-muted/50 border border-dashed p-4 flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            {confettiEnabled
              ? i18n.t("options.appearance.confettiPreviewHint")
              : i18n.t("options.appearance.confettiDisabledHint")}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={!confettiEnabled}
            onClick={handlePreviewConfetti}
            className="shrink-0 gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
            {i18n.t("options.appearance.confettiPreviewButton")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Feedback
// ---------------------------------------------------------------------------

interface FeedbackFormState {
  name: string;
  email: string;
  message: string;
  screenshotFile: File | null;
  submitting: boolean;
  submitted: boolean;
  error: string | null;
}

function FeedbackSection() {
  const [state, setState] = useState<FeedbackFormState>({
    name: "",
    email: "",
    message: "",
    screenshotFile: null,
    submitting: false,
    submitted: false,
    error: null,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInputChange =
    (
      field: keyof Omit<
        FeedbackFormState,
        "submitting" | "submitted" | "error" | "screenshotFile"
      >
    ) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setState((prev) => ({
        ...prev,
        [field]: e.target.value,
        error: null, // Clear error on input change
      }));
    };

  const handleScreenshotChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      setState((prev) => ({
        ...prev,
        screenshotFile: file,
      }));
    } else if (file) {
      setState((prev) => ({
        ...prev,
        error: "Please select an image file (PNG, JPG, GIF, etc.)",
      }));
    }
  };

  const handleRemoveScreenshot = () => {
    setState((prev) => ({
      ...prev,
      screenshotFile: null,
    }));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!state.message.trim()) {
      setState((prev) => ({
        ...prev,
        error: i18n.t("options.feedback.error"),
      }));
      return;
    }

    setState((prev) => ({ ...prev, submitting: true }));

    try {
      await sendUserFeedback({
        name: state.name.trim() || undefined,
        email: state.email.trim() || undefined,
        message: state.message.trim(),
        screenshot: state.screenshotFile || undefined,
      });

      setState((prev) => ({
        ...prev,
        submitted: true,
        submitting: false,
        name: "",
        email: "",
        message: "",
        screenshotFile: null,
      }));

      // Reset success message after 3 seconds
      setTimeout(() => {
        setState((prev) => ({ ...prev, submitted: false }));
      }, 3000);
    } catch (err) {
      console.error("[Clipio] Feedback submission failed:", err);
      captureError(err, { action: "sendUserFeedback" });
      setState((prev) => ({
        ...prev,
        submitting: false,
        error: i18n.t("options.feedback.error"),
      }));
    }
  };

  return (
    <div className="space-y-8">
      {/* Section header */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">
          {i18n.t("options.feedback.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {i18n.t("options.feedback.description")}
        </p>
      </div>

      {/* Feedback form card */}
      <div className="rounded-xl border p-6 space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name field */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="feedback-name">
                {i18n.t("options.feedback.nameLabel")}
              </Label>
              <InfoTooltip text={i18n.t("options.feedback.nameTooltip")} />
            </div>
            <input
              id="feedback-name"
              type="text"
              placeholder={i18n.t("options.feedback.namePlaceholder")}
              value={state.name}
              onChange={handleInputChange("name")}
              disabled={state.submitting}
              className={cn(
                "flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                state.submitting && "opacity-60"
              )}
            />
          </div>

          {/* Email field */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="feedback-email">
                {i18n.t("options.feedback.emailLabel")}
              </Label>
              <InfoTooltip text={i18n.t("options.feedback.emailTooltip")} />
            </div>
            <input
              id="feedback-email"
              type="email"
              placeholder={i18n.t("options.feedback.emailPlaceholder")}
              value={state.email}
              onChange={handleInputChange("email")}
              disabled={state.submitting}
              className={cn(
                "flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                state.submitting && "opacity-60"
              )}
            />
          </div>

          {/* Message field */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="feedback-message">
                {i18n.t("options.feedback.messageLabel")}
              </Label>
              <InfoTooltip text={i18n.t("options.feedback.messageTooltip")} />
            </div>
            <textarea
              id="feedback-message"
              placeholder={i18n.t("options.feedback.messagePlaceholder")}
              value={state.message}
              onChange={handleInputChange("message")}
              disabled={state.submitting}
              rows={5}
              className={cn(
                "flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                "resize-none",
                state.submitting && "opacity-60"
              )}
            />
          </div>

          {/* Screenshot field */}
          <div className="space-y-2">
            <Label htmlFor="feedback-screenshot">
              {i18n.t("options.feedback.screenshotLabel")}
            </Label>
            {state.screenshotFile ? (
              <div className="space-y-2">
                <div className="rounded-lg border bg-muted/50 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="h-8 w-8 rounded bg-muted shrink-0" />
                      <span className="text-sm text-muted-foreground truncate">
                        {i18n.t("options.feedback.screenshotSelected", [
                          state.screenshotFile.name,
                        ])}
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={handleRemoveScreenshot}
                      disabled={state.submitting}
                      className="text-xs"
                    >
                      {i18n.t("options.feedback.removeScreenshot")}
                    </Button>
                  </div>
                  <img
                    src={URL.createObjectURL(state.screenshotFile)}
                    alt="Screenshot preview"
                    className="max-h-40 rounded border"
                  />
                </div>
              </div>
            ) : (
              <label
                htmlFor="feedback-screenshot"
                className={cn(
                  "flex items-center justify-center h-24 rounded-lg border-2 border-dashed border cursor-pointer hover:bg-muted/50 transition-colors",
                  state.submitting && "opacity-60 cursor-not-allowed"
                )}
              >
                <span className="text-sm text-muted-foreground">
                  {i18n.t("options.feedback.screenshotPlaceholder")}
                </span>
              </label>
            )}
            <input
              id="feedback-screenshot"
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleScreenshotChange}
              disabled={state.submitting}
              className="hidden"
            />
          </div>

          {/* Error message */}
          <InlineError
            message={state.error}
            onDismiss={() => setState((prev) => ({ ...prev, error: null }))}
            className="rounded-lg border border-red-200 dark:border-red-800"
          />

          {/* Success message */}
          {state.submitted && (
            <div
              className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-4 py-3 flex items-start gap-3"
              role="status"
              aria-live="polite"
            >
              <Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
              <p className="text-sm text-green-700 dark:text-green-300">
                {i18n.t("options.feedback.success")}
              </p>
            </div>
          )}

          {/* Submit button */}
          <div className="flex gap-3 justify-end pt-2">
            <Button
              type="submit"
              disabled={state.submitting || !state.message.trim()}
              className="gap-2"
            >
              {state.submitting ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  {i18n.t("options.feedback.submitting")}
                </>
              ) : (
                i18n.t("options.feedback.submit")
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Developers
// ---------------------------------------------------------------------------

/**
 * Sanitise debug log entries loaded from storage.
 *
 * Old/corrupted entries may have non-string values in `context`, `event`,
 * or `detail` (e.g. an object instead of a string).  This normaliser
 * coerces every text field to a safe string so React never receives a raw
 * object as a child node.  Entries that are too broken to salvage are
 * dropped entirely.
 */
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

function DevelopersSection() {
  // Giphy API Key
  const [giphyKey, setGiphyKey] = useState("");
  const [giphyKeySaved, setGiphyKeySaved] = useState(false);
  const [giphyKeyError, setGiphyKeyError] = useState<string | null>(null);

  // Card 2: Version & Update
  const [currentVersion] = useState(
    () => browser.runtime.getManifest().version
  );
  const [latestRelease, setLatestRelease] = useState<{
    version: string;
    htmlUrl: string;
    publishedAt: string;
  } | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState("");

  // Card 3: Content Script Health
  const [pingStatus, setPingStatus] = useState<
    "idle" | "pinging" | "pong" | "error"
  >("idle");
  const [pingError, setPingError] = useState("");

  // Card 4: Storage Mode & Quota
  const [storageMode, setStorageMode] = useState<StorageMode>("sync");
  const [syncUsed, setSyncUsed] = useState<number | null>(null);
  const [switchConfirming, setSwitchConfirming] = useState<StorageMode | null>(
    null
  );
  const [switching, setSwitching] = useState(false);
  const [switchSwitched, setSwitchSwitched] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // Card: Typing Timeout
  const [typingTimeout, setTypingTimeout] = useState<number>(
    TIMING.TYPING_TIMEOUT
  );
  const [timeoutSaved, setTimeoutSaved] = useState(false);
  const timeoutSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Card 5: Top 5 Usage
  const [topUsage, setTopUsage] = useState<
    { id: string; label: string; shortcut: string; count: number }[]
  >([]);
  const [usageLoaded, setUsageLoaded] = useState(false);

  // Card: Debug Mode
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [debugLog, setDebugLog] = useState<DebugLogEntry[]>([]);
  const [copiedLog, setCopiedLog] = useState(false);
  const debugLogRef = useRef<HTMLDivElement>(null);

  // Card 6: Clear IDB Backup
  const [clearConfirming, setClearConfirming] = useState(false);
  const [clearCleared, setClearCleared] = useState(false);

  useEffect(() => {
    giphyApiKeyItem
      .getValue()
      .then((val) => setGiphyKey(val ?? ""))
      .catch(console.warn);
  }, []);

  // Load version / update data
  useEffect(() => {
    latestVersionItem
      .getValue()
      .then((v) => setLatestRelease(v))
      .catch(console.warn);
    dismissedUpdateVersionItem
      .getValue()
      .then((v) => setDismissedVersion(v))
      .catch(console.warn);
  }, []);

  // Load storage status
  useEffect(() => {
    getStorageStatus()
      .then((status) => {
        setStorageMode(status.mode);
      })
      .catch(console.warn);
    // Estimate sync bytes used via Blob size of all sync keys
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

  // Load typing timeout
  useEffect(() => {
    typingTimeoutItem
      .getValue()
      .then((val) => setTypingTimeout(val))
      .catch(console.warn);
  }, []);

  // Load top-5 usage
  useEffect(() => {
    Promise.all([usageCountsItem.getValue(), getSnippets()])
      .then(([counts, snippets]) => {
        const entries = Object.entries(counts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([id, count]) => {
            const snippet = snippets.find((s) => s.id === id);
            return {
              id,
              label: snippet?.label ?? snippet?.shortcut ?? id,
              shortcut: snippet?.shortcut ?? "",
              count,
            };
          });
        setTopUsage(entries);
        setUsageLoaded(true);
      })
      .catch(console.warn);
  }, []);

  // Load debug mode state and log entries
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
        // Persist the normalized form back so stale object-detail entries
        // don't cause future crashes after a browser restart.
        if (normalized.some((e, i) => e.detail !== entries[i]?.detail)) {
          debugLogItem.setValue(normalized).catch(() => {});
        }
      })
      .catch(console.warn);

    // Watch for live log updates
    const unwatch = debugLogItem.watch((entries) => {
      setDebugLog(normalizeDebugEntries(entries));
    });
    return () => {
      unwatch();
    };
  }, []);

  // Auto-scroll debug log panel to bottom when new entries arrive
  useEffect(() => {
    if (debugLogRef.current) {
      debugLogRef.current.scrollTop = debugLogRef.current.scrollHeight;
    }
  }, [debugLog]);

  const handleSaveGiphyKey = async () => {
    try {
      await giphyApiKeyItem.setValue(giphyKey.trim());
      setGiphyKeySaved(true);
      setTimeout(() => setGiphyKeySaved(false), 2000);
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
      setGiphyKeySaved(true);
      setTimeout(() => setGiphyKeySaved(false), 2000);
    } catch (err) {
      captureError(err, { action: "resetGiphyApiKey" });
    }
  };

  // Card: Typing Timeout — persist with a debounced save indicator
  const handleTimeoutChange = (newVal: number) => {
    setTypingTimeout(newVal);
    if (timeoutSaveTimer.current) clearTimeout(timeoutSaveTimer.current);
    timeoutSaveTimer.current = setTimeout(async () => {
      try {
        await typingTimeoutItem.setValue(newVal);
        setTimeoutSaved(true);
        setTimeout(() => setTimeoutSaved(false), 2000);
      } catch (err) {
        captureError(err, { action: "saveTypingTimeout" });
      }
    }, 400);
  };

  const handleTimeoutReset = async () => {
    const def = TIMING.TYPING_TIMEOUT;
    setTypingTimeout(def);
    try {
      await typingTimeoutItem.setValue(def);
      setTimeoutSaved(true);
      setTimeout(() => setTimeoutSaved(false), 2000);
    } catch (err) {
      captureError(err, { action: "resetTypingTimeout" });
    }
  };

  // Card 4: Force storage switch
  const handleForceSwitch = async (target: StorageMode) => {
    setSwitching(true);
    setSwitchError(null);
    try {
      await forceSetStorageMode(target);
      setStorageMode(target);
      setSwitchSwitched(true);
      setSwitchConfirming(null);
      setTimeout(() => setSwitchSwitched(false), 2000);
    } catch (err) {
      captureError(err, { action: "forceSetStorageMode", target });
      setSwitchError(i18n.t("options.developers.storageMode.switchError"));
      setSwitchConfirming(null);
    } finally {
      setSwitching(false);
    }
  };

  // Card: Debug Mode toggle
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
      setCopiedLog(true);
      setTimeout(() => setCopiedLog(false), 2000);
    } catch (err) {
      captureError(err, { action: "copyDebugLog" });
    }
  };

  // Card 3: Ping content script
  const handlePing = async () => {
    setPingStatus("pinging");
    setPingError("");
    try {
      // Query all active tabs across all windows, then pick the most-recently
      // focused one that is a real web page (not an extension or browser page).
      // Using `currentWindow: true` would return the options tab itself, which
      // has no content script.
      const tabs = await browser.tabs.query({ active: true });
      const webTab = tabs.find(
        (t) =>
          t.url &&
          !t.url.startsWith("chrome://") &&
          !t.url.startsWith("chrome-extension://") &&
          !t.url.startsWith("about:") &&
          !t.url.startsWith("edge://") &&
          !t.url.startsWith("moz-extension://")
      );
      const tab = webTab ?? tabs.find((t) => t.id !== undefined);
      if (!tab?.id) {
        setPingStatus("error");
        setPingError(
          i18n.t("options.developers.contentScriptHealth.errorNoTab")
        );
        return;
      }
      const response = await browser.tabs
        .sendMessage(tab.id, { type: CONTENT_SCRIPT_PING_MESSAGE_TYPE })
        .catch(() => null);
      if (response && (response as { pong?: boolean }).pong) {
        setPingStatus("pong");
      } else {
        setPingStatus("error");
        setPingError(
          i18n.t("options.developers.contentScriptHealth.errorNoContentScript")
        );
      }
    } catch {
      setPingStatus("error");
      setPingError(
        i18n.t("options.developers.contentScriptHealth.errorGeneric")
      );
    }
  };

  // Card 6: Clear IDB backup
  const handleClearIdb = async () => {
    try {
      await clearIDBBackup();
      setClearConfirming(false);
      setClearCleared(true);
      setTimeout(() => setClearCleared(false), 2000);
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

      {/* Experimental warning banner */}
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
            {giphyKeySaved ? (
              <>
                <Check
                  className="h-3.5 w-3.5 mr-1.5 text-green-400"
                  strokeWidth={1.5}
                />
                {i18n.t("options.developers.giphyApiKey.saved")}
              </>
            ) : (
              i18n.t("common.save")
            )}
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

      {/* Card 2: Extension Version & Update */}
      <div className="rounded-xl border p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            {i18n.t("options.developers.versionUpdate.title")}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {i18n.t("options.developers.versionUpdate.description")}
          </p>
        </div>
        <p className="text-sm text-foreground">
          {i18n.t("options.developers.versionUpdate.currentVersion", [
            currentVersion,
          ])}
        </p>
        {latestRelease && latestRelease.version !== dismissedVersion && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-amber-600 dark:text-amber-400">
              {i18n.t("options.developers.versionUpdate.updateAvailable", [
                latestRelease.version,
              ])}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-9 shrink-0"
              onClick={() =>
                browser.tabs.create({ url: latestRelease.htmlUrl })
              }
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
              {i18n.t("options.developers.versionUpdate.openRelease")}
            </Button>
          </div>
        )}
        {(!latestRelease || latestRelease.version === dismissedVersion) && (
          <p className="text-xs text-muted-foreground">
            {i18n.t("options.developers.versionUpdate.upToDate")}
          </p>
        )}
      </div>

      {/* Card 3: Content Script Health */}
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
          {pingStatus === "pong" && (
            <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
              {i18n.t("options.developers.contentScriptHealth.pong")}
            </span>
          )}
          {pingStatus === "error" && (
            <span className="text-xs text-destructive">{pingError}</span>
          )}
        </div>
      </div>

      {/* Card 4: Storage Mode & Quota */}
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
        {/* Force switch buttons */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {switchSwitched ? (
            <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
              {i18n.t("options.developers.storageMode.switched")}
            </span>
          ) : switchConfirming ? (
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

      {/* Card: Typing Timeout */}
      <div className="rounded-xl border p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            {i18n.t("options.developers.typingTimeout.title")}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {i18n.t("options.developers.typingTimeout.description")}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={50}
            max={2000}
            step={50}
            value={typingTimeout}
            onChange={(e) => handleTimeoutChange(Number(e.target.value))}
            className="flex-1 h-2 accent-primary cursor-pointer"
            aria-label={i18n.t("options.developers.typingTimeout.title")}
          />
          <span className="text-sm font-mono w-20 text-right shrink-0 text-foreground">
            {i18n.t("options.developers.typingTimeout.label", [
              String(typingTimeout),
            ])}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 shrink-0"
            onClick={handleTimeoutReset}
            disabled={typingTimeout === TIMING.TYPING_TIMEOUT}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
            {i18n.t("options.developers.typingTimeout.reset")}
          </Button>
          {timeoutSaved && (
            <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
              {i18n.t("options.developers.typingTimeout.saved")}
            </span>
          )}
        </div>
      </div>

      {/* Card 5: Top 5 Usage */}
      <div className="rounded-xl border p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            {i18n.t("options.developers.topUsage.title")}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {i18n.t("options.developers.topUsage.description")}
          </p>
        </div>
        {usageLoaded && topUsage.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {i18n.t("options.developers.topUsage.empty")}
          </p>
        )}
        {topUsage.length > 0 && (
          <ul className="space-y-2">
            {topUsage.map(({ id, label, shortcut, count }) => (
              <li
                key={id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate text-sm text-foreground">
                    {label}
                  </span>
                  {shortcut && (
                    <span className="shrink-0 font-mono text-xs bg-muted text-muted-foreground rounded px-1.5 py-0.5 border border-border">
                      {shortcut}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {i18n.t("options.developers.topUsage.count", [String(count)])}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Card: Debug Mode */}
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
          {/* Native checkbox styled as a toggle */}
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
                  {copiedLog ? (
                    <>
                      <Check className="h-3 w-3 mr-1" strokeWidth={1.5} />
                      {i18n.t("options.developers.debugMode.copiedLog")}
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3 mr-1" strokeWidth={1.5} />
                      {i18n.t("options.developers.debugMode.copyLog")}
                    </>
                  )}
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

      {/* Card 6: Clear IDB Backup */}
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
          {clearCleared ? (
            <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
              {i18n.t("options.developers.clearIdb.cleared")}
            </span>
          ) : clearConfirming ? (
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
            notification and transitions state to "shown". Click the
            notification to complete the "rated" flow. Only visible in
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

      {/* Dev only: Test Sentry (options + content script) */}
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
                    } catch {
                      // No content script in this tab, try next
                    }
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

// ---------------------------------------------------------------------------
// Section: Images
// ---------------------------------------------------------------------------

interface ImageItem {
  meta: MediaMetadata;
  objectUrl: string | null;
  referencingSnippets: string[]; // snippet labels
}

type ImageViewMode = "list" | "grid";

function ImagesSection() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ImageViewMode>("list");
  const objectUrlsRef = useRef<string[]>([]);

  // Description (alt text) editing
  const [altDraft, setAltDraft] = useState<Record<string, string>>({});
  const [altSaved, setAltSaved] = useState<Record<string, boolean>>({});
  const [altErrors, setAltErrors] = useState<Record<string, string>>({});

  const handleSaveAlt = useCallback(
    async (id: string) => {
      const draft = altDraft[id] ?? "";
      try {
        await updateMediaAlt(id, draft);
        setItems((prev) =>
          prev.map((item) =>
            item.meta.id === id
              ? {
                  ...item,
                  meta: { ...item.meta, alt: draft.trim() || undefined },
                }
              : item
          )
        );
        setAltErrors((prev) => ({ ...prev, [id]: "" }));
        setAltSaved((prev) => ({ ...prev, [id]: true }));
        setTimeout(
          () => setAltSaved((prev) => ({ ...prev, [id]: false })),
          2000
        );
      } catch {
        setAltErrors((prev) => ({
          ...prev,
          [id]: i18n.t("options.images.errors.failedToSaveDescription"),
        }));
      }
    },
    [altDraft]
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [mediaList, snippets] = await Promise.all([
          listMedia(),
          getSnippets(),
        ]);

        if (cancelled) return;

        // Build a lookup: imageId -> list of snippet labels that reference it
        const refMap: Record<string, string[]> = {};
        for (const snippet of snippets) {
          const matches = snippet.content.matchAll(
            /\{\{image:([a-f0-9-]+)(?::\d+)?\}\}/g
          );
          for (const match of matches) {
            const id = match[1];
            if (!refMap[id]) refMap[id] = [];
            if (!refMap[id].includes(snippet.label)) {
              refMap[id].push(snippet.label);
            }
          }
        }

        // Load blobs for thumbnails
        const resolved: ImageItem[] = await Promise.all(
          mediaList.map(async (meta) => {
            try {
              const entry = await getMedia(meta.id);
              if (entry?.blob) {
                const url = URL.createObjectURL(entry.blob);
                objectUrlsRef.current.push(url);
                return {
                  meta,
                  objectUrl: url,
                  referencingSnippets: refMap[meta.id] ?? [],
                };
              }
            } catch {
              // blob unavailable — show broken state
            }
            return {
              meta,
              objectUrl: null,
              referencingSnippets: refMap[meta.id] ?? [],
            };
          })
        );

        if (!cancelled) {
          setItems(resolved);
          // Pre-populate draft alt values from stored metadata
          setAltDraft(
            Object.fromEntries(
              resolved.map((item) => [item.meta.id, item.meta.alt ?? ""])
            )
          );
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          captureError(err, { action: "imagesSection.load" });
          setLoadError(i18n.t("options.images.errors.failedToLoad"));
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      // Revoke all blob URLs on unmount
      for (const url of objectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      objectUrlsRef.current = [];
    };
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await deleteMedia(id);
      // Revoke the object URL for this item
      const item = items.find((i) => i.meta.id === id);
      if (item?.objectUrl) {
        URL.revokeObjectURL(item.objectUrl);
        objectUrlsRef.current = objectUrlsRef.current.filter(
          (u) => u !== item.objectUrl
        );
      }
      setItems((prev) => prev.filter((i) => i.meta.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      captureError(err, { action: "imagesSection.delete", imageId: id });
      setDeleteErrors((prev) => ({
        ...prev,
        [id]: i18n.t("options.images.errors.failedToDelete"),
      }));
      setConfirmDeleteId(null);
    }
  };

  const totalBytes = items.reduce((sum, item) => sum + item.meta.size, 0);
  const totalKB = (totalBytes / 1024).toFixed(1);
  const maxKB = (MEDIA_LIMITS.MAX_TOTAL_SIZE / 1024).toFixed(0);
  const totalPercent = Math.min(
    100,
    Math.round((totalBytes / MEDIA_LIMITS.MAX_TOTAL_SIZE) * 100)
  );

  const confirmItem = confirmDeleteId
    ? items.find((i) => i.meta.id === confirmDeleteId)
    : null;

  return (
    <div className="space-y-8">
      {/* Section header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">
            {i18n.t("options.images.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {i18n.t("options.images.description")}
          </p>
        </div>
        {/* View toggle */}
        {!loading && items.length > 0 && (
          <div className="flex shrink-0 items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5">
            <button
              onClick={() => setViewMode("list")}
              aria-label={i18n.t("options.images.viewList")}
              title={i18n.t("options.images.viewList")}
              className={cn(
                "flex items-center justify-center h-7 w-7 rounded-md transition-all",
                viewMode === "list"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LayoutList className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              aria-label={i18n.t("options.images.viewGrid")}
              title={i18n.t("options.images.viewGrid")}
              className={cn(
                "flex items-center justify-center h-7 w-7 rounded-md transition-all",
                viewMode === "grid"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        )}
      </div>

      {/* Storage usage bar */}
      {!loading && items.length > 0 && (
        <div className="rounded-xl border p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Images
                className="h-3.5 w-3.5 text-muted-foreground"
                strokeWidth={1.5}
              />
              <span className="text-xs text-muted-foreground">
                {i18n.t("options.images.totalStorage")}
              </span>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {totalKB} / {maxKB} KB
            </span>
          </div>
          <Progress
            value={totalPercent}
            className={cn(
              totalPercent >= 80
                ? "[&>div]:bg-amber-500"
                : "[&>div]:bg-indigo-500 dark:[&>div]:bg-indigo-400"
            )}
          />
        </div>
      )}

      {/* Load error */}
      {loadError && (
        <InlineError
          message={loadError}
          onDismiss={() => setLoadError(null)}
          className="rounded-lg border border-red-200 dark:border-red-800"
        />
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
          {i18n.t("options.images.loading")}
        </div>
      )}

      {/* Empty state */}
      {!loading && !loadError && items.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 flex flex-col items-center justify-center gap-3 text-center">
          <Images
            className="h-8 w-8 text-muted-foreground/40"
            strokeWidth={1}
          />
          <p className="text-sm text-muted-foreground max-w-xs">
            {i18n.t("options.images.empty")}
          </p>
        </div>
      )}

      {/* Image list / grid */}
      {!loading && items.length > 0 && viewMode === "list" && (
        <div className="space-y-3">
          {items.map((item) => {
            const sizeKB = (item.meta.size / 1024).toFixed(1);
            const ext = item.meta.mimeType.split("/")[1]?.toUpperCase() ?? "";

            return (
              <div
                key={item.meta.id}
                className="rounded-xl border p-4 flex items-start gap-4"
              >
                {/* Thumbnail */}
                <div className="shrink-0 h-16 w-16 rounded-lg border bg-muted/50 overflow-hidden flex items-center justify-center">
                  {item.objectUrl ? (
                    <img
                      src={item.objectUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Images
                      className="h-6 w-6 text-muted-foreground/40"
                      strokeWidth={1}
                    />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-xs font-mono text-muted-foreground truncate">
                    {item.meta.id}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>{ext}</span>
                    {item.meta.width > 0 && item.meta.height > 0 && (
                      <span>
                        {i18n.t("options.images.dimensions", [
                          item.meta.width,
                          item.meta.height,
                        ])}
                      </span>
                    )}
                    <span>{sizeKB} KB</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {item.referencingSnippets.length > 0 ? (
                      i18n.t("options.images.referencedBy", [
                        item.referencingSnippets.join(", "),
                      ])
                    ) : (
                      <span className="italic">
                        {i18n.t("options.images.noReferences")}
                      </span>
                    )}
                  </p>
                  {/* Editable description (alt text) */}
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <Input
                      type="text"
                      value={altDraft[item.meta.id] ?? ""}
                      onChange={(e) =>
                        setAltDraft((prev) => ({
                          ...prev,
                          [item.meta.id]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveAlt(item.meta.id);
                      }}
                      placeholder={i18n.t("options.images.altText.placeholder")}
                      aria-label={i18n.t("options.images.altText.label")}
                      className="h-7 text-[11px] flex-1"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0 h-7 text-[11px] px-2"
                      onClick={() => handleSaveAlt(item.meta.id)}
                    >
                      {altSaved[item.meta.id] ? (
                        <Check
                          className="h-3 w-3 text-green-500"
                          strokeWidth={2.5}
                        />
                      ) : (
                        i18n.t("common.save")
                      )}
                    </Button>
                  </div>
                  {altErrors[item.meta.id] && (
                    <p className="text-[11px] text-red-600 dark:text-red-400">
                      {altErrors[item.meta.id]}
                    </p>
                  )}
                  {deleteErrors[item.meta.id] && (
                    <p className="text-[11px] text-red-600 dark:text-red-400">
                      {deleteErrors[item.meta.id]}
                    </p>
                  )}
                </div>

                {/* Delete button */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 h-8 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmDeleteId(item.meta.id)}
                  aria-label={`${i18n.t("options.images.deleteButton")} ${item.meta.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
                  {i18n.t("options.images.deleteButton")}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Grid view */}
      {!loading && items.length > 0 && viewMode === "grid" && (
        <div className="grid grid-cols-3 gap-3">
          {items.map((item) => {
            const sizeKB = (item.meta.size / 1024).toFixed(1);
            const ext = item.meta.mimeType.split("/")[1]?.toUpperCase() ?? "";

            return (
              <div
                key={item.meta.id}
                className="group relative rounded-xl border bg-muted/20 overflow-hidden flex flex-col"
              >
                {/* Image area */}
                <div className="relative aspect-square bg-muted/50 flex items-center justify-center overflow-hidden">
                  {item.objectUrl ? (
                    <img
                      src={item.objectUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Images
                      className="h-8 w-8 text-muted-foreground/30"
                      strokeWidth={1}
                    />
                  )}

                  {/* Hover overlay with delete */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <button
                      onClick={() => setConfirmDeleteId(item.meta.id)}
                      aria-label={`${i18n.t("options.images.deleteButton")} ${item.meta.id}`}
                      className="h-8 w-8 rounded-full bg-background/90 flex items-center justify-center text-destructive hover:bg-background transition-colors shadow-sm"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>

                {/* Caption */}
                <div className="px-2.5 py-2 space-y-0.5">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="font-medium">{ext}</span>
                    <span>·</span>
                    <span>{sizeKB} KB</span>
                    {item.meta.width > 0 && item.meta.height > 0 && (
                      <>
                        <span>·</span>
                        <span>
                          {item.meta.width}×{item.meta.height}
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {item.referencingSnippets.length > 0 ? (
                      i18n.t("options.images.referencedBy", [
                        item.referencingSnippets.join(", "),
                      ])
                    ) : (
                      <span className="italic">
                        {i18n.t("options.images.noReferences")}
                      </span>
                    )}
                  </p>
                  {/* Editable description (alt text) */}
                  <div className="flex items-center gap-1 pt-0.5">
                    <Input
                      type="text"
                      value={altDraft[item.meta.id] ?? ""}
                      onChange={(e) =>
                        setAltDraft((prev) => ({
                          ...prev,
                          [item.meta.id]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveAlt(item.meta.id);
                      }}
                      placeholder={i18n.t("options.images.altText.placeholder")}
                      aria-label={i18n.t("options.images.altText.label")}
                      className="h-6 text-[10px] flex-1 px-1.5"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0 h-6 text-[10px] px-1.5"
                      onClick={() => handleSaveAlt(item.meta.id)}
                    >
                      {altSaved[item.meta.id] ? (
                        <Check
                          className="h-2.5 w-2.5 text-green-500"
                          strokeWidth={2.5}
                        />
                      ) : (
                        i18n.t("common.save")
                      )}
                    </Button>
                  </div>
                  {altErrors[item.meta.id] && (
                    <p className="text-[10px] text-red-600 dark:text-red-400">
                      {altErrors[item.meta.id]}
                    </p>
                  )}
                  {deleteErrors[item.meta.id] && (
                    <p className="text-[10px] text-red-600 dark:text-red-400">
                      {deleteErrors[item.meta.id]}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirmation overlay */}
      {confirmItem && (
        <div
          className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 flex items-center justify-center p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape") setConfirmDeleteId(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="bg-background rounded-2xl border shadow-xl w-full max-w-sm p-6 space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 h-8 w-8 rounded-full bg-red-100 dark:bg-red-950/40 flex items-center justify-center">
                <Trash2
                  className="h-4 w-4 text-red-600 dark:text-red-400"
                  strokeWidth={1.5}
                />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">
                  {i18n.t("options.images.deleteConfirmTitle")}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {confirmItem.referencingSnippets.length > 0
                    ? i18n.t("options.images.deleteConfirmMessage", [
                        confirmItem.referencingSnippets.length,
                      ])
                    : i18n.t("options.images.deleteConfirmMessageNoRefs")}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmDeleteId(null)}
              >
                {i18n.t("common.cancel")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => handleDelete(confirmItem.meta.id)}
              >
                {i18n.t("options.images.deleteButton")}
              </Button>
            </div>
          </div>
        </div>
      )}
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
      setExportError(i18n.t("options.errors.failedExport"));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          {i18n.t("options.importExport.title")}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {i18n.t("options.importExport.description")}
        </p>
      </div>

      {/* Export card */}
      <div className="rounded-xl border p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-foreground">
              {i18n.t("options.importExport.exportCard.title")}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
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
      <div className="rounded-xl border p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-foreground">
              {i18n.t("options.importExport.importCard.title")}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
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
        <div className="pt-2 border-t flex flex-wrap gap-1.5">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium self-center">
            {i18n.t("options.importExport.importCard.supported")}
          </span>
          {[
            { label: "Clipio", icon: "/icon/128.png" },
            { label: "TextBlaze", icon: "/icon/textblaze.png" },
            { label: "PowerText", icon: "/icon/powertext.png" },
          ].map(({ label, icon }) => (
            <span
              key={label}
              className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground"
            >
              <img src={icon} alt={label} className="h-3.5 w-3.5 rounded-sm" />
              {label}
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
            className="bg-background rounded-2xl border shadow-xl w-full max-w-lg p-6 max-h-[min(90vh,640px)] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-5">
              <h2
                id="import-wizard-title"
                className="text-base font-semibold text-foreground"
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
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground" />
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
const SIDEBAR_DEFAULT = 260;

export default function OptionsPage() {
  const [activeSection, setActiveSection] = useState<NavSection>(() => {
    const hash = window.location.hash.slice(1) as NavSection;
    const valid: NavSection[] = [
      "general",
      "import-export",
      "appearance",
      "images",
      "developers",
      "feedback",
    ];
    return valid.includes(hash) ? hash : "general";
  });
  const [navSearch, setNavSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const navSearchRef = useRef<HTMLInputElement>(null);

  // Uninstall data-loss warning (shown once on first open)
  const [showUninstallWarning, setShowUninstallWarning] = useState(false);

  useEffect(() => {
    dismissedUninstallWarningItem
      .getValue()
      .then((dismissed) => {
        if (!dismissed) setShowUninstallWarning(true);
      })
      .catch(console.warn);
  }, []);

  // Review banner — shown when reviewPromptState is "shown" and no recent error
  const [showReviewBanner, setShowReviewBanner] = useState(false);

  useEffect(() => {
    Promise.all([
      reviewPromptStateItem.getValue(),
      lastSentryErrorAtItem.getValue(),
    ])
      .then(([state, lastErrorAt]) => {
        if (state !== "shown") return;
        if (lastErrorAt) {
          const errorAgeMs = Date.now() - new Date(lastErrorAt).getTime();
          const twentyFourHoursMs = 24 * 60 * 60 * 1000;
          if (errorAgeMs < twentyFourHoursMs) return;
        }
        setShowReviewBanner(true);
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

  // Focus search on ⌘K / Ctrl+K
  useEffect(() => {
    const handleSearchShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (!sidebarOpen) setSidebarOpen(true);
        // Wait for sidebar to open before focusing
        setTimeout(() => {
          navSearchRef.current?.focus();
          navSearchRef.current?.select();
        }, 10);
      }
    };
    document.addEventListener("keydown", handleSearchShortcut);
    return () => document.removeEventListener("keydown", handleSearchShortcut);
  }, [sidebarOpen]);

  return (
    <div className="flex h-screen overflow-hidden bg-background select-none">
      {/* Sidebar */}
      <aside
        style={{ width: sidebarOpen ? sidebarWidth : 0 }}
        className="shrink-0 relative flex flex-col bg-muted/50 border-r overflow-hidden min-w-0 transition-[width] duration-200 ease-in-out"
      >
        {/* Header */}
        <div className="px-4 pt-5 pb-3 flex items-center gap-2.5">
          <img src="/icon/128.png" alt="Clipio" className="w-7 h-7 shrink-0" />
          <span className="text-sm font-semibold text-foreground truncate flex-1">
            {i18n.t("options.sidebarSettings")}
          </span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="shrink-0 h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-3">
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
              strokeWidth={1.5}
            />
            <Input
              ref={navSearchRef}
              type="text"
              placeholder="Quick search…"
              value={navSearch}
              onChange={(e) => setNavSearch(e.target.value)}
              className="pl-8 pr-12 h-8 text-xs rounded-lg bg-background"
            />
            {!navSearch && (
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex h-5 select-none items-center rounded border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground">
                {/mac/i.test(navigator.platform) ? "⌘K" : "Ctrl+K"}
              </kbd>
            )}
          </div>
        </div>

        <div className="mx-3 mb-2 h-px bg-border" />

        {/* Nav */}
        <nav className="flex-1 px-2 py-1 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.filter((item) => {
            const q = navSearch.toLowerCase();
            if (!q) return item.id !== "feedback";
            return (
              item.label.toLowerCase().includes(q) ||
              item.keywords?.some((kw) => kw.includes(q))
            );
          }).map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveSection(item.id);
                setNavSearch("");
              }}
              aria-current={activeSection === item.id ? "page" : undefined}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150",
                activeSection === item.id
                  ? "bg-background text-foreground shadow-sm font-medium border"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <span
                className={cn(
                  "shrink-0 transition-colors",
                  activeSection === item.id
                    ? "text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {item.icon}
              </span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}
          {navSearch &&
            NAV_ITEMS.filter((item) => {
              const q = navSearch.toLowerCase();
              return (
                item.label.toLowerCase().includes(q) ||
                item.keywords?.some((kw) => kw.includes(q))
              );
            }).length === 0 && (
              <p className="text-xs text-muted-foreground px-3 py-2">
                No results
              </p>
            )}
        </nav>

        {/* Feedback (bottom pinned) */}
        <div className="mx-3 my-3 h-px bg-border" />
        <div className="px-2 pb-4">
          <button
            onClick={() => {
              setActiveSection("feedback");
              setNavSearch("");
            }}
            aria-current={activeSection === "feedback" ? "page" : undefined}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150",
              activeSection === "feedback"
                ? "bg-background text-foreground shadow-sm font-medium border"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            <MessageSquareText
              className={cn(
                "h-4 w-4 shrink-0 transition-colors",
                activeSection === "feedback"
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
              strokeWidth={1.5}
            />
            <span className="truncate">{i18n.t("options.nav.feedback")}</span>
          </button>
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
          <div className="absolute inset-y-0 right-0 w-0.5 bg-transparent group-hover:bg-border transition-colors" />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto select-text">
        {!sidebarOpen && (
          <div className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-sm px-3 py-1.5 flex items-center">
            <button
              onClick={() => setSidebarOpen(true)}
              className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Open sidebar"
              aria-label="Open sidebar"
            >
              <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
        )}
        <div className="max-w-2xl mx-auto px-8 py-8">
          {showUninstallWarning && (
            <Alert className="mb-6 border-amber-200 bg-amber-50 text-amber-800 [&>svg]:text-amber-500 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:[&>svg]:text-amber-400">
              <AlertTriangle />
              <AlertDescription className="text-amber-800 dark:text-amber-300">
                {i18n.t("options.warnings.uninstall.body")}
              </AlertDescription>
              <AlertAction>
                <button
                  onClick={() => {
                    setShowUninstallWarning(false);
                    dismissedUninstallWarningItem
                      .setValue(true)
                      .catch(console.warn);
                  }}
                  className="opacity-50 hover:opacity-100 transition-opacity"
                  aria-label="Dismiss"
                >
                  <X className="size-3.5" strokeWidth={2} />
                </button>
              </AlertAction>
            </Alert>
          )}
          {showReviewBanner && (
            <Alert className="mb-6 border-blue-200 bg-blue-50 text-blue-800 [&>svg]:text-blue-500 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 dark:[&>svg]:text-blue-400">
              <Heart className="h-4 w-4" strokeWidth={1.5} />
              <AlertDescription className="text-blue-800 dark:text-blue-300">
                <span className="font-medium">
                  {i18n.t("options.feedback.reviewBannerTitle")}
                </span>{" "}
                {i18n.t("options.feedback.reviewBannerDescription")}
              </AlertDescription>
              <AlertAction>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      browser.tabs.create({ url: getStoreReviewUrl() });
                      setReviewPromptState("rated").catch(console.warn);
                      setShowReviewBanner(false);
                    }}
                    className="text-xs font-medium text-blue-700 dark:text-blue-300 hover:underline"
                  >
                    {i18n.t("options.feedback.reviewBannerAction")}
                  </button>
                  <button
                    onClick={() => {
                      setReviewPromptState("dismissed").catch(console.warn);
                      setShowReviewBanner(false);
                    }}
                    className="opacity-50 hover:opacity-100 transition-opacity"
                    aria-label={i18n.t("options.feedback.reviewBannerDismiss")}
                  >
                    <X className="size-3.5" strokeWidth={2} />
                  </button>
                </div>
              </AlertAction>
            </Alert>
          )}
          {activeSection === "general" && (
            <GeneralSection onNavigate={setActiveSection} />
          )}
          {activeSection === "import-export" && <ImportExportSection />}
          {activeSection === "appearance" && <AppearanceSection />}
          {activeSection === "images" && <ImagesSection />}
          {activeSection === "developers" && <DevelopersSection />}
          {activeSection === "feedback" && <FeedbackSection />}
        </div>
      </main>
    </div>
  );
}
