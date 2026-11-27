/**
 * LibraryPanel turns storage reads into a count and a usage list, and routes
 * export/import outcomes to inline confirmations or the shared banner. Those are
 * the decisions tested here; the importers and exporters have their own suites.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { i18n } from "../../../../../tests/mocks/i18n";

const mocks = vi.hoisted(() => ({
  getSnippets: vi.fn(),
  exportSnippets: vi.fn(),
  snippetsContainMedia: vi.fn(),
  usageCountsItem: { getValue: vi.fn() },
  captureError: vi.fn(),
  importWizard: {
    onClose: vi.fn(),
    onImportComplete: vi.fn(),
  },
}));

vi.mock("@/storage", () => ({
  getSnippets: mocks.getSnippets,
  exportSnippets: mocks.exportSnippets,
}));
vi.mock("@/lib/exporters/clipio", () => ({
  snippetsContainMedia: mocks.snippetsContainMedia,
}));
vi.mock("@/storage/items", () => ({ usageCountsItem: mocks.usageCountsItem }));
vi.mock("@/lib/sentry", () => ({ captureError: mocks.captureError }));
vi.mock("@/lib/importers/registry", () => ({
  IMPORT_PARSERS: [
    { id: "clipio", displayName: "Clipio", iconUrl: "/clipio.png" },
    { id: "text", displayName: "Plain text" },
  ],
}));
vi.mock("@/pages/options/LibraryImportPanel", () => ({
  IMPORT_PANEL_ANCHOR: "import-anchor",
}));
// The backup controls own their own storage and dialog tests. Here they are a
// stable landmark so this suite only decides that the panel renders them.
vi.mock("@/components/BackupManager", () => ({
  BackupManager: () => <div data-testid="backup-manager-mock" />,
}));
vi.mock("@/components/ImportWizard", () => ({
  default: ({
    onClose,
    onImportComplete,
  }: {
    onClose: () => void;
    onImportComplete: (count: number) => void;
  }) => (
    <div data-testid="mock-import-wizard">
      <button onClick={onClose}>close wizard</button>
      <button onClick={() => onImportComplete(3)}>complete wizard</button>
    </div>
  ),
}));

import {
  FeedbackBanner,
  FeedbackProvider,
} from "@/components/feedback/FeedbackProvider";
import { LibraryPanel } from "./LibraryPanel";

function renderPanel() {
  return render(
    <FeedbackProvider>
      <LibraryPanel />
      <FeedbackBanner testId="feedback-banner" />
    </FeedbackProvider>
  );
}

beforeEach(() => {
  mocks.getSnippets.mockReset().mockResolvedValue([]);
  mocks.exportSnippets.mockReset().mockResolvedValue(undefined);
  mocks.snippetsContainMedia.mockReset().mockReturnValue(false);
  mocks.usageCountsItem.getValue.mockReset().mockResolvedValue({});
  mocks.captureError.mockReset();
});

describe("LibraryPanel", () => {
  it("shows the three analytics side by side, with totals and a labelled top snippet", async () => {
    mocks.getSnippets.mockResolvedValue([
      { id: "a", label: "Greeting", shortcut: "/g" },
      { id: "b", label: "", shortcut: "/b" },
    ]);
    mocks.usageCountsItem.getValue.mockResolvedValue({
      a: 5,
      missing: 2,
      b: 1,
    });

    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("stat-snippets")).toHaveTextContent("2")
    );
    const stats = screen.getByTestId("library-stats");
    // All three figures share one row of equally sized, bordered containers.
    expect(stats).toHaveClass("grid", "grid-cols-3");
    expect(stats.children).toHaveLength(3);
    for (const tile of stats.children) {
      expect(tile).toHaveClass(
        "rounded-lg",
        "border",
        "border-border/70",
        "bg-muted/30",
        "p-3"
      );
    }
    expect(stats).toHaveTextContent(i18n.t("options.overview.snippets"));
    expect(screen.getByTestId("stat-total-uses")).toHaveTextContent("8");
    expect(stats).toHaveTextContent(i18n.t("options.library.totalUses"));
    const mostUsed = screen.getByTestId("stat-most-used");
    expect(stats).toHaveTextContent(i18n.t("options.library.mostUsed"));
    expect(mostUsed).toHaveTextContent("Greeting");
    expect(mostUsed).toHaveTextContent(i18n.t("options.library.uses", ["5"]));
    expect(screen.getByTestId("backup-manager-mock")).toBeInTheDocument();
  });

  it("places import ahead of export in the panel", () => {
    renderPanel();

    const importSection = document.getElementById("import-anchor");
    const exportButton = screen.getByTestId("export-json");
    expect(importSection).toBeInTheDocument();
    expect(
      importSection!.compareDocumentPosition(exportButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("keeps placeholders in every tile until the library reads settle", () => {
    renderPanel();

    for (const id of ["stat-snippets", "stat-total-uses", "stat-most-used"]) {
      expect(screen.getByTestId(id)).toHaveTextContent("—");
    }
  });

  it("shows zero uses and no top snippet when there is no usage data", async () => {
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("stat-total-uses")).toHaveTextContent("0")
    );
    expect(screen.getByTestId("stat-snippets")).toHaveTextContent("0");
    expect(screen.getByTestId("stat-most-used")).toHaveTextContent("—");
  });

  it("captures a failed library read instead of leaving the panel blank", async () => {
    const failure = new Error("storage down");
    mocks.getSnippets.mockRejectedValue(failure);

    renderPanel();

    await waitFor(() =>
      expect(mocks.captureError).toHaveBeenCalledWith(failure, {
        action: "libraryPanel.load",
      })
    );
  });

  it("changes the inline export confirmation when snippets contain media", async () => {
    mocks.getSnippets.mockResolvedValue([{ id: "a", label: "A" }]);
    const { unmount } = renderPanel();

    fireEvent.click(screen.getByTestId("export-json"));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        i18n.t("options.library.exported")
      )
    );
    expect(screen.getByTestId("export-json").parentElement).toHaveTextContent(
      i18n.t("options.library.exported")
    );
    unmount();

    mocks.snippetsContainMedia.mockReturnValue(true);
    renderPanel();
    fireEvent.click(screen.getByTestId("export-json"));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        i18n.t("options.library.exportedWithMedia")
      )
    );
    expect(screen.getByTestId("export-json").parentElement).toHaveTextContent(
      i18n.t("options.library.exportedWithMedia")
    );
  });

  it("reports the original error on export failure and a fallback for non-errors", async () => {
    const failure = new Error("disk full");
    mocks.exportSnippets.mockRejectedValueOnce(failure);
    const { unmount } = renderPanel();

    fireEvent.click(screen.getByTestId("export-json"));
    await waitFor(() =>
      expect(screen.getByTestId("feedback-banner")).toHaveTextContent(
        "disk full"
      )
    );
    expect(screen.getByRole("alert")).toHaveTextContent("disk full");
    expect(mocks.captureError).toHaveBeenCalledWith(failure, {
      action: "exportSnippets",
    });
    unmount();

    mocks.exportSnippets.mockRejectedValueOnce("unknown failure");
    renderPanel();
    fireEvent.click(screen.getByTestId("export-json"));
    await waitFor(() =>
      expect(screen.getByTestId("feedback-banner")).toHaveTextContent(
        i18n.t("options.errors.failedExport")
      )
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      i18n.t("options.errors.failedExport")
    );
  });

  it("advertises every parser format, with and without an icon", () => {
    renderPanel();

    const formats = screen.getByTestId("import-formats");
    expect(formats).toHaveTextContent("Clipio");
    expect(formats).toHaveTextContent("Plain text");
    expect(formats.querySelector('img[src="/clipio.png"]')).toBeInTheDocument();
    expect(formats.querySelectorAll("img")).toHaveLength(1);
    expect(document.getElementById("import-anchor")).toBeInTheDocument();
  });

  it("opens the import wizard and returns focus to the trigger on close", async () => {
    renderPanel();
    const openButton = screen.getByTestId("import-open");

    fireEvent.click(openButton);
    expect(await screen.findByTestId("mock-import-wizard")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "close wizard" }));
    expect(screen.queryByTestId("mock-import-wizard")).not.toBeInTheDocument();
    expect(openButton).toHaveFocus();
  });

  it("confirms a completed import beside the import control, not in the shell banner", async () => {
    renderPanel();
    expect(screen.queryByTestId("import-confirmation")).toBeNull();

    fireEvent.click(screen.getByTestId("import-open"));
    fireEvent.click(
      await screen.findByRole("button", { name: "complete wizard" })
    );

    const message = i18n.t("options.importExport.importCard.successMessage", 3);
    const confirmation = screen.getByTestId("import-confirmation");
    expect(confirmation).toHaveTextContent(message);
    expect(confirmation.className).toContain("font-normal");
    expect(
      screen.getByTestId("import-open").parentElement?.parentElement
    ).toHaveTextContent(message);
    expect(screen.getByRole("status")).toHaveTextContent(message);
    // Success is local to the control: no shell-wide banner to carry into the
    // next settings section.
    expect(screen.queryByTestId("feedback-banner")).toBeNull();
    expect(screen.queryByTestId("mock-import-wizard")).not.toBeInTheDocument();
  });
});
