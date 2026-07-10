import { useState, useEffect } from "react";
import { AlertTriangle, Heart, X } from "lucide-react";
import { Alert, AlertDescription, AlertAction } from "@/components/ui/alert";
import { i18n } from "#i18n";
import {
  dismissedUninstallWarningItem,
  reviewPromptStateItem,
  lastSentryErrorAtItem,
} from "@/storage/items";
import { setReviewPromptState, getStoreReviewUrl } from "@/lib/review-prompt";
import { DashboardSection } from "@/components/options/DashboardSection";
import { SnippetsSection } from "@/components/options/SnippetsSection";
import { AppearanceSection } from "@/components/options/AppearanceSection";
import { ImagesSection } from "@/components/options/ImagesSection";
import { AdvancedSection } from "@/components/options/AdvancedSection";
import { FeedbackModal } from "@/components/options/FeedbackModal";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/options/app-sidebar";
import { SiteHeader } from "@/components/options/site-header";
import { SectionCards } from "@/components/options/section-cards";

export default function OptionsPage() {
  const [showUninstallWarning, setShowUninstallWarning] = useState(false);
  const [showReviewBanner, setShowReviewBanner] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("dashboard");

  useEffect(() => {
    dismissedUninstallWarningItem
      .getValue()
      .then((dismissed) => {
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
    <SidebarProvider defaultOpen={true}>
      <AppSidebar activeSection={activeSection} onNavigate={setActiveSection} />
      <div className="flex flex-1 flex-col">
        <SiteHeader
          activeSection={activeSection}
          onFeedback={() => setFeedbackOpen(true)}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-8 py-8">
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
                      aria-label={i18n.t(
                        "options.feedback.reviewBannerDismiss"
                      )}
                    >
                      <X className="size-3.5" strokeWidth={2} />
                    </button>
                  </div>
                </AlertAction>
              </Alert>
            )}
            {activeSection === "dashboard" && <SectionCards />}
            {activeSection === "dashboard" && (
              <div className="mt-8">
                <DashboardSection />
              </div>
            )}
            {activeSection === "snippets" && <SnippetsSection />}
            {activeSection === "appearance" && <AppearanceSection />}
            {activeSection === "images" && <ImagesSection />}
            {activeSection === "advanced" && <AdvancedSection />}
          </div>
        </main>
      </div>
      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
      />
    </SidebarProvider>
  );
}
