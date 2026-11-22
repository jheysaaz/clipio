import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentSiteHostname } from "./current-site";
import { mockTabs, resetBrowserMocks } from "../../tests/mocks/browser";

describe("getCurrentSiteHostname", () => {
  beforeEach(() => {
    resetBrowserMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("queries the active tab of the focused window and returns only its hostname", async () => {
    vi.mocked(mockTabs.query).mockResolvedValueOnce([
      { url: "https://example.com/owner/repo?tab=readme#install" },
    ] as never);

    expect(await getCurrentSiteHostname()).toBe("example.com");
    expect(mockTabs.query).toHaveBeenCalledWith({
      active: true,
      lastFocusedWindow: true,
    });
  });

  it("returns null when the active tab has no URL", async () => {
    vi.mocked(mockTabs.query).mockResolvedValueOnce([{}] as never);
    expect(await getCurrentSiteHostname()).toBeNull();
  });

  it("returns null for browser internal pages", async () => {
    // Their hostname is an extension id or a scheme, not a site the user chose.
    vi.mocked(mockTabs.query).mockResolvedValueOnce([
      { url: "chrome://extensions/" },
    ] as never);
    expect(await getCurrentSiteHostname()).toBeNull();
  });

  it("returns null when the tabs query fails", async () => {
    // No Sentry event: the useful context would be the URL we refuse to record.
    vi.mocked(mockTabs.query).mockRejectedValueOnce(new Error("no tabs"));
    await expect(getCurrentSiteHostname()).resolves.toBeNull();
  });
});
