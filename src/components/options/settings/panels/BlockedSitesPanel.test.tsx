/**
 * Direct tests for the blocked-sites panel's own logic.
 *
 * The panel validates and normalises input before writing storage, and it has
 * two distinct failure paths (invalid input and a rejected write). Those are
 * driven here through the rendered input and buttons rather than by calling a
 * handler in isolation, so a test fails when the UI stops reaching the logic.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalSetTimeout = globalThis.setTimeout;

const mocks = vi.hoisted(() => ({
  blockedSitesItem: {
    getValue: vi.fn(),
    setValue: vi.fn(),
  },
  captureError: vi.fn(),
}));

vi.mock("@/storage/items", () => ({
  blockedSitesItem: mocks.blockedSitesItem,
}));
vi.mock("@/lib/sentry", () => ({ captureError: mocks.captureError }));

import { BlockedSitesPanel, isValidHostname } from "./BlockedSitesPanel";
import { i18n } from "../../../../../tests/mocks/i18n";

const invalidCopy = i18n.t("options.generalSection.blockedSites.errorInvalid");
const duplicateCopy = i18n.t(
  "options.generalSection.blockedSites.errorDuplicate"
);

function renderPanel() {
  return render(<BlockedSitesPanel />);
}

async function typeSite(value: string) {
  fireEvent.change(screen.getByTestId("blocked-site-input"), {
    target: { value },
  });
  await waitFor(() =>
    expect(screen.getByTestId("blocked-site-input")).toHaveValue(value)
  );
}

async function clickAdd() {
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("options.generalSection.blockedSites.addButton"),
    })
  );
}

beforeEach(() => {
  mocks.blockedSitesItem.getValue.mockResolvedValue([]);
  mocks.blockedSitesItem.setValue.mockResolvedValue(undefined);
  mocks.captureError.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isValidHostname", () => {
  it("accepts dotted hostnames and wildcard subdomain patterns", () => {
    // A bare subdomain and a wildcard are the two shapes the UI advertises.
    expect(isValidHostname("example.com")).toBe(true);
    expect(isValidHostname("mail.example.com")).toBe(true);
    expect(isValidHostname("*.example.com")).toBe(true);
    expect(isValidHostname("a-b.example.co.uk")).toBe(true);
  });

  it("rejects single labels, invalid wildcards and hyphen-edged labels", () => {
    // Each of these would silently never match `location.hostname`, so a write
    // would look successful while the blocklist stayed ineffective.
    expect(isValidHostname("localhost")).toBe(false);
    expect(isValidHostname("*.localhost")).toBe(false);
    expect(isValidHostname("*")).toBe(false);
    expect(isValidHostname("*.")).toBe(false);
    expect(isValidHostname("-example.com")).toBe(false);
    expect(isValidHostname("example.com-")).toBe(false);
    expect(isValidHostname("bad_host.example")).toBe(false);
    expect(isValidHostname("")).toBe(false);
  });
});

describe("BlockedSitesPanel", () => {
  it("loads the stored sites into the panel", async () => {
    mocks.blockedSitesItem.getValue.mockResolvedValue(["example.com"]);

    renderPanel();

    expect(await screen.findByText("example.com")).toBeInTheDocument();
    expect(screen.getByTestId("panel-blocked-sites")).toBeInTheDocument();
  });

  it("shows the stored list as empty when the read returns null", async () => {
    mocks.blockedSitesItem.getValue.mockResolvedValue(null);

    renderPanel();

    expect(
      await screen.findByText(
        i18n.t("options.generalSection.blockedSites.empty")
      )
    ).toBeInTheDocument();
  });

  it("rejects an invalid hostname without writing storage", async () => {
    renderPanel();

    await typeSite("not a hostname");
    await clickAdd();

    expect(await screen.findByRole("alert")).toHaveTextContent(invalidCopy);
    expect(mocks.blockedSitesItem.setValue).not.toHaveBeenCalled();
  });

  it("rejects a duplicate without a second write", async () => {
    mocks.blockedSitesItem.getValue.mockResolvedValue(["example.com"]);

    renderPanel();
    await screen.findByText("example.com");
    await typeSite("example.com");
    await clickAdd();

    expect(await screen.findByRole("alert")).toHaveTextContent(duplicateCopy);
    expect(mocks.blockedSitesItem.setValue).not.toHaveBeenCalled();
  });

  it("normalises input, writes it, clears the field and reports success", async () => {
    renderPanel();
    await screen.findByTestId("blocked-site-input");

    await typeSite("  HTTPS://Mail.Example.com/login?x=1 ");
    await clickAdd();

    await waitFor(() =>
      expect(mocks.blockedSitesItem.setValue).toHaveBeenCalledWith([
        "mail.example.com",
      ])
    );
    expect(await screen.findByText("mail.example.com")).toBeInTheDocument();
    expect(screen.getByTestId("blocked-site-input")).toHaveValue("");
    expect(screen.getByTestId("blocked-site-status")).toHaveTextContent(
      i18n.t("options.generalSection.blockedSites.added")
    );
  });

  it("adds a site from the Enter key", async () => {
    renderPanel();
    const input = await screen.findByTestId("blocked-site-input");

    fireEvent.change(input, { target: { value: "*.slack.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mocks.blockedSitesItem.setValue).toHaveBeenCalledWith([
        "*.slack.com",
      ])
    );
  });

  it("removes only the requested site", async () => {
    mocks.blockedSitesItem.getValue.mockResolvedValue([
      "example.com",
      "other.test",
    ]);

    renderPanel();
    await screen.findByText("example.com");

    fireEvent.click(
      screen.getByRole("button", {
        name: `${i18n.t("options.generalSection.blockedSites.remove")} example.com`,
      })
    );

    await waitFor(() =>
      expect(mocks.blockedSitesItem.setValue).toHaveBeenCalledWith([
        "other.test",
      ])
    );
    expect(screen.queryByText("example.com")).not.toBeInTheDocument();
    expect(screen.getByText("other.test")).toBeInTheDocument();
    expect(screen.getByTestId("blocked-site-status")).toHaveTextContent(
      i18n.t("options.generalSection.blockedSites.removed")
    );
  });

  it("reports a rejected add write and leaves the list unchanged", async () => {
    const failure = new Error("storage full");
    mocks.blockedSitesItem.setValue.mockRejectedValue(failure);

    renderPanel();
    await screen.findByTestId("blocked-site-input");
    await typeSite("example.com");
    await clickAdd();

    await waitFor(() =>
      expect(mocks.captureError).toHaveBeenCalledWith(failure, {
        action: "addBlockedSite",
      })
    );
    expect(screen.queryByText("example.com")).not.toBeInTheDocument();
    expect(screen.queryByTestId("blocked-site-status")).not.toBeInTheDocument();
  });

  it("reports a rejected remove write and keeps the site on screen", async () => {
    const failure = new Error("storage unavailable");
    mocks.blockedSitesItem.getValue.mockResolvedValue(["example.com"]);
    mocks.blockedSitesItem.setValue.mockRejectedValue(failure);

    renderPanel();
    await screen.findByText("example.com");
    fireEvent.click(
      screen.getByRole("button", {
        name: `${i18n.t("options.generalSection.blockedSites.remove")} example.com`,
      })
    );

    await waitFor(() =>
      expect(mocks.captureError).toHaveBeenCalledWith(failure, {
        action: "removeBlockedSite",
      })
    );
    expect(screen.getByText("example.com")).toBeInTheDocument();
  });

  it("dismisses a validation error and clears the success flash on its timer", async () => {
    // Only the 2s flash timer is captured; leaving the 8s error timer real
    // keeps `findBy*` working, while advancing the flash manually avoids a
    // two-second wait in the test.
    const flashTimers: Array<() => void> = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      cb: () => void,
      ms?: number
    ) => {
      if (ms === 2000) {
        flashTimers.push(cb);
        return 0;
      }
      return originalSetTimeout(cb, ms);
    }) as typeof setTimeout);

    renderPanel();
    await screen.findByTestId("blocked-site-input");

    await typeSite("localhost");
    await clickAdd();
    const alert = await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", {
        name: i18n.t("common.dismissError"),
      })
    );
    expect(alert).not.toBeInTheDocument();

    await typeSite("example.com");
    await clickAdd();
    expect(await screen.findByTestId("blocked-site-status")).toBeVisible();
    expect(flashTimers).toHaveLength(1);
    act(() => flashTimers[0]());
    expect(screen.queryByTestId("blocked-site-status")).not.toBeInTheDocument();
  });
});
