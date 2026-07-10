import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { Download, Check, Globe, Plus, X, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { InlineError } from "@/components/ui/inline-error";
import { exportSnippets, getSnippets } from "@/storage";
import { snippetsContainMedia } from "@/lib/exporters/clipio";
import { TIMING } from "@/config/constants";
import { blockedSitesItem, typingTimeoutItem } from "@/storage/items";
import { i18n } from "#i18n";
import { captureError } from "@/lib/sentry";
import { InfoTooltip } from "./InfoTooltip";
import { SiteFavicon } from "./SiteFavicon";
import { PreviewSettings } from "./PreviewSettings";
import { toast } from "sonner";

const ImportWizard = lazy(() => import("@/components/ImportWizard"));

export function SnippetsSection() {
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

  function normaliseHostname(raw: string): string {
    let s = raw.trim().toLowerCase();
    s = s.replace(/^https?:\/\//i, "");
    s = s.split("/")[0].split("?")[0].split("#")[0];
    s = s.replace(/\.+$/, "");
    return s;
  }

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

  // --- Typing timeout ---
  const [typingTimeout, setTypingTimeout] = useState<number>(
    TIMING.TYPING_TIMEOUT
  );
  const [timeoutSaved, setTimeoutSaved] = useState(false);
  const timeoutSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    typingTimeoutItem
      .getValue()
      .then((val) => setTypingTimeout(val))
      .catch(console.warn);
  }, []);

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

  // --- Import/Export ---
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);

  const handleExport = async () => {
    try {
      const snippets = await getSnippets();
      const hasMedia = snippetsContainMedia(snippets);
      await exportSnippets();
      if (hasMedia) {
        toast.success("Snippets + images exported");
      } else {
        toast.success("Snippets exported");
      }
    } catch (err) {
      console.error("[Clipio] Export failed:", err);
      captureError(err, { action: "exportSnippets" });
      const msg =
        err instanceof Error
          ? err.message
          : i18n.t("options.errors.failedExport");
      toast.error(msg);
    }
  };

  return (
    <div className="space-y-8">
      {/* Preview Settings */}
      <PreviewSettings />

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

      {/* Typing Timeout */}
      <div className="rounded-xl border p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Typing Timeout
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            How long Clipio waits after you stop typing before attempting to
            expand a snippet. Lower = faster but may expand mid-word. Default:
            300 ms.
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
            aria-label="Typing Timeout"
          />
          <span className="text-sm font-mono w-20 text-right shrink-0 text-foreground">
            {typingTimeout} ms
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
            Reset to default
          </Button>
          {timeoutSaved && (
            <span
              role="status"
              aria-live="polite"
              className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
              Saved
            </span>
          )}
        </div>
      </div>

      <div className="border-t" />

      {/* Import/Export */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">
          {i18n.t("options.importExport.title")}
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          {i18n.t("options.importExport.description")}
        </p>

        <div className="space-y-4">
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
                <Download className="h-3.5 w-3.5 mr-1.5" strokeWidth={1.5} />
                {i18n.t("options.importExport.exportCard.button")}
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
                  setShowImportWizard(true);
                }}
                className="shrink-0"
              >
                {i18n.t("options.importExport.importCard.button")}
              </Button>
            </div>

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
                  <img
                    src={icon}
                    alt={label}
                    className="h-3.5 w-3.5 rounded-sm"
                  />
                  {label}
                </span>
              ))}
            </div>
          </div>
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
            className="bg-background rounded-xl border shadow-xl w-full max-w-lg p-6 max-h-[min(90vh,640px)] overflow-y-auto"
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
                  toast.success(
                    i18n.t(
                      "options.importExport.importCard.successMessage",
                      count
                    )
                  );
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
