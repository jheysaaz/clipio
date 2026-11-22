/**
 * About — version, update state, and the feedback entry point.
 *
 */

import { useEffect, useState } from "react";
import { ExternalLink, Heart, MessageSquareText, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { latestVersionItem, dismissedUpdateVersionItem } from "@/storage/items";
import {
  openReleasePage,
  shouldShowUpdateAlert,
  type ReleaseInfo,
} from "@/lib/update-checker";
import { getStoreReviewUrl, isChromiumBrowser } from "@/lib/review-prompt";
import { FeedbackModal } from "@/components/options/FeedbackModal";
import { i18n } from "#i18n";

/** GitHub Sponsors — the same destination the feedback modal uses. */
const DONATION_URL = "https://github.com/sponsors/jheysaaz";

export function AboutPanel() {
  const [chromium] = useState(isChromiumBrowser);
  const [currentVersion] = useState(
    () => browser.runtime.getManifest().version
  );
  const [latest, setLatest] = useState<ReleaseInfo | null>(null);
  const [dismissed, setDismissed] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    latestVersionItem
      .getValue()
      .then((v) => {
        if (mounted) setLatest(v);
      })
      .catch(console.warn);
    dismissedUpdateVersionItem
      .getValue()
      .then((v) => {
        if (mounted) setDismissed(v ?? "");
      })
      .catch(console.warn);

    // The background checker writes these items whenever a check completes,
    // often while this panel is open. A one-shot read left the indicator stale
    // until the options page was reloaded.
    const unwatchLatest = latestVersionItem.watch((v) => {
      if (mounted) setLatest(v);
    });
    const unwatchDismissed = dismissedUpdateVersionItem.watch((v) => {
      if (mounted) setDismissed(v ?? "");
    });
    return () => {
      mounted = false;
      unwatchLatest();
      unwatchDismissed();
    };
  }, []);

  // One nullable value instead of a boolean plus a second null check in JSX:
  // the render branch below then has a single condition with no unreachable arm.
  const updateRelease =
    latest && shouldShowUpdateAlert(latest, dismissed) ? latest : null;

  return (
    <div className="mb-6 space-y-5" data-testid="panel-about">
      <div data-testid="card-extension-version" className="space-y-2">
        <div>
          <p className="text-sm font-medium text-foreground">
            {i18n.t("options.copy.extensionVersion")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {i18n.t("options.copy.extensionVersionHint")}
          </p>
        </div>
        <p className="text-sm text-foreground" data-testid="about-version">
          {i18n.t("options.about.version", [currentVersion])}
        </p>
        {updateRelease ? (
          <div
            data-testid="version-update-available"
            className="flex items-center gap-3"
          >
            <span className="text-xs text-amber-600 dark:text-amber-400">
              {i18n.t("options.about.updateAvailable", [updateRelease.version])}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => void openReleasePage(updateRelease.htmlUrl)}
            >
              <Icon icon={ExternalLink} className="mr-1.5" />
              {i18n.t("options.copy.viewRelease")}
            </Button>
          </div>
        ) : (
          <p
            data-testid="version-up-to-date"
            className="text-xs text-muted-foreground"
          >
            {i18n.t("options.copy.upToDate")}
          </p>
        )}
      </div>

      <div className="border-t border-border/70 pt-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-foreground">
              {i18n.t("options.feedback.title")}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {i18n.t("options.feedback.description")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            onClick={() => setFeedbackOpen(true)}
            aria-label={i18n.t("options.a11y.feedbackButton")}
            data-testid="about-feedback"
          >
            <Icon icon={MessageSquareText} className="mr-1.5" />
            {i18n.t("options.a11y.feedbackButton")}
          </Button>
        </div>

        {/*
          Donate and Review, grouped with feedback: all three are the ways a
          user responds to the extension rather than configure it.

          The review action is Chromium-only. Firefox installs from AMO, so the
          Chrome Web Store listing would be the wrong destination — the action
          is hidden rather than shown and broken.
        */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            data-testid="about-donate"
            title={i18n.t("options.feedback.donationTitle")}
            onClick={() => browser.tabs.create({ url: DONATION_URL })}
          >
            <Icon icon={Heart} className="mr-1.5" />
            {i18n.t("options.feedback.donationAction")}
          </Button>

          {chromium && (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              data-testid="about-review"
              onClick={() => browser.tabs.create({ url: getStoreReviewUrl() })}
            >
              <Icon icon={Star} className="mr-1.5" />
              {i18n.t("options.about.leaveReview")}
            </Button>
          )}
        </div>
      </div>

      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
      />
    </div>
  );
}
