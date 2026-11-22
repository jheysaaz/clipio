/**
 * LibraryPanel turns storage reads into a count and a usage list, and routes
 * export/import outcomes to the right toast. Those are the decisions tested
 * here; the importer and exporter themselves have their own suites.
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
  toast: { success: vi.fn(), error: vi.fn() },
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
vi.mock("sonner", () => ({ toast: mocks.toast }));
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

import { LibraryPanel } from "./LibraryPanel";

beforeEach(() => {
  mocks.getSnippets.mockReset().mockResolvedValue([]);
  mocks.exportSnippets.mockReset().mockResolvedValue(undefined);
  mocks.snippetsContainMedia.mockReset().mockReturnValue(false);
  mocks.usageCountsItem.getValue.mockReset().mockResolvedValue({});
  mocks.captureError.mockReset();
  mocks.toast.success.mockReset();
  mocks.toast.error.mockReset();
});

describe("LibraryPanel", () => {
  it("renders the snippet count and a usage list sorted and labelled", async () => {
    mocks.getSnippets.mockResolvedValue([
      { id: "a", label: "Greeting", shortcut: "/g" },
      { id: "b", label: "", shortcut: "/b" },
    ]);
    mocks.usageCountsItem.getValue.mockResolvedValue({
      a: 5,
      missing: 2,
      b: 1,
    });

    render(<LibraryPanel />);

    await waitFor(() =>
      expect(screen.getByTestId("card-top-usage")).not.toHaveTextContent(
        i18n.t("options.copy.topUsageEmpty")
      )
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Greeting");
    expect(rows[0]).toHaveTextContent("/g");
    expect(rows[1]).toHaveTextContent("missing");
    expect(rows[2]).toHaveTextContent("/b");
    expect(rows[0]).toHaveTextContent(i18n.t("options.library.uses", ["5"]));
  });

  it("keeps stable empty-state handles while loading has not settled", () => {
    render(<LibraryPanel />);

    expect(screen.getByTestId("card-top-usage")).toContainElement(
      screen.getByTestId("top-usage-empty")
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("captures a failed library read instead of leaving the panel blank", async () => {
    const failure = new Error("storage down");
    mocks.getSnippets.mockRejectedValue(failure);

    render(<LibraryPanel />);

    await waitFor(() =>
      expect(mocks.captureError).toHaveBeenCalledWith(failure, {
        action: "libraryPanel.load",
      })
    );
  });

  it("changes the export toast when snippets contain media", async () => {
    mocks.getSnippets.mockResolvedValue([{ id: "a", label: "A" }]);
    const { unmount } = render(<LibraryPanel />);

    fireEvent.click(screen.getByTestId("export-json"));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        i18n.t("options.library.exported")
      )
    );
    unmount();

    mocks.snippetsContainMedia.mockReturnValue(true);
    render(<LibraryPanel />);
    fireEvent.click(screen.getByTestId("export-json"));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        i18n.t("options.library.exportedWithMedia")
      )
    );
  });

  it("reports the original error on export failure and a fallback for non-errors", async () => {
    const failure = new Error("disk full");
    mocks.exportSnippets.mockRejectedValueOnce(failure);
    const { unmount } = render(<LibraryPanel />);

    fireEvent.click(screen.getByTestId("export-json"));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("disk full")
    );
    expect(mocks.captureError).toHaveBeenCalledWith(failure, {
      action: "exportSnippets",
    });
    unmount();

    mocks.exportSnippets.mockRejectedValueOnce("unknown failure");
    render(<LibraryPanel />);
    fireEvent.click(screen.getByTestId("export-json"));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        i18n.t("options.errors.failedExport")
      )
    );
  });

  it("advertises every parser format, with and without an icon", () => {
    render(<LibraryPanel />);

    const formats = screen.getByTestId("import-formats");
    expect(formats).toHaveTextContent("Clipio");
    expect(formats).toHaveTextContent("Plain text");
    expect(formats.querySelector('img[src="/clipio.png"]')).toBeInTheDocument();
    expect(formats.querySelectorAll("img")).toHaveLength(1);
    expect(document.getElementById("import-anchor")).toBeInTheDocument();
  });

  it("opens the import wizard and returns focus to the trigger on close", async () => {
    render(<LibraryPanel />);
    const openButton = screen.getByTestId("import-open");

    fireEvent.click(openButton);
    expect(await screen.findByTestId("mock-import-wizard")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "close wizard" }));
    expect(screen.queryByTestId("mock-import-wizard")).not.toBeInTheDocument();
    expect(openButton).toHaveFocus();
  });

  it("announces a completed import and closes the wizard", async () => {
    render(<LibraryPanel />);

    fireEvent.click(screen.getByTestId("import-open"));
    fireEvent.click(
      await screen.findByRole("button", { name: "complete wizard" })
    );

    expect(mocks.toast.success).toHaveBeenCalledWith(
      i18n.t("options.importExport.importCard.successMessage", 3)
    );
    expect(screen.queryByTestId("mock-import-wizard")).not.toBeInTheDocument();
  });
});
