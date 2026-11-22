/**
 * AboutPanel decides whether an update is advertised from two storage reads and
 * hides the store-review action on non-Chromium browsers. The reads and the
 * feedback modal are stubbed so those decisions are isolated from their peers.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  mockRuntime,
  mockTabs,
  resetBrowserMocks,
} from "../../../../../tests/mocks/browser";
import { i18n } from "../../../../../tests/mocks/i18n";
import type { ReleaseInfo } from "@/lib/update-checker";

const mocks = vi.hoisted(() => ({
  latestVersionItem: {
    getValue: vi.fn(),
    watch: vi.fn((_cb: (release: ReleaseInfo | null) => void) => vi.fn()),
  },
  dismissedUpdateVersionItem: {
    getValue: vi.fn(),
    watch: vi.fn((_cb: (value: string | null) => void) => vi.fn()),
  },
  openReleasePage: vi.fn(),
  isChromiumBrowser: vi.fn(),
  getStoreReviewUrl: vi.fn(() => "https://store.example/review"),
}));

vi.mock("@/storage/items", () => ({
  latestVersionItem: mocks.latestVersionItem,
  dismissedUpdateVersionItem: mocks.dismissedUpdateVersionItem,
}));
vi.mock("@/lib/update-checker", () => ({
  openReleasePage: mocks.openReleasePage,
  // Keep the real decision so the component tests exercise the same rule the
  // popup and the update checker use.
  shouldShowUpdateAlert: (
    latest: { version: string } | null,
    dismissed: string
  ) => latest !== null && latest.version !== dismissed,
}));
vi.mock("@/lib/review-prompt", () => ({
  isChromiumBrowser: mocks.isChromiumBrowser,
  getStoreReviewUrl: mocks.getStoreReviewUrl,
}));
vi.mock("@/components/options/FeedbackModal", () => ({
  FeedbackModal: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? <div data-testid="mock-feedback-open" onClick={onClose} /> : null,
}));

import { AboutPanel } from "./AboutPanel";

beforeEach(() => {
  resetBrowserMocks();
  mockRuntime.getManifest.mockReturnValue({
    name: "Clipio",
    version: "1.2.3",
    manifest_version: 3,
  });
  mocks.latestVersionItem.getValue.mockReset().mockResolvedValue(null);
  mocks.dismissedUpdateVersionItem.getValue.mockReset().mockResolvedValue("");
  mocks.latestVersionItem.watch.mockReset().mockReturnValue(vi.fn());
  mocks.dismissedUpdateVersionItem.watch.mockReset().mockReturnValue(vi.fn());
  mocks.openReleasePage.mockReset().mockResolvedValue(true);
  mocks.isChromiumBrowser.mockReset().mockReturnValue(true);
  mocks.getStoreReviewUrl.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AboutPanel", () => {
  it("shows the installed version from the manifest", () => {
    render(<AboutPanel />);

    expect(screen.getByTestId("about-version")).toHaveTextContent(
      i18n.t("options.about.version", ["1.2.3"])
    );
  });

  it("advertises a newer version and opens its release page", async () => {
    mocks.latestVersionItem.getValue.mockResolvedValue({
      version: "2.0.0",
      htmlUrl: "https://example.test/releases/2",
    });
    mocks.dismissedUpdateVersionItem.getValue.mockResolvedValue("1.9.0");

    render(<AboutPanel />);

    const banner = await screen.findByTestId("version-update-available");
    expect(banner).toHaveTextContent(
      i18n.t("options.about.updateAvailable", ["2.0.0"])
    );
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("options.copy.viewRelease") })
    );
    expect(mocks.openReleasePage).toHaveBeenCalledWith(
      "https://example.test/releases/2"
    );
  });

  it("reports up to date when a newer version was dismissed", async () => {
    mocks.latestVersionItem.getValue.mockResolvedValue({
      version: "2.0.0",
      htmlUrl: "https://example.test/releases/2",
    });
    mocks.dismissedUpdateVersionItem.getValue.mockResolvedValue("2.0.0");

    render(<AboutPanel />);

    expect(await screen.findByTestId("version-up-to-date")).toBeInTheDocument();
    expect(
      screen.queryByTestId("version-update-available")
    ).not.toBeInTheDocument();
  });

  it("reacts to a release found while the panel is open", async () => {
    let notifyLatest: ((release: ReleaseInfo) => void) | undefined;
    mocks.latestVersionItem.watch.mockImplementation(
      (cb: (release: ReleaseInfo) => void) => {
        notifyLatest = cb;
        return vi.fn();
      }
    );

    render(<AboutPanel />);
    expect(await screen.findByTestId("version-up-to-date")).toBeInTheDocument();

    notifyLatest?.({
      version: "3.0.0",
      htmlUrl: "https://example.test/releases/3",
      publishedAt: "2026-01-01T00:00:00Z",
    });

    expect(
      await screen.findByTestId("version-update-available")
    ).toHaveTextContent(i18n.t("options.about.updateAvailable", ["3.0.0"]));
  });

  it("reacts to a dismissal recorded while the panel is open", async () => {
    let notifyDismissed: ((value: string | null) => void) | undefined;
    mocks.latestVersionItem.getValue.mockResolvedValue({
      version: "3.0.0",
      htmlUrl: "https://example.test/releases/3",
      publishedAt: "2026-01-01T00:00:00Z",
    });
    mocks.dismissedUpdateVersionItem.watch.mockImplementation(
      (cb: (value: string | null) => void) => {
        notifyDismissed = cb;
        return vi.fn();
      }
    );

    render(<AboutPanel />);
    expect(
      await screen.findByTestId("version-update-available")
    ).toBeInTheDocument();

    notifyDismissed?.("3.0.0");
    expect(await screen.findByTestId("version-up-to-date")).toBeInTheDocument();

    notifyDismissed?.(null);
    expect(
      await screen.findByTestId("version-update-available")
    ).toBeInTheDocument();
  });

  it("stays up to date when no release information is available", async () => {
    render(<AboutPanel />);

    expect(await screen.findByTestId("version-up-to-date")).toBeInTheDocument();
  });

  it("ignores storage updates delivered after unmount", async () => {
    const unwatchLatest = vi.fn();
    const unwatchDismissed = vi.fn();
    let notifyLatest: ((release: ReleaseInfo | null) => void) | undefined;
    let notifyDismissed: ((value: string | null) => void) | undefined;
    mocks.latestVersionItem.watch.mockImplementation((cb) => {
      notifyLatest = cb;
      return unwatchLatest;
    });
    mocks.dismissedUpdateVersionItem.watch.mockImplementation((cb) => {
      notifyDismissed = cb;
      return unwatchDismissed;
    });

    const view = render(<AboutPanel />);
    view.unmount();

    expect(unwatchLatest).toHaveBeenCalledOnce();
    expect(unwatchDismissed).toHaveBeenCalledOnce();

    notifyLatest?.(null);
    notifyDismissed?.(null);
    expect(view.container).toBeEmptyDOMElement();
  });

  it("does not break when either storage read rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.latestVersionItem.getValue.mockRejectedValue(new Error("offline"));
    mocks.dismissedUpdateVersionItem.getValue.mockRejectedValue(
      new Error("offline")
    );

    render(<AboutPanel />);

    await waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("panel-about")).toBeInTheDocument();
  });

  it("opens and closes the feedback modal", () => {
    render(<AboutPanel />);

    expect(screen.queryByTestId("mock-feedback-open")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("about-feedback"));
    expect(screen.getByTestId("mock-feedback-open")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mock-feedback-open"));
    expect(screen.queryByTestId("mock-feedback-open")).not.toBeInTheDocument();
  });

  it("opens the donation page", () => {
    render(<AboutPanel />);

    fireEvent.click(screen.getByTestId("about-donate"));
    expect(mockTabs.create).toHaveBeenCalledWith({
      url: "https://github.com/sponsors/jheysaaz",
    });
  });

  it("offers the store review only on Chromium", () => {
    const chromium = render(<AboutPanel />);
    expect(screen.getByTestId("about-review")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("about-review"));
    expect(mockTabs.create).toHaveBeenCalledWith({
      url: "https://store.example/review",
    });
    chromium.unmount();

    mocks.isChromiumBrowser.mockReturnValue(false);
    render(<AboutPanel />);
    expect(screen.queryByTestId("about-review")).not.toBeInTheDocument();
  });
});
