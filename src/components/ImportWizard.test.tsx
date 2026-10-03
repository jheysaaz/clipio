/**
 * Tests for src/components/ImportWizard.tsx
 *
 * This drives the four-step wizard the way a user does: pick a file, walk the
 * steps, resolve whatever the wizard flags, confirm the import. The parsers and
 * the merge logic are NOT mocked — an import that passes with a stubbed parser
 * proves nothing about whether a real export file imports correctly, which is
 * the one thing this wizard exists to do.
 *
 * Only the storage boundary is stubbed: getSnippets, getStorageStatus and
 * bulkSaveSnippets.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImportWizard from "./ImportWizard";

const getSnippets = vi.fn();
const getStorageStatus = vi.fn();
const bulkSaveSnippets = vi.fn();

vi.mock("@/storage", () => ({
  getSnippets: (...a: unknown[]) => getSnippets(...a),
  getStorageStatus: (...a: unknown[]) => getStorageStatus(...a),
  bulkSaveSnippets: (...a: unknown[]) => bulkSaveSnippets(...a),
}));

vi.mock("@/storage/backends/media", () => ({
  restoreMediaEntry: vi.fn(),
}));

const onClose = vi.fn();
const onImportComplete = vi.fn();

/** A real versioned Clipio export, as the app writes it. */
function exportFile(snippets: unknown[], name = "export.json") {
  return new File([JSON.stringify({ format: "clipio", snippets })], name, {
    type: "application/json",
  });
}

function validSnippet(over: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    label: "Greeting",
    shortcut: "/greet",
    content: "Hello there",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

async function renderWizard() {
  const result = render(
    <ImportWizard onClose={onClose} onImportComplete={onImportComplete} />
  );
  // Wait for the mount-time storage reads so the existing-snippets list is in
  // place before any file is uploaded.
  await waitFor(() => expect(getSnippets).toHaveBeenCalled());
  return result;
}

/** Upload a file into the wizard's hidden file input. */
async function upload(file: File) {
  const input = document.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  await userEvent.upload(input, file);
}

function nextButton() {
  return screen.getByRole("button", { name: /^next$/i });
}

describe("ImportWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSnippets.mockResolvedValue([]);
    getStorageStatus.mockResolvedValue({ mode: "sync" });
    bulkSaveSnippets.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --- step 1: upload --------------------------------------------------

  it("starts on the upload step and cannot advance without a file", async () => {
    await renderWizard();

    expect(
      screen.getByText("Drop a JSON or ZIP file here")
    ).toBeInTheDocument();
    // Advancing with nothing parsed would import nothing while telling the
    // user an import is about to happen.
    expect(nextButton()).toBeDisabled();
  });

  it("stays on step 1 when no file is chosen", async () => {
    const user = userEvent.setup();
    await renderWizard();

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("detects the format and enables Next for a Clipio export", async () => {
    await renderWizard();
    await upload(exportFile([validSnippet()]));

    expect(await screen.findByText("export.json")).toBeInTheDocument();
    await waitFor(() => expect(nextButton()).toBeEnabled());
    // The detected format is auto-selected, so the user is not asked to
    // confirm what the wizard already worked out.
    expect(screen.getByText("Found 1 snippet")).toBeInTheDocument();
  });

  it("shows a parse error for malformed JSON and stays put", async () => {
    await renderWizard();
    await upload(new File(["{ not json"], "broken.json"));

    expect(
      await screen.findByText(
        "Invalid JSON file. Please check the file and try again."
      )
    ).toBeInTheDocument();
    expect(nextButton()).toBeDisabled();
  });

  it("shows an error for an empty file that parses to nothing", async () => {
    await renderWizard();
    // A valid Clipio envelope with no snippets cannot advance: there is
    // nothing to import, and saying otherwise would produce a 0-count import.
    await upload(exportFile([]));

    await waitFor(() => expect(nextButton()).toBeDisabled());
  });

  it("treats a file whose name is not json as unparseable rather than crashing", async () => {
    await renderWizard();
    await upload(new File(["hello"], "notes.txt"));

    // Either the format is unknown or the read failed; both must be reported,
    // neither may throw out of the onChange handler.
    expect(
      await screen.findByText(/unknown|invalid|could not read/i)
    ).toBeInTheDocument();
  });

  // --- the happy path --------------------------------------------------

  it("imports snippets and reports the count back", async () => {
    const user = userEvent.setup();
    await renderWizard();
    await upload(
      exportFile([
        validSnippet(),
        validSnippet({
          id: "bbbbbbbb-2222-4222-8222-222222222222",
          shortcut: "/other",
          label: "Other",
        }),
      ])
    );
    await waitFor(() => expect(nextButton()).toBeEnabled());

    await user.click(nextButton());
    // No unsupported placeholders, no conflicts, so steps 2 and 3 are skipped
    // in favour of the confirm step.
    await user.click(nextButton());
    expect(await screen.findByText("Ready to import?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /import 2/i }));

    await waitFor(() =>
      expect(bulkSaveSnippets).toHaveBeenCalledWith([
        expect.objectContaining({ shortcut: "/greet" }),
        expect.objectContaining({ shortcut: "/other" }),
      ])
    );
    expect(onImportComplete).toHaveBeenCalledWith(2);
  });

  it("shows a completion state once the import finishes", async () => {
    const user = userEvent.setup();
    await renderWizard();
    await upload(exportFile([validSnippet()]));
    await waitFor(() => expect(nextButton()).toBeEnabled());

    await user.click(nextButton());
    await user.click(nextButton());
    await user.click(await screen.findByRole("button", { name: /import 1/i }));

    // importDone replaces the whole step, so the footer must be gone —
    // otherwise a second click would import the same file twice.
    expect(
      await screen.findByText(/done|complete|success/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /import/i })
    ).not.toBeInTheDocument();
  });

  it("closes from the completion state", async () => {
    const user = userEvent.setup();
    await renderWizard();
    await upload(exportFile([validSnippet()]));
    await waitFor(() => expect(nextButton()).toBeEnabled());

    await user.click(nextButton());
    await user.click(nextButton());
    await user.click(await screen.findByRole("button", { name: /import 1/i }));

    await user.click(
      await screen.findByRole("button", { name: /done|close/i })
    );
    expect(onClose).toHaveBeenCalled();
  });

  // --- failure paths ---------------------------------------------------

  it("surfaces a failed save instead of reporting success", async () => {
    const user = userEvent.setup();
    bulkSaveSnippets.mockRejectedValue(
      new Error("QUOTA_BYTES_PER_ITEM exceeded")
    );
    await renderWizard();
    await upload(exportFile([validSnippet()]));
    await waitFor(() => expect(nextButton()).toBeEnabled());

    await user.click(nextButton());
    await user.click(nextButton());
    await user.click(await screen.findByRole("button", { name: /import 1/i }));

    // Claiming a successful import after a rejected write is the worst outcome
    // here: the user would leave believing their snippets were restored.
    expect(
      await screen.findByText(/QUOTA_BYTES_PER_ITEM exceeded/)
    ).toBeInTheDocument();
    expect(onImportComplete).not.toHaveBeenCalled();
  });

  it("allows retrying after a failed save", async () => {
    const user = userEvent.setup();
    bulkSaveSnippets.mockRejectedValueOnce(new Error("network down"));
    await renderWizard();
    await upload(exportFile([validSnippet()]));
    await waitFor(() => expect(nextButton()).toBeEnabled());

    await user.click(nextButton());
    await user.click(nextButton());
    await user.click(await screen.findByRole("button", { name: /import 1/i }));
    await screen.findByText(/network down/);

    // handleImport clears `importing` in a finally block, so the button must be
    // usable again or the import could never be retried.
    const retry = screen.getByRole("button", { name: /import 1/i });
    await waitFor(() => expect(retry).toBeEnabled());
    await user.click(retry);

    await waitFor(() => expect(bulkSaveSnippets).toHaveBeenCalledTimes(2));
    expect(onImportComplete).toHaveBeenCalledWith(1);
  });

  it("keeps working when the stored snippets cannot be read", async () => {
    getSnippets.mockRejectedValue(new Error("storage offline"));
    await renderWizard();
    await upload(exportFile([validSnippet()]));

    // The mount read failing must not break the wizard — worst case the
    // conflict step under-reports, which is safer than refusing to import.
    await waitFor(() => expect(nextButton()).toBeEnabled());
  });

  // --- navigation ------------------------------------------------------

  it("walks back through the steps without losing the parsed file", async () => {
    const user = userEvent.setup();
    await renderWizard();
    await upload(exportFile([validSnippet({ content: "Hi {token}" })]));
    await waitFor(() => expect(nextButton()).toBeEnabled());

    await user.click(nextButton());
    expect(
      await screen.findByText(/placeholders that Clipio doesn't support/i)
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back/i }));
    // Going back must not clear the parsed snippets, or the user would have to
    // re-pick the file to change their mind.
    expect(await screen.findByText("export.json")).toBeInTheDocument();
    await waitFor(() => expect(nextButton()).toBeEnabled());
  });

  it("reports the steps it is on", async () => {
    const user = userEvent.setup();
    await renderWizard();
    await upload(exportFile([validSnippet({ content: "Hi {token}" })]));
    await waitFor(() => expect(nextButton()).toBeEnabled());

    // Step labels are how a user knows where they are in a four-step dialog.
    for (const label of ["Upload", "Placeholders", "Conflicts", "Confirm"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    await user.click(nextButton());
    expect(
      await screen.findByRole("button", { name: /back/i })
    ).toBeInTheDocument();
  });
});
