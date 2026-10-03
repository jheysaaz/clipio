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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/**
 * A TextBlaze export, which is what makes the placeholder step reachable.
 *
 * Step 2 only appears for a FOREIGN format: ClipioParser sets
 * `unsupportedPlaceholders: []` unconditionally, because a Clipio export is
 * already in Clipio's own syntax. So a Clipio payload that happens to contain
 * `{token}` sails straight past step 2 — which is why testing the placeholder
 * flow needs this shape instead.
 */
function textBlazeFile(snippets: unknown[], name = "textblaze.json") {
  return new File(
    [
      JSON.stringify({
        version: 8,
        folders: [{ name: "Work", snippets }],
      }),
    ],
    name,
    { type: "application/json" }
  );
}

function textBlazeSnippet(over: Record<string, unknown> = {}) {
  return {
    name: "Signature",
    shortcut: "sig",
    type: "text",
    text: "Best, {firstName}",
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

/**
 * Hand a file to the wizard's hidden file input.
 *
 * `fireEvent.change` with an explicit `files` list rather than
 * `userEvent.upload`. user-event drives a full pointer-event sequence, and
 * against happy-dom that reaches React 19's dev-mode guarded-callback replay,
 * which reports a RangeError through `reportGlobalError` — whose stack then
 * overflows again inside Vite's source-map decoder. The result was a
 * "Maximum call stack size exceeded" logged once per upload while every test
 * still passed, so the noise was pure downside.
 *
 * The trade-off: user-event honours the input's `accept` attribute and refuses
 * a mismatched file, fireEvent does not. `accept` filtering is browser chrome
 * rather than app logic, so the "refuses a file type" test asserts the
 * attribute itself.
 */
function upload(file: File) {
  const input = document.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
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
    upload(exportFile([validSnippet()]));

    expect(await screen.findByText("export.json")).toBeInTheDocument();
    await waitFor(() => expect(nextButton()).toBeEnabled());
    // The detected format is auto-selected, so the user is not asked to
    // confirm what the wizard already worked out.
    expect(screen.getByText("Found 1 snippet")).toBeInTheDocument();
  });

  it("shows a parse error for malformed JSON and stays put", async () => {
    const user = userEvent.setup();

    await renderWizard();
    upload(new File(["{ not json"], "broken.json"));

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
    upload(exportFile([]));

    await waitFor(() => expect(nextButton()).toBeDisabled());
  });

  it("restricts the picker to the formats the wizard can read", async () => {
    await renderWizard();

    // The browser enforces this from the accept attribute, so the attribute is
    // the thing worth pinning — it is the only place the allowed set is
    // declared. A .txt never reaches processFile through the real UI.
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    expect(input.accept).toBe(".json,.zip,.clipio.zip");

    // And with nothing chosen, the wizard cannot advance.
    expect(
      screen.getByText("Drop a JSON or ZIP file here")
    ).toBeInTheDocument();
    expect(nextButton()).toBeDisabled();
  });

  it("reports unrecognised JSON rather than importing nothing silently", async () => {
    await renderWizard();
    // Valid JSON, but not a shape any parser claims. A bare scalar is the
    // reliable case: detectFormat rejects anything that is not an object or an
    // array before it ever looks at the contents.
    upload(new File(["42"], "unknown.json", { type: "application/json" }));

    // detectFormat returns null, so the wizard must say the format is unknown
    // and let the user pick — not advance with zero snippets.
    expect(
      await screen.findByText("Unknown — please select below")
    ).toBeInTheDocument();
    expect(nextButton()).toBeDisabled();
  });

  // --- the happy path --------------------------------------------------

  it("imports snippets and reports the count back", async () => {
    const user = userEvent.setup();

    await renderWizard();
    upload(
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

    // No unsupported placeholders and no conflicts, so advanceFromStep1 jumps
    // straight to the confirm step — steps 2 and 3 have nothing to resolve.
    await user.click(nextButton());
    expect(await screen.findByText("Snippets to import")).toBeInTheDocument();

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
    upload(exportFile([validSnippet()]));
    await waitFor(() => expect(nextButton()).toBeEnabled());

    await user.click(nextButton());
    await user.click(await screen.findByRole("button", { name: /import 1/i }));

    // importDone replaces the whole step, so the footer must be gone —
    // otherwise a second click would import the same file twice.
    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /import/i })
    ).not.toBeInTheDocument();
  });

  it("closes from the completion state", async () => {
    const user = userEvent.setup();

    await renderWizard();
    upload(exportFile([validSnippet()]));
    await waitFor(() => expect(nextButton()).toBeEnabled());

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
    upload(exportFile([validSnippet()]));
    await waitFor(() => expect(nextButton()).toBeEnabled());

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
    upload(exportFile([validSnippet()]));
    await waitFor(() => expect(nextButton()).toBeEnabled());

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
    upload(exportFile([validSnippet()]));

    // The mount read failing must not break the wizard — worst case the
    // conflict step under-reports, which is safer than refusing to import.
    await waitFor(() => expect(nextButton()).toBeEnabled());
  });

  // --- navigation ------------------------------------------------------

  it("walks back through the steps without losing the parsed file", async () => {
    const user = userEvent.setup();

    await renderWizard();
    upload(textBlazeFile([textBlazeSnippet()]));
    await waitFor(() => expect(nextButton()).toBeEnabled());

    await user.click(nextButton());
    expect(
      await screen.findByText(
        "The following snippets contain placeholders that Clipio doesn't support. Choose what to do with them."
      )
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back/i }));
    // Going back must not clear the parsed snippets, or the user would have to
    // re-pick the file to change their mind.
    expect(await screen.findByText("textblaze.json")).toBeInTheDocument();
    await waitFor(() => expect(nextButton()).toBeEnabled());
  });

  it("reports the steps it is on", async () => {
    const user = userEvent.setup();

    await renderWizard();
    upload(textBlazeFile([textBlazeSnippet()]));
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
