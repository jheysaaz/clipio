import { useEffect, useState, useRef } from "react";
import { Check, X, MessageSquareText } from "lucide-react";

import { useFeedback } from "@/components/feedback/FeedbackProvider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { InlineError } from "@/components/ui/inline-error";
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
  const { announce } = useFeedback();

  useEffect(() => {
    if (state.submitted) announce(i18n.t("options.feedback.success"));
  }, [state.submitted, announce]);

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
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent showCloseButton={false} className="w-full max-w-lg p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Icon
              icon={MessageSquareText}
              size="xl"
              className="text-foreground"
            />
            <DialogTitle className="text-lg font-semibold text-foreground">
              {i18n.t("options.feedback.title")}
            </DialogTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleClose}
            aria-label={i18n.t("common.closeModal")}
          >
            <Icon icon={X} size="lg" />
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
            <Input
              id="feedback-name"
              type="text"
              placeholder={i18n.t("options.feedback.namePlaceholder")}
              value={state.name}
              onChange={handleInputChange("name")}
              disabled={state.submitting}
              className={state.submitting ? "opacity-60" : undefined}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="feedback-email">
                {i18n.t("options.feedback.emailLabel")}
              </Label>
              <InfoTooltip text={i18n.t("options.feedback.emailTooltip")} />
            </div>
            <Input
              id="feedback-email"
              type="email"
              placeholder={i18n.t("options.feedback.emailPlaceholder")}
              value={state.email}
              onChange={handleInputChange("email")}
              disabled={state.submitting}
              className={state.submitting ? "opacity-60" : undefined}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="feedback-message">
                {i18n.t("options.feedback.messageLabel")}
              </Label>
              <InfoTooltip text={i18n.t("options.feedback.messageTooltip")} />
            </div>
            <Textarea
              id="feedback-message"
              placeholder={i18n.t("options.feedback.messagePlaceholder")}
              value={state.message}
              onChange={handleInputChange("message")}
              disabled={state.submitting}
              rows={5}
              className={cn(
                "min-h-20 resize-none",
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
            <Alert
              data-testid="feedback-success"
              className="border-transparent bg-emerald-50 px-4 py-3 dark:bg-emerald-950/30"
            >
              <Icon
                icon={Check}
                size="lg"
                className="text-green-600 dark:text-green-400 mt-0.5"
              />
              <AlertDescription className="text-green-700 dark:text-green-300">
                {i18n.t("options.feedback.success")}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <Button
              type="submit"
              disabled={state.submitting || !state.message.trim()}
              className="gap-2"
            >
              {state.submitting ? (
                <>
                  <Spinner className="size-3.5" />
                  {i18n.t("options.feedback.submitting")}
                </>
              ) : (
                i18n.t("options.feedback.submit")
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
