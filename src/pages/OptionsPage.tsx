/**
 * Options page shell.
 *
 * Search-first sidebar on the left, a single heading and hairline setting rows
 * on the right. Replaces the previous five-card layout.
 *
 * Routing is hash-based so a section is linkable and survives a reload — the
 * old page ignored `#feedback` entirely and always booted to the dashboard.
 *
 * spec: specs/options-redesign.spec.md
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Heart, X } from "lucide-react";

import { Alert, AlertDescription, AlertAction } from "@/components/ui/alert";
import { Icon } from "@/components/ui/icon";
import { i18n } from "#i18n";
import {
  dismissedUninstallWarningItem,
  reviewPromptStateItem,
  lastSentryErrorAtItem,
} from "@/storage/items";
import {
  SECTIONS,
  searchSettings,
  rowsForSection,
  SECTION_LABEL_KEYS,
  type SectionId,
  type SettingEntry,
} from "@/components/options/settings/registry";
import { SettingsSidebar } from "@/components/options/settings/SettingsSidebar";
import { SettingControl } from "@/components/options/settings/SettingControl";
import {
  SectionContent,
  SectionFooter,
} from "@/components/options/SectionContent";
import {
  readSidebarWidth,
  SIDEBAR_WIDTH_KEY,
} from "@/components/options/settings/SidebarResizer";
import { setReviewPromptState, getStoreReviewUrl } from "@/lib/review-prompt";

const DEFAULT_SECTION: SectionId = "library";

/** Read the section from `#hash`, ignoring anything that is not a known id. */
function sectionFromHash(hash: string): SectionId {
  const id = hash.replace(/^#\/?/, "");
  return SECTIONS.some((s) => s.id === id) ? (id as SectionId) : DEFAULT_SECTION;
}

export default function OptionsPage() {
  const [section, setSection] = useState<SectionId>(DEFAULT_SECTION);
  const [query, setQuery] = useState("");
  const [showUninstallWarning, setShowUninstallWarning] = useState(false);
  const [showReviewBanner, setShowReviewBanner] = useState(false);

  // Read synchronously so the first paint already has the persisted width;
  // reading in an effect made the rail visibly jump on every reload.
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);

  // Deep link on first paint, then follow the back/forward buttons.
  useEffect(() => {
    const apply = () => setSection(sectionFromHash(window.location.hash));
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  // Persist the rail width. Best-effort: a storage failure must not stop the
  // resize from working for the rest of the session.
  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      /* non-fatal */
    }
  }, [sidebarWidth]);

  const navigate = useCallback((next: SectionId) => {
    setSection(next);
    if (window.location.hash !== `#${next}`) {
      window.location.hash = `#${next}`;
    }
  }, []);

  /** Jump to a setting's own section, leaving search to answer the rest. */
  const pickSetting = useCallback(
    (entry: SettingEntry) => {
      navigate(entry.section);
    },
    [navigate]
  );

  const rows = useMemo(() => rowsForSection(section), [section]);
  const meta = SECTIONS.find((s) => s.id === section);
  const searching = query.trim().length > 0;

  useEffect(() => {
    dismissedUninstallWarningItem
      .getValue()
      .then((dismissed: boolean) => {
        if (!dismissed) setShowUninstallWarning(true);
      })
      .catch(console.warn);
  }, []);

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

  return (
    <div className="flex h-screen">
      {/* Labelled so the landmark is distinguishable from the `nav` inside it —
          two unlabelled complementary/navigation landmarks of the same page
          are ambiguous to announce. */}
      <aside
        className="shrink-0"
        style={{ width: sidebarWidth }}
        aria-label={i18n.t("options.a11y.optionsSidebar")}
      >
        <SettingsSidebar
          activeSection={section}
          onNavigate={navigate}
          query={query}
          onQueryChange={setQuery}
          onPickSetting={pickSetting}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
        />
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-8 py-8">
          {showUninstallWarning && (
            <Alert className="mb-6 border-amber-200 bg-amber-50 text-amber-800 [&>svg]:text-amber-500 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:[&>svg]:text-amber-400">
              <Icon icon={AlertTriangle} size="lg" />
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
                  className="opacity-50 transition-opacity hover:opacity-100"
                  aria-label={i18n.t("common.dismiss")}
                  data-testid="warning-uninstall-dismiss"
                >
                  <Icon icon={X} stroke="emphasis" />
                </button>
              </AlertAction>
            </Alert>
          )}
          {showReviewBanner && (
            <Alert className="mb-6 border-blue-200 bg-blue-50 text-blue-800 [&>svg]:text-blue-500 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 dark:[&>svg]:text-blue-400">
              <Icon icon={Heart} size="lg" />
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
                    className="text-xs font-medium text-blue-700 hover:underline dark:text-blue-300"
                  >
                    {i18n.t("options.feedback.reviewBannerAction")}
                  </button>
                  <button
                    onClick={() => {
                      setReviewPromptState("dismissed").catch(console.warn);
                      setShowReviewBanner(false);
                    }}
                    className="opacity-50 transition-opacity hover:opacity-100"
                    aria-label={i18n.t("options.feedback.reviewBannerDismiss")}
                    data-testid="warning-review-dismiss"
                  >
                    <Icon icon={X} stroke="emphasis" />
                  </button>
                </div>
              </AlertAction>
            </Alert>
          )}

          {searching ? (
            <SearchResults query={query} />
          ) : (
            <>
              <header className="mb-1">
                <h1 className="text-lg font-semibold text-foreground">
                  {meta ? i18n.t(SECTION_LABEL_KEYS[meta.id]) : ""}
                </h1>
              </header>

              <SectionContent section={section} />

              {rows.length > 0 && (
                <div data-testid={`section-${section}-rows`}>
                  {rows.map((entry) => (
                    <SettingControl key={entry.id} entry={entry} />
                  ))}
                </div>
              )}

              <SectionFooter section={section} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/**
 * Search results render the setting's live control, so a preference can be
 * changed without leaving the result list.
 */
function SearchResults({ query }: { query: string }) {
  const results = searchSettings(query);

  if (results.length === 0) {
    return (
      <p
        data-testid="options-search-empty-page"
        className="py-10 text-center text-sm text-muted-foreground"
      >
        {i18n.t("options.search.noResults")}
      </p>
    );
  }

  return (
    <div>
      <h1 className="mb-3 text-lg font-semibold text-foreground">
        {i18n.t("options.search.resultsTitle", [String(results.length)])}
      </h1>
      {results.map((entry) => (
        // Focusable so ArrowDown from the search field can land here; the row
        // itself is not a control, so the wrapper carries the tab stop.
        <div
          key={entry.id}
          data-testid={`option-setting-${entry.id}`}
          tabIndex={-1}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SettingControl entry={entry} />
        </div>
      ))}
    </div>
  );
}