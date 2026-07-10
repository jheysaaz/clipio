import { useState, useRef } from "react";
import { Check, Heart, ExternalLink, X, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { InlineError } from "@/components/ui/inline-error";
import { setReviewPromptState, getStoreReviewUrl } from "@/lib/review-prompt";
import { i18n } from "#i18n";
import { sendUserFeedback, captureError } from "@/lib/sentry";
import { InfoTooltip } from "./InfoTooltip";

interface FeedbackFormState {
  name: string;
  email: string;
  message: string;
  screenshotFile: File | null;
  submitting: boolean;
  submitted: boolean;
  error: string | null;
}

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

export function FeedbackModal({ open, onClose }: FeedbackModalProps) {
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
        error: null,
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

  const handleClose = () => {
    setState({
      name: "",
      email: "",
      message: "",
      screenshotFile: null,
      submitting: false,
      submitted: false,
      error: null,
    });
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 flex items-center justify-center p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") handleClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-background rounded-2xl border shadow-xl w-full max-w-lg max-h-[min(90vh,640px)] overflow-y-auto p-6"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <MessageSquareText
              className="h-5 w-5 text-foreground"
              strokeWidth={1.5}
            />
            <h2 className="text-lg font-semibold text-foreground">
              {i18n.t("options.feedback.title")}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleClose}
            aria-label={i18n.t("common.closeModal")}
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </Button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          {i18n.t("options.feedback.description")}
        </p>

        {/* Feedback form */}
        <form onSubmit={handleSubmit} className="space-y-4">
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

          <InlineError
            message={state.error}
            onDismiss={() => setState((prev) => ({ ...prev, error: null }))}
            className="rounded-lg border border-red-200 dark:border-red-800"
          />

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

        {/* Divider */}
        <div className="my-6 h-px bg-border" />

        {/* Donation + Review */}
        <div className="space-y-3">
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() =>
              browser.tabs.create({
                url: "https://github.com/sponsors/jheysaaz",
              })
            }
            title={i18n.t("options.feedback.donationTitle")}
          >
            <Heart className="h-4 w-4" strokeWidth={1.5} />
            {i18n.t("options.feedback.donationAction")}
          </Button>
          <div className="rounded-lg border p-4 space-y-2">
            <p className="text-sm font-medium text-foreground">
              {i18n.t("options.feedback.reviewBannerTitle")}
            </p>
            <p className="text-xs text-muted-foreground">
              {i18n.t("options.feedback.reviewBannerDescription")}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                browser.tabs.create({ url: getStoreReviewUrl() });
                setReviewPromptState("rated").catch(console.warn);
              }}
              className="gap-1.5"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
              {i18n.t("options.feedback.reviewBannerAction")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
