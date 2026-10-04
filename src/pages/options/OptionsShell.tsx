/**
 * The options page shell: sidebar, banners, and the routed content area.
 *
 * Split out of `OptionsPage.tsx` because the shell is now the *root route*
 * component — it renders once and stays mounted while the routed section below
 * it changes. Previously the page component owned both, so switching section
 * re-rendered the sidebar and the review banner along with it.
 */

import { useCallback, useEffect, useState } from "react";
import { Heart, X } from "lucide-react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";

import { Alert, AlertDescription, AlertAction } from "@/components/ui/alert";
import { Icon } from "@/components/ui/icon";
import { i18n } from "#i18n";
import type {
  SectionId,
  SettingEntry,
} from "@/components/options/settings/registry";
import { searchRegistryEntries } from "@/components/options/settings/search";
import { SettingControl } from "@/components/options/settings/SettingControl";
import { SettingsSidebar } from "@/components/options/settings/SettingsSidebar";
import {
  readSidebarWidth,
  SIDEBAR_WIDTH_KEY,
} from "@/components/options/settings/SidebarResizer";
import { sectionIdFromPath } from "@/routes/options";
import {
  getStoreReviewUrl,
  setReviewPromptState,
  shouldShowReviewBanner,
} from "@/lib/review-prompt";

/** Where a section's route lives, derived so no list needs maintaining twice. */
const sectionHref = (id: SectionId) => `/${id}` as const;

export function OptionsShell() {
  const navigate = useNavigate();

  // The active section is derived from the URL, never stored. A second piece of
  // state would be a source of truth that a back-button press could desynchronise
  // from the address bar — which is exactly what the old `useState<SectionId>`
  // alongside a `hashchange` listener could do.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // `sectionIdFromPath` rather than the test inlined: this file and
  // `SectionView.tsx` both need it, and re-deriving it here is the "two sources
  // of truth for what sections exist" that decision 0011 exists to remove.
  const activeSection: SectionId = sectionIdFromPath(pathname) ?? "library";

  const [query, setQuery] = useState("");
  const [showReviewBanner, setShowReviewBanner] = useState(false);

  // Read synchronously so the first paint already has the persisted width;
  // reading in an effect made the rail visibly jump on every reload.
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);

  // Persist the rail width. Best-effort: a storage failure must not stop the
  // resize from working for the rest of the session.
  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      /* non-fatal */
    }
  }, [sidebarWidth]);

  useEffect(() => {
    // Policy lives in review-prompt.ts, not here. This was previously an inline
    // copy of two of those conditions, and the two copies had drifted apart.
    shouldShowReviewBanner().then(setShowReviewBanner).catch(console.warn);
  }, []);

  /** Leaving search hands the main column back to the route. */
  const goToSection = useCallback(
    (next: SectionId) => {
      setQuery("");
      void navigate({ to: sectionHref(next) });
    },
    [navigate]
  );

  /** Jump to a setting's own section, leaving search to answer the rest. */
  const pickSetting = useCallback(
    (entry: SettingEntry) => goToSection(entry.section),
    [goToSection]
  );

  const searching = query.trim().length > 0;

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
          activeSection={activeSection}
          onNavigate={goToSection}
          query={query}
          onQueryChange={setQuery}
          onPickSetting={pickSetting}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
        />
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-8 py-8">
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

          {searching ? <SearchResults query={query} /> : <Outlet />}
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
  const results = searchRegistryEntries(query);

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
      {results.map(({ entry, titleHits }) => (
        // Focusable so ArrowDown from the search field can land here; the row
        // itself is not a control, so the wrapper carries the tab stop.
        <div
          key={entry.id}
          data-testid={`option-setting-${entry.id}`}
          tabIndex={-1}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SettingControl entry={entry} highlight={titleHits} />
        </div>
      ))}
    </div>
  );
}
