/**
 * Blocked-sites list.
 *
 * Extracted from `SnippetsSection`, which previously buried this between
 * preview settings and import/export under a nav item called "Snippets".
 *
 * spec: specs/options-redesign.spec.md
 */

import { useEffect, useState } from "react";
import { Globe, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { InlineError } from "@/components/ui/inline-error";
import { SiteFavicon } from "@/components/options/SiteFavicon";
import { blockedSitesItem } from "@/storage/items";
import { normalizeHostname } from "@/lib/blocked-sites";
import { captureError } from "@/lib/sentry";
import { i18n } from "#i18n";

/**
 * A hostname is valid when it is a dotted, alphanumeric-or-hyphen label with
 * no leading or trailing hyphen. A wildcard prefix covers all subdomains.
 */
export function isValidHostname(hostname: string): boolean {
  if (hostname.startsWith("*.")) {
    const rest = hostname.slice(2);
    return (
      /^[a-z0-9]([a-z0-9\-.]*[a-z0-9])?$/i.test(rest) && rest.includes(".")
    );
  }
  return (
    /^[a-z0-9]([a-z0-9\-.]*[a-z0-9])?$/i.test(hostname) && hostname.includes(".")
  );
}

export function BlockedSitesPanel() {
  const [blockedSites, setBlockedSites] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    blockedSitesItem
      .getValue()
      .then((val) => setBlockedSites(val ?? []))
      .catch(console.warn);
  }, []);

  function flash(message: string) {
    setStatus(message);
    setTimeout(() => setStatus(null), 2000);
  }

  const addSite = async () => {
    const hostname = normalizeHostname(draft);
    if (!isValidHostname(hostname)) {
      setError(i18n.t("options.generalSection.blockedSites.errorInvalid"));
      return;
    }
    if (blockedSites.includes(hostname)) {
      setError(i18n.t("options.generalSection.blockedSites.errorDuplicate"));
      return;
    }
    try {
      const updated = [...blockedSites, hostname];
      await blockedSitesItem.setValue(updated);
      setBlockedSites(updated);
      setDraft("");
      setError(null);
      flash(i18n.t("options.generalSection.blockedSites.added"));
    } catch (err) {
      captureError(err, { action: "addBlockedSite" });
    }
  };

  const removeSite = async (hostname: string) => {
    try {
      const updated = blockedSites.filter((s) => s !== hostname);
      await blockedSitesItem.setValue(updated);
      setBlockedSites(updated);
      flash(i18n.t("options.generalSection.blockedSites.removed"));
    } catch (err) {
      captureError(err, { action: "removeBlockedSite" });
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
          <Icon
            icon={Globe}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
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
      </div>

      {error && (
        <InlineError
          message={error}
          onDismiss={() => setError(null)}
          className="mt-3 rounded-lg border border-red-200 dark:border-red-800"
        />
      )}

      {blockedSites.length === 0 ? (
        <p className="mt-3 text-xs italic text-muted-foreground">
          {i18n.t("options.generalSection.blockedSites.empty")}
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {blockedSites.map((hostname) => (
            <li
              key={hostname}
              className="flex items-center justify-between gap-2 py-1 text-sm"
            >
              <div className="flex min-w-0 items-center gap-2">
                <SiteFavicon hostname={hostname} />
                <span className="truncate font-mono text-foreground">
                  {hostname}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 shrink-0 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => removeSite(hostname)}
                aria-label={`${i18n.t("options.generalSection.blockedSites.remove")} ${hostname}`}
              >
                <Icon icon={X} className="mr-1" />
                {i18n.t("options.generalSection.blockedSites.remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {status && (
        <p
          role="status"
          aria-live="polite"
          data-testid="blocked-site-status"
          className="mt-2 text-xs text-green-600 dark:text-green-400"
        >
          {status}
        </p>
      )}
    </div>
  );
}