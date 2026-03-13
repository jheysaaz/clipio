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

import { captureError } from "~/lib/sentry";
import {
  latestVersionItem,
  latestVersionCheckedAtItem,
  dismissedUpdateVersionItem,
} from "~/storage/items";

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
    const htmlUrl = json.html_url ?? "";
    const publishedAt = json.published_at ?? new Date().toISOString();

    if (!remoteVersion) {
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
