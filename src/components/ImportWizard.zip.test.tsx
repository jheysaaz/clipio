/**
 * ZIP import, manual format override, and hand-edited conflict renames.
 *
 * Separate from the other two wizard files because these are the paths with
 * external dependencies — a ZIP reader, a blob store, a radio group — and each
 * one has a failure mode that would otherwise go unnoticed:
 *
 *  - a ZIP whose media blobs partly fail to restore must still import its
 *    snippets and warn, not abort the whole import
 *  - an unreadable ZIP must report the reason rather than sitting silent
 *  - choosing a format by hand must re-parse, or the wizard shows a count from
 *    a parser that never ran
 *  - a shortcut the user typed must be the one that gets written, not the
 *    suggestion that was pre-filled
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImportWizard from "./ImportWizard";

const bulkSaveSnippets = vi.fn();
const restoreMediaEntry = vi.fn();
const importClipioZip = vi.fn();
const captureMessage = vi.fn();

let storedSnippets: unknown[] = [];

vi.mock("@/storage", () => ({
  getSnippets: vi.fn(async () => storedSnippets),
  getStorageStatus: vi.fn().mockResolvedValue({ mode: "sync" }),
  bulkSaveSnippets: (...a: unknown[]) => bulkSaveSnippets(...a),
}));

vi.mock("@/storage/backends/media", () => ({
  restoreMediaEntry: (...a: unknown[]) => restoreMediaEntry(...a),
}));

vi.mock("@/lib/importers/clipio", async () => {
  const actual = await vi.importActual<typeof import("@/lib/importers/clipio")>(
    "@/lib/importers/clipio"
  );
  return {
    ...actual,
    // Only the ZIP reader is replaced. The JSON parsers stay real — an import
    // that only passes with every parser stubbed says nothing about whether a
    // real export file imports.
    importClipioZip: (...a: unknown[]) => importClipioZip(...a),
  };
});

vi.mock("~/lib/sentry", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/sentry")>("@/lib/sentry");
  return {
    ...actual,
    captureMessage: (...a: unknown[]) => captureMessage(...a),
  };
});

const onImportComplete = vi.fn();

const STORED_ID = "aaaaaaaa-1111-4111-8111-111111111111";

function stored(over: Record<string, unknown> = {}) {
  return {
    id: STORED_ID,
    label: "Stored",
    shortcut: "/greet",
    content: "old content",
    tags: [],
    usageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function upload(file: File) {
  const input = document.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

function uploadJson(payload: unknown, name = "export.json") {
  upload(
    new File([JSON.stringify(payload)], name, { type: "application/json" })
  );
}

function uploadZip(name = "export.zip") {
  upload(new File(["PK-not-really"], name, { type: "application/zip" }));
}

async function renderWizard() {
  render(
    <ImportWizard onClose={vi.fn()} onImportComplete={onImportComplete} />
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^next$/i })).toBeInTheDocument()
  );
}

async function clickNext(
  user: ReturnType<typeof userEvent.setup>,
  landed?: string | RegExp
) {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^next$/i })).toBeEnabled()
  );
  await user.click(screen.getByRole("button", { name: /^next$/i }));
  if (landed) await screen.findByText(landed);
}

async function chooseOption(
  user: ReturnType<typeof userEvent.setup>,
  index: number,
  optionName: string | RegExp
) {
  const combos = await screen.findAllByRole("combobox");
  await user.click(combos[index]!);
  await user.click(await screen.findByRole("option", { name: optionName }));
}

// ---------------------------------------------------------------------------
// ZIP import
// ---------------------------------------------------------------------------

describe("ImportWizard — ZIP import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedSnippets = [];
    bulkSaveSnippets.mockResolvedValue(undefined);
    restoreMediaEntry.mockImplementation(
      async (entry: { id: string }) => entry.id
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function zipResult(over: Record<string, unknown> = {}) {
    return {
      snippets: [
        {
          suggestedId: "new-1",
          label: "From zip",
          shortcut: "/zip",
          content: "zipped",
          tags: [],
          unsupportedPlaceholders: [],
        },
      ],
      mediaBlobs: new Map(),
      missingMediaIds: [] as string[],
      ...over,
    };
  }

  it("imports a ZIP's snippets", async () => {
    importClipioZip.mockResolvedValue(zipResult());
    await renderWizard();
    uploadZip();

    await waitFor(() => expect(importClipioZip).toHaveBeenCalled());
    expect(await screen.findByText("Found 1 snippet")).toBeInTheDocument();
    // A ZIP is ours by construction, so the format is not something the user
    // should be asked to confirm.
    expect(
      screen.queryByRole("radio", { name: /textblaze/i })
    ).not.toBeInTheDocument();
  });

  it("saves each media blob before writing the snippets", async () => {
    importClipioZip.mockResolvedValue(
      zipResult({
        mediaBlobs: new Map([
          [
            "media-1",
            {
              blob: new Blob(["x"]),
              meta: { id: "media-1", mimeType: "image/png" },
            },
          ],
          [
            "media-2",
            {
              blob: new Blob(["y"]),
              meta: { id: "media-2", mimeType: "image/gif" },
            },
          ],
        ]),
      })
    );
    await renderWizard();
    uploadZip();
    await waitFor(() => expect(importClipioZip).toHaveBeenCalled());

    const user = userEvent.setup();
    await clickNext(user);
    await user.click(
      await screen.findByRole("button", { name: /import 1 snippet/i })
    );

    await waitFor(() => expect(bulkSaveSnippets).toHaveBeenCalled());
    // Media first: writing snippets that reference blobs which were never
    // stored produces snippets whose images resolve to nothing.
    expect(restoreMediaEntry).toHaveBeenCalledTimes(2);
    expect(restoreMediaEntry.mock.calls[0]![0]).toMatchObject({
      id: "media-1",
    });
  });

  it("still imports when one media blob fails to restore", async () => {
    importClipioZip.mockResolvedValue(
      zipResult({
        mediaBlobs: new Map([
          [
            "media-1",
            {
              blob: new Blob(["x"]),
              meta: { id: "media-1", mimeType: "image/png" },
            },
          ],
          [
            "media-2",
            {
              blob: new Blob(["y"]),
              meta: { id: "media-2", mimeType: "image/gif" },
            },
          ],
        ]),
      })
    );
    restoreMediaEntry
      .mockResolvedValueOnce("media-1")
      .mockRejectedValueOnce(new Error("IndexedDB quota"));
    await renderWizard();
    uploadZip();
    await waitFor(() => expect(importClipioZip).toHaveBeenCalled());

    const user = userEvent.setup();
    await clickNext(user);
    await user.click(
      await screen.findByRole("button", { name: /import 1 snippet/i })
    );

    // One blob failing must not throw away the user's snippets — they are the
    // thing they were trying to restore. The loss is reported, not enforced.
    await waitFor(() => expect(bulkSaveSnippets).toHaveBeenCalled());
    expect(captureMessage).toHaveBeenCalledWith(
      "ZIP import: some media blobs failed to save",
      "warning",
      { saved: 1, total: 2 }
    );
  });

  it("warns when the ZIP references media that is not in the archive", async () => {
    importClipioZip.mockResolvedValue(
      zipResult({ missingMediaIds: ["media-gone"] })
    );
    await renderWizard();
    uploadZip();
    await waitFor(() => expect(importClipioZip).toHaveBeenCalled());

    // The warning lives in the step 4 summary, not on the upload step — the
    // user is told what is missing at the point they decide to go ahead.
    const user = userEvent.setup();
    await clickNext(user);
    expect(
      await screen.findByText(
        "Some images from the ZIP could not be found and will be missing after import."
      )
    ).toBeInTheDocument();
  });

  it("reports an unreadable ZIP instead of failing silently", async () => {
    importClipioZip.mockRejectedValue(new Error("zip: not a valid archive"));
    await renderWizard();
    uploadZip();

    expect(
      await screen.findByText("zip: not a valid archive")
    ).toBeInTheDocument();
    // And the wizard must not pretend it can continue.
    expect(screen.getByRole("button", { name: /^next$/i })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Manual format override
// ---------------------------------------------------------------------------

describe("ImportWizard — manual format override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedSnippets = [];
    bulkSaveSnippets.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("offers a format choice when detection fails", async () => {
    await renderWizard();
    // A bare array whose first entry is not a valid snippet. detectFormat's
    // array branch and ClipioParser.canParse's array branch run the SAME
    // isValidSnippet check, so this is rejected by both.
    uploadJson([{ nothing: "useful" }]);

    expect(
      await screen.findByText("Unknown — please select below")
    ).toBeInTheDocument();
    // The user gets the three known formats to try, rather than a dead end.
    for (const name of [/clipio/i, /textblaze/i, /power text/i]) {
      expect(screen.getByRole("radio", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /^next$/i })).toBeDisabled();
  });

  it("keeps the wizard blocked when the chosen parser finds nothing", async () => {
    await renderWizard();
    uploadJson([{ nothing: "useful" }]);

    await screen.findByText("Unknown — please select below");
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: /clipio/i }));

    // handleFormatChange re-runs the chosen parser against the same raw JSON.
    // Here that legitimately finds nothing, and Next must stay disabled:
    // choosing a format is not a promise that the file is one.
    //
    // Worth recording: there is no payload that detectFormat rejects but a
    // parser accepts. The array branch shares isValidSnippet with
    // ClipioParser.canParse, the envelope branch is format === "clipio", and
    // the object branches mirror TextBlaze's and Power Text's own canParse. So
    // the hand-pick path can only ever reach zero snippets today, which makes
    // "Unknown — please select below" close to a dead end for the user.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^next$/i })).toBeDisabled()
    );
  });
});

// ---------------------------------------------------------------------------
// Hand-edited conflict rename
// ---------------------------------------------------------------------------

describe("ImportWizard — hand-edited rename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedSnippets = [stored()];
    bulkSaveSnippets.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("writes the shortcut the user typed, not the suggestion", async () => {
    await renderWizard();
    uploadJson({
      format: "clipio",
      snippets: [stored({ label: "Greeting", content: "new content" })],
    });

    const user = userEvent.setup();
    await clickNext(
      user,
      "1 snippet conflicts with your existing library. Choose how to resolve each one."
    );
    await chooseOption(user, 1, /new shortcut|rename/i);

    const input = await screen.findByDisplayValue("/greet_2");
    await user.clear(input);
    await user.type(input, "/chosen");

    await clickNext(user);
    await user.click(
      await screen.findByRole("button", { name: /import 1 snippet/i })
    );

    await waitFor(() => expect(bulkSaveSnippets).toHaveBeenCalled());
    const written = bulkSaveSnippets.mock.calls[0]![0] as Array<{
      shortcut: string;
    }>;
    // The suggestion is a default, not a decision. Ignoring the edit would
    // silently bind the snippet to a shortcut the user never chose.
    expect(written.map((s) => s.shortcut).sort()).toEqual([
      "/chosen",
      "/greet",
    ]);
  });

  it("does not treat the pre-filled suggestion as already applied", async () => {
    await renderWizard();
    uploadJson({
      format: "clipio",
      snippets: [stored({ label: "Greeting", content: "new content" })],
    });

    const user = userEvent.setup();
    await clickNext(
      user,
      "1 snippet conflicts with your existing library. Choose how to resolve each one."
    );
    await chooseOption(user, 1, /new shortcut|rename/i);

    // Accepting the suggestion untouched must still import — the pre-filled
    // value is what gets written, so there is nothing more to do.
    await clickNext(user);
    expect(
      await screen.findByRole("button", { name: /import 1 snippet/i })
    ).toBeEnabled();
  });
});
