/**
 * Tests for src/lib/update-checker.ts
 * spec: specs/update-checker.spec.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  compareVersions,
  getCurrentVersion,
  checkForUpdate,
  shouldShowUpdateAlert,
  type ReleaseInfo,
} from "./update-checker";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("~/lib/sentry", () => ({
  captureError: vi.fn(),
  captureMessage: vi.fn(),
}));

import { captureError } from "~/lib/sentry";

const mockLatestVersionItem = vi.hoisted(() => ({
  getValue: vi.fn(async () => null),
  setValue: vi.fn(async () => {}),
}));

const mockLatestVersionCheckedAtItem = vi.hoisted(() => ({
  getValue: vi.fn(async () => null),
  setValue: vi.fn(async () => {}),
}));

const mockDismissedUpdateVersionItem = vi.hoisted(() => ({
  getValue: vi.fn(async () => ""),
  setValue: vi.fn(async () => {}),
}));

vi.mock("~/storage/items", () => ({
  latestVersionItem: mockLatestVersionItem,
  latestVersionCheckedAtItem: mockLatestVersionCheckedAtItem,
  dismissedUpdateVersionItem: mockDismissedUpdateVersionItem,
  // Other items not used by update-checker
  giphyApiKeyItem: { getValue: vi.fn(), setValue: vi.fn() },
  localSnippetsItem: { getValue: vi.fn(), setValue: vi.fn() },
  cachedSnippetsItem: { getValue: vi.fn(), setValue: vi.fn() },
  contextMenuDraftItem: { getValue: vi.fn(), setValue: vi.fn() },
  blockedSitesItem: { getValue: vi.fn(), setValue: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRelease(
  overrides: Partial<{
    tag_name: string;
    html_url: string;
    published_at: string;
    prerelease: boolean;
  }> = {}
) {
  return {
    tag_name: "v1.2.0",
    html_url: "https://github.com/owner/repo/releases/tag/v1.2.0",
    published_at: "2026-01-01T00:00:00Z",
    prerelease: false,
    ...overrides,
  };
}

function mockFetchSuccess(body: object) {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

function mockFetchStatus(status: number) {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
  });
}

function mockFetchNetworkError() {
  global.fetch = vi.fn().mockRejectedValueOnce(new TypeError("Network error"));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WXT_GITHUB_REPO", "owner/repo");
  // Default: manifest version is "1.1.0"
  vi.mocked(browser.runtime.getManifest).mockReturnValue({
    name: "Clipio",
    version: "1.1.0",
    manifest_version: 3,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// compareVersions
// ---------------------------------------------------------------------------

describe("compareVersions", () => {
  it("returns 1 when a > b (major)", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
  });

  it("returns -1 when a < b (major)", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
  });

  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("returns 1 when minor is greater", () => {
    expect(compareVersions("1.2.0", "1.1.9")).toBe(1);
  });

  it("returns -1 when patch is less", () => {
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
  });

  it("returns 1 when patch is greater", () => {
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
  });

  it("strips leading v prefix", () => {
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "v1.0.0")).toBe(0);
    expect(compareVersions("v2.0.0", "v1.0.0")).toBe(1);
  });

  it("treats missing patch as 0", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });

  it("treats non-numeric segments as 0", () => {
    // "1.2.3-beta" → [1, 2, 3] (pre-release tag ignored)
    expect(compareVersions("1.2.3-beta", "1.2.3")).toBe(0);
  });

  it("returns 0 for two empty strings", () => {
    expect(compareVersions("", "")).toBe(0);
  });

  it("compares only first three parts (ignores fourth)", () => {
    expect(compareVersions("1.0.0.1", "1.0.0.9")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getCurrentVersion
// ---------------------------------------------------------------------------

describe("getCurrentVersion", () => {
  it("returns manifest version when available", () => {
    expect(getCurrentVersion()).toBe("1.1.0");
  });

  it("returns '0.0.0' when browser.runtime throws", () => {
    vi.mocked(browser.runtime.getManifest).mockImplementationOnce(() => {
      throw new Error("not available");
    });
    expect(getCurrentVersion()).toBe("0.0.0");
  });
});

// ---------------------------------------------------------------------------
// shouldShowUpdateAlert
// ---------------------------------------------------------------------------

describe("shouldShowUpdateAlert", () => {
  const release: ReleaseInfo = {
    version: "1.2.0",
    htmlUrl: "https://github.com/owner/repo/releases/tag/v1.2.0",
    publishedAt: "2026-01-01T00:00:00Z",
  };

  it("returns false when latestVersion is null", () => {
    expect(shouldShowUpdateAlert(null, "")).toBe(false);
  });

  it("returns false when version equals dismissedVersion", () => {
    expect(shouldShowUpdateAlert(release, "1.2.0")).toBe(false);
  });

  it("returns true when latestVersion is set and not dismissed", () => {
    expect(shouldShowUpdateAlert(release, "")).toBe(true);
  });

  it("returns true when dismissed version is a different (older) version", () => {
    expect(shouldShowUpdateAlert(release, "1.0.0")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkForUpdate — early return cases
// ---------------------------------------------------------------------------

describe("checkForUpdate — no-ops", () => {
  it("returns early when WXT_GITHUB_REPO is not set", async () => {
    vi.stubEnv("WXT_GITHUB_REPO", "");
    global.fetch = vi.fn();
    await checkForUpdate();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockLatestVersionItem.setValue).not.toHaveBeenCalled();
  });

  it("returns early when WXT_GITHUB_REPO is whitespace", async () => {
    vi.stubEnv("WXT_GITHUB_REPO", "  ");
    global.fetch = vi.fn();
    await checkForUpdate();
    expect(mockLatestVersionItem.setValue).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// checkForUpdate — HTTP 404 (no releases)
// ---------------------------------------------------------------------------

describe("checkForUpdate — 404 (no releases)", () => {
  it("updates checkedAt timestamp but does not write latestVersionItem", async () => {
    mockFetchStatus(404);
    await checkForUpdate();
    expect(mockLatestVersionCheckedAtItem.setValue).toHaveBeenCalledOnce();
    expect(mockLatestVersionItem.setValue).not.toHaveBeenCalled();
    expect(captureError).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// checkForUpdate — update available
// ---------------------------------------------------------------------------

describe("checkForUpdate — update available", () => {
  it("writes latestVersionItem when remote version is newer", async () => {
    mockFetchSuccess(makeRelease({ tag_name: "v1.2.0" }));
    await checkForUpdate();

    expect(mockLatestVersionItem.setValue).toHaveBeenCalledWith({
      version: "1.2.0",
      htmlUrl: "https://github.com/owner/repo/releases/tag/v1.2.0",
      publishedAt: "2026-01-01T00:00:00Z",
    });
    expect(mockLatestVersionCheckedAtItem.setValue).toHaveBeenCalledOnce();
  });

  it("strips leading v from tag_name", async () => {
    mockFetchSuccess(makeRelease({ tag_name: "v2.0.0" }));
    await checkForUpdate();
    const calls = mockLatestVersionItem.setValue.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const arg = calls[0] as unknown as [ReleaseInfo | null];
    expect(arg[0]).not.toBeNull();
    expect((arg[0] as ReleaseInfo).version).toBe("2.0.0");
  });
});

// ---------------------------------------------------------------------------
// checkForUpdate — up-to-date
// ---------------------------------------------------------------------------

describe("checkForUpdate — up-to-date", () => {
  it("writes null to latestVersionItem when installed version is current", async () => {
    mockFetchSuccess(makeRelease({ tag_name: "v1.1.0" }));
    await checkForUpdate();
    expect(mockLatestVersionItem.setValue).toHaveBeenCalledWith(null);
  });

  it("writes null when installed version is newer than remote", async () => {
    mockFetchSuccess(makeRelease({ tag_name: "v1.0.0" }));
    await checkForUpdate();
    expect(mockLatestVersionItem.setValue).toHaveBeenCalledWith(null);
  });
});

// ---------------------------------------------------------------------------
// checkForUpdate — prerelease
// ---------------------------------------------------------------------------

describe("checkForUpdate — prerelease", () => {
  it("skips prerelease and does not write latestVersionItem", async () => {
    mockFetchSuccess(makeRelease({ tag_name: "v2.0.0", prerelease: true }));
    await checkForUpdate();
    expect(mockLatestVersionItem.setValue).not.toHaveBeenCalled();
    expect(mockLatestVersionCheckedAtItem.setValue).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// checkForUpdate — missing tag_name
// ---------------------------------------------------------------------------

describe("checkForUpdate — missing tag_name", () => {
  it("skips write when tag_name is absent", async () => {
    mockFetchSuccess({
      html_url: "https://github.com",
      published_at: "2026-01-01T00:00:00Z",
    });
    await checkForUpdate();
    expect(mockLatestVersionItem.setValue).not.toHaveBeenCalled();
    expect(mockLatestVersionCheckedAtItem.setValue).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// checkForUpdate — HTTP errors
// ---------------------------------------------------------------------------

describe("checkForUpdate — HTTP errors", () => {
  it("captures error on HTTP 500 and does not throw", async () => {
    mockFetchStatus(500);
    await expect(checkForUpdate()).resolves.toBeUndefined();
    expect(captureError).toHaveBeenCalled();
  });

  it("captures error on network failure and does not throw", async () => {
    mockFetchNetworkError();
    await expect(checkForUpdate()).resolves.toBeUndefined();
    expect(captureError).toHaveBeenCalled();
  });
});
