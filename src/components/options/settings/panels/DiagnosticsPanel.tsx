/**
 * Diagnostics — the content-script health check.
 *
 * The debug switch, the Giphy key and the log itself are separate: the switch
 * and key are registry rows (so they are searchable), and the log renders
 * below them in `SectionFooter`.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { CONTENT_SCRIPT_PING_MESSAGE_TYPE } from "@/config/constants";
import { i18n } from "#i18n";

export function DiagnosticsPanel() {
  const [pinging, setPinging] = useState(false);

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
        toast.error(
          i18n.t("options.developers.contentScriptHealth.errorNoTab")
        );
        return;
      }
      const response = await browser.tabs
        .sendMessage(tab.id, { type: CONTENT_SCRIPT_PING_MESSAGE_TYPE })
        .catch(() => null);
      setPinging(false);
      if (response && (response as { pong?: boolean }).pong) {
        toast.success(i18n.t("options.developers.contentScriptHealth.pong"));
      } else {
        toast.error(
          i18n.t("options.developers.contentScriptHealth.errorNoContentScript")
        );
      }
    } catch {
      setPinging(false);
      toast.error(
        i18n.t("options.developers.contentScriptHealth.errorGeneric")
      );
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
            <Icon icon={Loader2} className="mr-1.5 animate-spin" />
            {i18n.t("options.developers.contentScriptHealth.pinging")}
          </>
        ) : (
          i18n.t("options.developers.contentScriptHealth.pingButton")
        )}
      </Button>
    </div>
  );
}
