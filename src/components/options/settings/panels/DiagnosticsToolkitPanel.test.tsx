/**
 * Direct tests for the Diagnostics snapshot toolkit.
 *
 * The collector and report formatter have their own tests. These cover what the
 * panel owns: disabling exports before a snapshot exists, surfacing a failed
 * collection, and handing the formatted report to the clipboard or a download.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FeedbackBanner,
  FeedbackProvider,
} from "@/components/feedback/FeedbackProvider";
import type { DiagnosticsSnapshot } from "@/lib/diagnostics";
import { i18n } from "../../../../../tests/mocks/i18n";

const mocks = vi.hoisted(() => ({
  collectDiagnostics: vi.fn(),
  captureError: vi.fn(),
  writeText: vi.fn(),
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
  anchorClick: vi.fn(),
}));

vi.mock("@/components/options/collect-diagnostics", () => ({
  collectDiagnostics: mocks.collectDiagnostics,
}));
vi.mock("@/lib/sentry", () => ({ captureError: mocks.captureError }));

import { DiagnosticsToolkitPanel } from "./DiagnosticsToolkitPanel";

function makeSnapshot(): DiagnosticsSnapshot {
  return {
    generatedAt: "2026-01-02T03:04:05.000Z",
    version: "1.2.3",
    storage: {
      mode: "local",
      quotaExceeded: true,
      localReason: "quota",
      snippetCount: 4,
      cachedSnippetCount: 3,
      backupSnippetCount: 2,
      corruptKeys: ["corrupt:snip:1"],
      syncDataLost: true,
      lastSentryErrorAt: "2026-01-01T00:00:00.000Z",
      customGiphyKey: true,
    },
    debugMode: true,
    log: {
      total: 1,
      content: 1,
      background: 0,
      storage: 0,
      suspicious: 1,
      byEvent: { "expand:no-match": 1 },
      firstAt: 1,
      lastAt: 1,
    },
    entries: [
      {
        ts: 1,
        context: "content",
        event: "expand:no-match",
        detail:
          '{"text":"typed secret","apiKey":"supersecretkey12345678901234567890"}',
      },
    ],
    tabs: {
      eligible: 2,
      active: 1,
      missing: 1,
      entries: [{ tabId: 1, host: "example.com", alive: true }],
      error: "tabs denied",
    },
    errors: { snippets: "sync denied" },
  };
}

function renderPanel() {
  return render(
    <FeedbackProvider>
      <DiagnosticsToolkitPanel />
      <FeedbackBanner testId="feedback-banner" />
    </FeedbackProvider>
  );
}

const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard"
);
const createObjectURLDescriptor = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL"
);
const revokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL"
);
const anchorClickDescriptor = Object.getOwnPropertyDescriptor(
  HTMLAnchorElement.prototype,
  "click"
);

async function collect() {
  fireEvent.click(screen.getByTestId("button-collect-diagnostics"));
  await screen.findByTestId("diagnostics-summary");
}

beforeEach(() => {
  mocks.collectDiagnostics.mockReset().mockResolvedValue(makeSnapshot());
  mocks.captureError.mockReset();
  mocks.writeText.mockReset().mockResolvedValue(undefined);
  mocks.createObjectURL.mockReset().mockReturnValue("blob:mock");
  mocks.revokeObjectURL.mockReset();
  mocks.anchorClick.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeText },
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: mocks.createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: mocks.revokeObjectURL,
  });
  Object.defineProperty(HTMLAnchorElement.prototype, "click", {
    configurable: true,
    value: mocks.anchorClick,
  });
});

afterEach(() => {
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
  if (createObjectURLDescriptor)
    Object.defineProperty(URL, "createObjectURL", createObjectURLDescriptor);
  else Reflect.deleteProperty(URL, "createObjectURL");
  if (revokeObjectURLDescriptor)
    Object.defineProperty(URL, "revokeObjectURL", revokeObjectURLDescriptor);
  else Reflect.deleteProperty(URL, "revokeObjectURL");
  if (anchorClickDescriptor)
    Object.defineProperty(
      HTMLAnchorElement.prototype,
      "click",
      anchorClickDescriptor
    );
  else Reflect.deleteProperty(HTMLAnchorElement.prototype, "click");
  vi.clearAllMocks();
});

describe("DiagnosticsToolkitPanel", () => {
  it("keeps exports disabled until a snapshot has been collected", () => {
    renderPanel();

    expect(screen.getByTestId("button-copy-diagnostics")).toBeDisabled();
    expect(screen.getByTestId("button-download-diagnostics")).toBeDisabled();
  });

  it("collects a snapshot and renders every summary row", async () => {
    renderPanel();
    await collect();

    expect(mocks.collectDiagnostics).toHaveBeenCalledOnce();
    expect(screen.getByTestId("diag-storage-mode")).toHaveTextContent("local");
    expect(screen.getByTestId("diag-storage-mode")).toHaveTextContent(
      i18n.t("options.developers.toolkit.quotaFallback")
    );
    expect(screen.getByTestId("diag-snippets")).toHaveTextContent("4");
    expect(screen.getByTestId("diag-cached-snippets")).toHaveTextContent("3");
    expect(screen.getByTestId("diag-backup-snippets")).toHaveTextContent("2");
    expect(screen.getByTestId("diag-corrupt-keys")).toHaveTextContent("1");
    expect(screen.getByTestId("diag-sync-data-lost")).toHaveTextContent(
      i18n.t("options.developers.toolkit.yes")
    );
    expect(screen.getByTestId("diag-custom-giphy-key")).toHaveTextContent(
      i18n.t("options.developers.toolkit.yes")
    );
    expect(screen.getByTestId("diag-last-sentry-error")).toHaveTextContent(
      "2026-01-01T00:00:00.000Z"
    );
    expect(screen.getByTestId("diag-debug-mode")).toHaveTextContent(
      i18n.t("options.developers.toolkit.yes")
    );
    expect(screen.getByTestId("diag-log-entries")).toHaveTextContent("1");
    expect(screen.getByTestId("diag-suspicious-events")).toHaveTextContent("1");
    expect(screen.getByTestId("diag-tab-health")).toHaveTextContent(
      i18n.t("options.developers.toolkit.tabsActive", [1])
    );
    expect(screen.getByTestId("diag-tab-health")).toHaveTextContent(
      i18n.t("options.developers.toolkit.tabsMissing", [1])
    );
    expect(screen.getByTestId("diag-tab-error")).toHaveTextContent(
      "tabs denied"
    );
    expect(screen.getByTestId("diag-collection-warnings")).toHaveTextContent(
      "snippets: sync denied"
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      i18n.t("options.developers.toolkit.collected")
    );
  });

  it("disables the collect button while a snapshot is in flight", async () => {
    let resolve: (value: DiagnosticsSnapshot) => void = () => {};
    mocks.collectDiagnostics.mockReturnValue(
      new Promise<DiagnosticsSnapshot>((r) => {
        resolve = r;
      })
    );
    renderPanel();

    fireEvent.click(screen.getByTestId("button-collect-diagnostics"));
    const busy = screen.getByRole("button", {
      name: i18n.t("options.developers.toolkit.collecting"),
    });
    expect(busy).toBeDisabled();

    await act(async () => resolve(makeSnapshot()));
    await waitFor(() =>
      expect(screen.getByTestId("button-collect-diagnostics")).toBeEnabled()
    );
  });

  it("copies a redacted report and confirms success", async () => {
    renderPanel();
    await collect();

    fireEvent.click(screen.getByTestId("button-copy-diagnostics"));

    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledOnce());
    const report = mocks.writeText.mock.calls[0][0] as string;
    expect(report).toContain("# Clipio diagnostics report");
    expect(report).not.toContain("supersecretkey12345678901234567890");
    expect(report).not.toContain("typed secret");
    expect(screen.getByRole("status")).toHaveTextContent(
      i18n.t("options.developers.toolkit.copiedReport")
    );
  });

  it("reports a failed copy without claiming success", async () => {
    const failure = new Error("clipboard denied");
    mocks.writeText.mockRejectedValue(failure);
    renderPanel();
    await collect();

    fireEvent.click(screen.getByTestId("button-copy-diagnostics"));

    await waitFor(() =>
      expect(mocks.captureError).toHaveBeenCalledWith(failure, {
        action: "copyDiagnosticsReport",
      })
    );
    expect(screen.getByTestId("feedback-banner")).toHaveTextContent(
      i18n.t("options.developers.toolkit.copyFailed")
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      i18n.t("options.developers.toolkit.copyFailed")
    );
  });

  it("downloads a Markdown report with a timestamped filename", async () => {
    renderPanel();
    await collect();

    fireEvent.click(screen.getByTestId("button-download-diagnostics"));

    expect(mocks.createObjectURL).toHaveBeenCalledOnce();
    expect(mocks.createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(mocks.anchorClick).toHaveBeenCalledOnce();
    const link = mocks.anchorClick.mock.contexts[0] as HTMLAnchorElement;
    expect(link.download).toBe(
      "clipio-diagnostics-2026-01-02T03-04-05-000Z.md"
    );
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    expect(screen.getByRole("status")).toHaveTextContent(
      i18n.t("options.developers.toolkit.downloaded")
    );
  });

  it("reports a failed download", async () => {
    const failure = new Error("blob unsupported");
    mocks.createObjectURL.mockImplementation(() => {
      throw failure;
    });
    renderPanel();
    await collect();

    fireEvent.click(screen.getByTestId("button-download-diagnostics"));

    await waitFor(() =>
      expect(mocks.captureError).toHaveBeenCalledWith(failure, {
        action: "downloadDiagnosticsReport",
      })
    );
    expect(screen.getByTestId("feedback-banner")).toHaveTextContent(
      i18n.t("options.developers.toolkit.downloadFailed")
    );
  });

  it("reports a failed collection and keeps exports disabled", async () => {
    const failure = new Error("collector exploded");
    mocks.collectDiagnostics.mockRejectedValue(failure);
    renderPanel();

    fireEvent.click(screen.getByTestId("button-collect-diagnostics"));

    await waitFor(() =>
      expect(mocks.captureError).toHaveBeenCalledWith(failure, {
        action: "collectDiagnostics",
      })
    );
    expect(screen.getByTestId("feedback-banner")).toHaveTextContent(
      i18n.t("options.developers.toolkit.collectFailed")
    );
    expect(screen.queryByTestId("diagnostics-summary")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-copy-diagnostics")).toBeDisabled();
  });
});
