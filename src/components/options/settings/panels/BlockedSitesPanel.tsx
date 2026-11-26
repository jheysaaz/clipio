/**
 * Blocked-sites list.
 *
 * Extracted from `SnippetsSection`, which previously buried this between
 * preview settings and import/export under a nav item called "Snippets".
 *
 */

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

import { useFeedback } from "@/components/feedback/FeedbackProvider";
import { useControlConfirmation } from "@/components/feedback/use-control-confirmation";
import { Button } from "@/components/ui/button";
import { ControlConfirmation } from "@/components/ui/control-confirmation";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { InlineError } from "@/components/ui/inline-error";
import { SiteFavicon } from "@/components/options/SiteFavicon";
import { blockedSitesItem } from "@/storage/items";
import {
  addBlockedSite,
  normalizeHostname,
  parseRegexEntry,
} from "@/lib/blocked-sites";
import { captureError } from "@/lib/sentry";
import { i18n } from "#i18n";

/**
 * An entry is valid when it is a dotted hostname, a wildcard subdomain, or a
 * compilable `/pattern/flags` regex. Anything else would sit in the list
 * forever without ever blocking a site.
 */
export function isValidSitePattern(entry: string): boolean {
  if (parseRegexEntry(entry)) return true;
  if (entry.startsWith("*.")) {
    const rest = entry.slice(2);
    return (
      /^[a-z0-9]([a-z0-9\-.]*[a-z0-9])?$/i.test(rest) && rest.includes(".")
    );
  }
  return (
    /^[a-z0-9]([a-z0-9\-.]*[a-z0-9])?$/i.test(entry) && entry.includes(".")
  );
}

export function BlockedSitesPanel() {
  const [blockedSites, setBlockedSites] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    message: string;
    hostname?: string;
  } | null>(null);
  const { confirmed, show, reset } = useControlConfirmation();
  const { announce } = useFeedback();

  useEffect(() => {
    blockedSitesItem
      .getValue()
      .then((val) => setBlockedSites(val ?? []))
      .catch(console.warn);
  }, []);

  function confirm(message: string, hostname?: string) {
    setConfirmation({ message, hostname });
    show();
    announce(message);
  }

  const addSite = async () => {
    // Normalisation leaves valid regex entries alone; hostnames are lowercased
    // with schemes, ports and paths stripped before validation and storage.
    const pattern = normalizeHostname(draft);
    if (!isValidSitePattern(pattern)) {
      setError(i18n.t("options.generalSection.blockedSites.errorInvalid"));
      return;
    }
    const updated = addBlockedSite(blockedSites, pattern);
    if (updated.length === blockedSites.length) {
      setError(i18n.t("options.generalSection.blockedSites.errorDuplicate"));
      return;
    }
    try {
      await blockedSitesItem.setValue(updated);
      setBlockedSites(updated);
      setDraft("");
      setError(null);
      confirm(i18n.t("options.generalSection.blockedSites.added"));
    } catch (err) {
      captureError(err, { action: "addBlockedSite" });
      reset();
    }
  };

  const removeSite = async (hostname: string) => {
    try {
      const updated = blockedSites.filter((s) => s !== hostname);
      await blockedSitesItem.setValue(updated);
      setBlockedSites(updated);
      confirm(i18n.t("options.generalSection.blockedSites.removed"), hostname);
    } catch (err) {
      captureError(err, { action: "removeBlockedSite" });
      reset();
    }
  };

  return (
    <div className="mb-6" data-testid="panel-blocked-sites">
      {/* The other panels open with a subheading; this one used to jump
          straight into the input, so the page had a bare control under the
          section title. */}
      <div className="mb-3">
        <h2 className="text-sm font-medium text-foreground">
          {i18n.t("options.setting.blockedSites.title")}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {i18n.t("options.setting.blockedSites.desc")}
        </p>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          {/* Like a browser address bar: the leading icon becomes the site's
              favicon as soon as the typed text names a usable domain. */}
          <span
            data-testid="blocked-site-preview-icon"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
          >
            <SiteFavicon hostname={draft} className="size-4" />
          </span>
          <Input
            type="text"
            placeholder={i18n.t(
              "options.generalSection.blockedSites.addPlaceholder"
            )}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") addSite();
            }}
            aria-label={i18n.t(
              "options.generalSection.blockedSites.addPlaceholder"
            )}
            data-testid="blocked-site-input"
            className="h-8 pl-8 font-mono text-sm"
          />
        </div>
        <Button
          size="sm"
          onClick={addSite}
          disabled={!draft.trim()}
          className="h-8 shrink-0 gap-1.5"
        >
          <Icon icon={Plus} />
          {i18n.t("options.generalSection.blockedSites.addButton")}
        </Button>
        {confirmed && confirmation && confirmation.hostname === undefined && (
          <ControlConfirmation
            testId="blocked-site-add-confirmation"
            label={confirmation.message}
            className="self-center"
          />
        )}
      </div>

      {error && (
        <InlineError
          message={error}
          onDismiss={() => setError(null)}
          className="mt-3 rounded-lg border border-red-200 dark:border-red-800"
        />
      )}

      {/* Each blocked site gets the same quiet tile treatment as the storage
          figures: bordered, tinted, and one per hostname. */}
      {blockedSites.length === 0 ? (
        <p className="mt-3 text-xs italic text-muted-foreground">
          {i18n.t("options.generalSection.blockedSites.empty")}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {blockedSites.map((hostname) => (
            <li
              key={hostname}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/30 px-4 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <SiteFavicon hostname={hostname} />
                <span className="truncate font-mono text-sm">{hostname}</span>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 text-muted-foreground hover:text-destructive"
                onClick={() => removeSite(hostname)}
                aria-label={`${i18n.t("options.generalSection.blockedSites.remove")} ${hostname}`}
              >
                <Icon icon={X} size="sm" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* A removed row is gone immediately, so its confirmation lives beside
          the list it was removed from rather than inside the vanished row. */}
      {confirmed && confirmation && confirmation.hostname !== undefined && (
        <ControlConfirmation
          testId="blocked-site-remove-confirmation"
          label={confirmation.message}
          className="mt-2"
        />
      )}
    </div>
  );
}
