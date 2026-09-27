/**
 * Update checker for Clipio.
 *
 * Fetches the latest release from GitHub Releases API and compares it to the
 * currently installed extension version. The result is persisted in local
 * storage so the UI can show an update banner without making extra network
 * requests on every page load.
 *
 * Usage:
 *   - Background script calls checkForUpdate() on startup and every 6 hours
 *     via browser.alarms.
 *   - UI reads latestVersionItem from storage to decide whether to show a banner.
 *   - shouldShowUpdateAlert() is a pure helper that centralises the "should we
 *     show the banner?" logic.
 *
 * GitHub API:
 *   GET https://api.github.com/repos/{owner}/{repo}/releases/latest
 *   Returns the latest non-prerelease. Returns 404 if no releases exist.
 */

import { captureError } from "@/lib/sentry";
import { latestVersionItem, latestVersionCheckedAtItem } from "@/storage/items";
import { browser } from "wxt/browser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReleaseInfo {
  version: string;
  htmlUrl: string;
  publishedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compare two semver strings (major.minor.patch).
 * Returns  1 if a > b
 * Returns -1 if a < b
 * Returns  0 if a === b
 *
 * Non-numeric segments default to 0 (permissive parsing so pre-release tags
 * like "1.2.3-beta" are handled gracefully — only the first three numeric
 * parts are compared).
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): [number, number, number] => {
    const parts = v
      .replace(/^v/, "")
      .split(".")
      .slice(0, 3)
      .map((s) => parseInt(s, 10) || 0);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };

  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);

  if (aMaj !== bMaj) return aMaj > bMaj ? 1 : -1;
  if (aMin !== bMin) return aMin > bMin ? 1 : -1;
  if (aPat !== bPat) return aPat > bPat ? 1 : -1;
  return 0;
}

/**
 * Retrieve the current installed extension version from the manifest.
 * Returns "0.0.0" as a safe fallback (always treated as outdated) when the
 * manifest is unavailable (e.g. unit tests).
 */
export function getCurrentVersion(): string {
  try {
    return browser.runtime.getManifest().version;
  } catch {
    return "0.0.0";
  }
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Fetch the latest release from GitHub and persist it to local storage.
 *
 * - Only writes to latestVersionItem when the remote version is strictly
 *   newer than the installed version (so the item stays null for up-to-date
 *   installs).
 * - Always updates latestVersionCheckedAtItem so background can track
 *   when the last check happened (regardless of whether an update was found).
 * - Never throws — all errors are captured to Sentry and swallowed so
 *   the caller (background service worker) is never disrupted.
 */
/**
 * Pure helper: allow only a GitHub release page URL.
 *
 * `checkForUpdate` reads `html_url` out of the GitHub API response and stores
 * it; three call sites later hand it to `browser.tabs.create`. A GitHub API
 * response always carries an `html_url` of the form
 * `https://github.com/{owner}/{repo}/releases/tag/{tag}`, so anything else
 * means the response was tampered with or mis-parsed.
 *
 * The realistic threat is a TLS-intercepting proxy with an installed root CA
 * (corporate proxy, malware, or a developer machine with a debugging CA).
 * `host_permissions` pins the fetch to `https://api.github.com/*`, so a plain
 * network attacker cannot reach this — but a proxy that MITMs that host can
 * return any URL it likes, and the extension would relay it behind a genuine
 * system notification reading "Update available: 1.6.0". Chrome blocks
 * `javascript:` in `tabs.create`, so this is phishing, not code execution.
 *
 * Returns the URL unchanged when acceptable, or `""` when it must be rejected.
 */
export function sanitizeReleaseUrl(raw: string | undefined | null): string {
  if (typeof raw !== "string" || raw.trim() === "") return "";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:") return "";
  const host = parsed.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return "";
  return parsed.toString();
}

/**
 * Open a validated release page in a new tab.
 *
 * This is the single chokepoint for "user clicked a link to a release". It
 * re-validates rather than trusting the stored value: `latestVersionItem` is a
 * storage item, so a future writer (or a hand-edited profile) could put
 * anything there, and the notification-click path in particular fires behind a
 * system notification the user trusts.
 *
 * Returns false when the URL was rejected, so callers can surface nothing
 * rather than opening a blank or hostile tab.
 */
export async function openReleasePage(htmlUrl: string): Promise<boolean> {
  const safe = sanitizeReleaseUrl(htmlUrl);
  if (!safe) return false;
  try {
    await browser.tabs.create({ url: safe });
    return true;
  } catch (err) {
    captureError(err, { action: "openReleasePage" });
    return false;
  }
}

export async function checkForUpdate(): Promise<void> {
  const repo = (import.meta.env.WXT_GITHUB_REPO as string | undefined)?.trim();
  if (!repo) return;

  const url = `https://api.github.com/repos/${repo}/releases/latest`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
    });

    if (response.status === 404) {
      // No releases published yet — not an error condition
      await latestVersionCheckedAtItem.setValue(new Date().toISOString());
      return;
    }

    if (!response.ok) {
      throw new Error(`GitHub API responded with HTTP ${response.status}`);
    }

    const json = (await response.json()) as {
      tag_name?: string;
      html_url?: string;
      published_at?: string;
      prerelease?: boolean;
    };

    // Skip prereleases
    if (json.prerelease) {
      await latestVersionCheckedAtItem.setValue(new Date().toISOString());
      return;
    }

    const remoteVersion = json.tag_name?.replace(/^v/, "") ?? "";
    const publishedAt = json.published_at ?? new Date().toISOString();

    if (!remoteVersion) {
      await latestVersionCheckedAtItem.setValue(new Date().toISOString());
      return;
    }

    // Reject a release page we cannot vouch for. A banner whose link we do not
    // trust is worse than no banner, so drop the whole update rather than
    // storing a URL some call site might open. The check timestamp is still
    // recorded so a bad response does not cause a fetch storm.
    const htmlUrl = sanitizeReleaseUrl(json.html_url);
    if (!htmlUrl) {
      captureError(new Error("Rejected release URL with an unexpected host"), {
        action: "checkForUpdate",
        repo,
      });
      await latestVersionCheckedAtItem.setValue(new Date().toISOString());
      return;
    }

    const currentVersion = getCurrentVersion();

    if (compareVersions(remoteVersion, currentVersion) > 0) {
      await latestVersionItem.setValue({
        version: remoteVersion,
        htmlUrl,
        publishedAt,
      });
    } else {
      // Installed version is up-to-date — clear any stale update info
      await latestVersionItem.setValue(null);
    }

    await latestVersionCheckedAtItem.setValue(new Date().toISOString());
  } catch (err) {
    captureError(err, { action: "checkForUpdate", repo });
  }
}

/**
 * Pure helper: decide whether the update alert/banner should be shown.
 *
 * Returns true only when:
 *   1. latestVersion is non-null (an update was found).
 *   2. The found version has not been explicitly dismissed by the user.
 */
export function shouldShowUpdateAlert(
  latestVersion: ReleaseInfo | null,
  dismissedVersion: string
): boolean {
  if (!latestVersion) return false;
  return latestVersion.version !== dismissedVersion;
}
