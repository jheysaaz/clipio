/**
 * Direct tests for the content-script health check.
 *
 * The panel's decisions are all in `ping`: which tab is eligible, whether the
 * content script answered, and how a thrown query differs from a rejected
 * message. Both browser APIs are stubbed at the boundary and restored after
 * each test.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

vi.mock("@/lib/protocol", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/protocol")>();
  return { ...actual, sendMessage: mocks.sendMessage };
});
import {
  FeedbackBanner,
  FeedbackProvider,
} from "@/components/feedback/FeedbackProvider";
import { MESSAGE } from "@/lib/protocol";
import { mockTabs } from "../../../../../tests/mocks/browser";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { i18n } from "../../../../../tests/mocks/i18n";

function renderPanel() {
  return render(
    <FeedbackProvider>
      <DiagnosticsPanel />
      <FeedbackBanner testId="feedback-banner" />
    </FeedbackProvider>
  );
}

const pingButton = () =>
  screen.getByRole("button", {
    name: i18n.t("options.developers.contentScriptHealth.pingButton"),
  });

beforeEach(() => {
  mockTabs.query.mockReset().mockResolvedValue([]);
  mocks.sendMessage.mockReset().mockResolvedValue({ pong: true });
});

afterEach(() => {
  mockTabs.query.mockReset().mockResolvedValue([]);
  mocks.sendMessage.mockReset();
});

describe("DiagnosticsPanel", () => {
  it("reports no eligible tab when every tab is internal or id-less", async () => {
    mockTabs.query.mockResolvedValue([
      { id: 1, url: "chrome://extensions/" },
      { id: 2, url: "chrome-extension://abc/popup.html" },
      { id: 3, url: "about:blank" },
      { id: 4, url: "edge://settings" },
      { id: 5, url: "moz-extension://abc/options.html" },
      { url: "https://example.com" },
      { id: undefined, url: "https://missing-id.test" },
    ]);

    renderPanel();
    fireEvent.click(pingButton());

    await waitFor(() =>
      expect(screen.getByTestId("feedback-banner")).toHaveTextContent(
        i18n.t("options.developers.contentScriptHealth.errorNoTab")
      )
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      i18n.t("options.developers.contentScriptHealth.errorNoTab")
    );
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("pings the first ordinary tab and reports a live content script", async () => {
    mockTabs.query.mockResolvedValue([
      { id: 1, url: "chrome://newtab/" },
      { id: 42, url: "https://example.com/page" },
      { id: 99, url: "https://second.example.org" },
    ]);

    renderPanel();
    fireEvent.click(pingButton());

    await waitFor(() =>
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        MESSAGE.CONTENT_PING,
        undefined,
        42
      )
    );
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      i18n.t("options.developers.contentScriptHealth.pong")
    );
    const control = screen.getByRole("button", {
      name: i18n.t("options.developers.contentScriptHealth.pingButton"),
    });
    expect(control.parentElement).toHaveTextContent(
      i18n.t("options.developers.contentScriptHealth.pong")
    );
    expect(screen.queryByTestId("feedback-banner")).not.toBeInTheDocument();
  });

  it("reports a missing content script when the ping is rejected", async () => {
    const failure = new Error("no receiving end");
    mockTabs.query.mockResolvedValue([{ id: 7, url: "https://example.com" }]);
    mocks.sendMessage.mockRejectedValue(failure);

    renderPanel();
    fireEvent.click(pingButton());

    await waitFor(() =>
      expect(screen.getByTestId("feedback-banner")).toHaveTextContent(
        i18n.t("options.developers.contentScriptHealth.errorNoContentScript")
      )
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      i18n.t("options.developers.contentScriptHealth.errorNoContentScript")
    );
  });

  it("reports a generic failure when the tab query throws", async () => {
    mockTabs.query.mockRejectedValue(new Error("permission denied"));

    renderPanel();
    fireEvent.click(pingButton());

    await waitFor(() =>
      expect(screen.getByTestId("feedback-banner")).toHaveTextContent(
        i18n.t("options.developers.contentScriptHealth.errorGeneric")
      )
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      i18n.t("options.developers.contentScriptHealth.errorGeneric")
    );
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(pingButton()).toBeEnabled();
  });

  it("disables the button while a ping is in flight and re-enables it after", async () => {
    let resolvePing: (value: { pong: true }) => void = () => {};
    mocks.sendMessage.mockReturnValue(
      new Promise<{ pong: true }>((resolve) => {
        resolvePing = resolve;
      })
    );
    mockTabs.query.mockResolvedValue([{ id: 42, url: "https://example.com" }]);

    renderPanel();
    fireEvent.click(pingButton());

    expect(
      screen.getByRole("button", {
        name: i18n.t("options.developers.contentScriptHealth.pinging"),
      })
    ).toBeDisabled();

    resolvePing({ pong: true });
    await waitFor(() => expect(pingButton()).toBeEnabled());
    expect(screen.getByRole("status")).toHaveTextContent(
      i18n.t("options.developers.contentScriptHealth.pong")
    );
  });
});
