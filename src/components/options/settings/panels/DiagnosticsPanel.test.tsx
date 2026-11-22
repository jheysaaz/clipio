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
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/protocol", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/protocol")>();
  return { ...actual, sendMessage: mocks.sendMessage };
});
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { MESSAGE } from "@/lib/protocol";
import { mockTabs } from "../../../../../tests/mocks/browser";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { i18n } from "../../../../../tests/mocks/i18n";

const pingButton = () =>
  screen.getByRole("button", {
    name: i18n.t("options.developers.contentScriptHealth.pingButton"),
  });

beforeEach(() => {
  mockTabs.query.mockReset().mockResolvedValue([]);
  mocks.sendMessage.mockReset().mockResolvedValue({ pong: true });
  mocks.toast.success.mockReset();
  mocks.toast.error.mockReset();
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

    render(<DiagnosticsPanel />);
    fireEvent.click(pingButton());

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        i18n.t("options.developers.contentScriptHealth.errorNoTab")
      )
    );
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("pings the first ordinary tab and reports a live content script", async () => {
    mockTabs.query.mockResolvedValue([
      { id: 1, url: "chrome://newtab/" },
      { id: 42, url: "https://example.com/page" },
      { id: 99, url: "https://second.example.org" },
    ]);

    render(<DiagnosticsPanel />);
    fireEvent.click(pingButton());

    await waitFor(() =>
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        MESSAGE.CONTENT_PING,
        undefined,
        42
      )
    );
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.toast.success).toHaveBeenCalledWith(
      i18n.t("options.developers.contentScriptHealth.pong")
    );
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("reports a missing content script when the ping is rejected", async () => {
    const failure = new Error("no receiving end");
    mockTabs.query.mockResolvedValue([{ id: 7, url: "https://example.com" }]);
    mocks.sendMessage.mockRejectedValue(failure);

    render(<DiagnosticsPanel />);
    fireEvent.click(pingButton());

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        i18n.t("options.developers.contentScriptHealth.errorNoContentScript")
      )
    );
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("reports a generic failure when the tab query throws", async () => {
    mockTabs.query.mockRejectedValue(new Error("permission denied"));

    render(<DiagnosticsPanel />);
    fireEvent.click(pingButton());

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        i18n.t("options.developers.contentScriptHealth.errorGeneric")
      )
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

    render(<DiagnosticsPanel />);
    fireEvent.click(pingButton());

    expect(
      screen.getByRole("button", {
        name: i18n.t("options.developers.contentScriptHealth.pinging"),
      })
    ).toBeDisabled();

    resolvePing({ pong: true });
    await waitFor(() => expect(pingButton()).toBeEnabled());
    expect(mocks.toast.success).toHaveBeenCalledTimes(1);
  });
});
