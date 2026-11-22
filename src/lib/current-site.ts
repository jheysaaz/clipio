/**
 * Resolve the popup's current site to a bare hostname.
 */

import { normalizeHostname } from "@/lib/context-usage";

/**
 * The active tab's hostname, or `null` when there is nothing safe to use.
 *
 * `tabs.query` returns a full URL. It is parsed here and only the hostname
 * crosses this boundary: no caller receives the path, query, fragment or
 * credentials, and none of those are ever persisted. Extension and browser
 * internal pages are excluded — their hostnames are not "sites" in the sense
 * this ranking signal means.
 *
 * A query failure is not worth a Sentry event: it would need the tab URL as
 * context to be useful, and that is exactly what we refuse to record.
 */
export async function getCurrentSiteHostname(): Promise<string | null> {
  try {
    const tabs = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const url = tabs[0]?.url;
    if (!url) return null;

    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return normalizeHostname(parsed.hostname);
  } catch {
    return null;
  }
}
