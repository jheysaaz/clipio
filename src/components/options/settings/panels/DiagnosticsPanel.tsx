/**
 * Diagnostics — the content-script health check.
 *
 * The debug switch, the Giphy key and the log itself are separate: the switch
 * and key are registry rows (so they are searchable), and the log renders
 * below them in `SectionFooter`.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { useFeedback } from "@/components/feedback/FeedbackProvider";
import { useControlConfirmation } from "@/components/feedback/use-control-confirmation";
import { Button } from "@/components/ui/button";
import { ControlConfirmation } from "@/components/ui/control-confirmation";
import { Icon } from "@/components/ui/icon";
import { MESSAGE, sendMessage } from "@/lib/protocol";
import { i18n } from "#i18n";

export function DiagnosticsPanel() {
  const [pinging, setPinging] = useState(false);
  const { confirmed, show, reset } = useControlConfirmation();
  const { announce, showBanner, dismissBanner } = useFeedback();

  const fail = (message: string) => {
    reset();
    showBanner({
      source: "diagnostics",
      severity: "error",
      message,
    });
  };

  const succeed = (message: string) => {
    show();
    announce(message);
    dismissBanner("diagnostics", { runOnDismiss: false });
  };

  const ping = async () => {
    setPinging(true);
    try {
      const tabs = await browser.tabs.query({});
      const tab = tabs.find(
        (t) =>
          t.id !== undefined &&
          t.url &&
          !t.url.startsWith("chrome://") &&
          !t.url.startsWith("chrome-extension://") &&
          !t.url.startsWith("about:") &&
          !t.url.startsWith("edge://") &&
          !t.url.startsWith("moz-extension://")
      );
      if (!tab?.id) {
        setPinging(false);
        fail(i18n.t("options.developers.contentScriptHealth.errorNoTab"));
        return;
      }
      // Rejects when the tab has no content script listening — which is the
      // normal case on a chrome:// page, on a tab that loaded before the
      // extension did, or on any page the user has excluded. That is the answer
      // the user wants, not an error worth surfacing differently.
      // `undefined` before the tabId is not redundant: the protocol types a
      // payload-less message as `(data?: undefined, ...args)`, so the placeholder
      // is what tells the overload the next argument is the tab.
      const alive = await sendMessage(MESSAGE.CONTENT_PING, undefined, tab.id)
        .then(() => true)
        .catch(() => false);
      setPinging(false);
      if (alive) {
        succeed(i18n.t("options.developers.contentScriptHealth.pong"));
      } else {
        fail(
          i18n.t("options.developers.contentScriptHealth.errorNoContentScript")
        );
      }
    } catch {
      setPinging(false);
      fail(i18n.t("options.developers.contentScriptHealth.errorGeneric"));
    }
  };

  return (
    <div className="mb-6" data-testid="card-content-script-health">
      <div className="mb-3">
        <h2 className="text-sm font-medium text-foreground">
          {i18n.t("options.developers.contentScriptHealth.title")}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {i18n.t("options.developers.contentScriptHealth.description")}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        onClick={ping}
        disabled={pinging}
      >
        {pinging ? (
          <>
            <Icon
              icon={Loader2}
              className="mr-1.5 animate-spin motion-reduce:hidden"
            />
            {i18n.t("options.developers.contentScriptHealth.pinging")}
          </>
        ) : (
          i18n.t("options.developers.contentScriptHealth.pingButton")
        )}
      </Button>
      {confirmed && (
        <ControlConfirmation
          label={i18n.t("options.developers.contentScriptHealth.pong")}
          className="ml-2 self-center"
        />
      )}
    </div>
  );
}
