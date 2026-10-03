/**
 * Conflict resolution and placeholder decisions — steps 2 and 3.
 *
 * Separate from ImportWizard.test.tsx, which covers the walk-through and the
 * failure paths. This file covers the two steps where the user makes decisions
 * that decide whether existing data survives, so the assertions are about what
 * actually reaches bulkSaveSnippets rather than about what the screen says.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ImportWizard from "./ImportWizard";

const bulkSaveSnippets = vi.fn();

/** Mutable so each test can choose what is already stored. */
let storedSnippets: unknown[] = [];

vi.mock("@/storage", () => ({
  getSnippets: vi.fn(async () => storedSnippets),
  getStorageStatus: vi.fn().mockResolvedValue({ mode: "sync" }),
  bulkSaveSnippets: (...a: unknown[]) => bulkSaveSnippets(...a),
}));

vi.mock("@/storage/backends/media", () => ({
  restoreMediaEntry: vi.fn(),
}));

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

function uploadJson(payload: unknown, name = "export.json") {
  const input = document.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: [
      new File([JSON.stringify(payload)], name, { type: "application/json" }),
    ],
    configurable: true,
  });
  fireEvent.change(input);
}

async function renderWizard() {
  const result = render(
    <ImportWizard onClose={vi.fn()} onImportComplete={onImportComplete} />
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^next$/i })).toBeInTheDocument()
  );
  return result;
}

const STEP2_HEADING =
  "The following snippets contain placeholders that Clipio doesn't support. Choose what to do with them.";

/**
 * The conflict step's heading.
 *
 * Spelled out rather than regexed because the locale uses two plural forms and
 * the verb agrees with the count: "1 snippet conflicts" but
 * "2 snippets conflict". Getting that wrong makes the assertion fail on a
 * string that is actually correct.
 */
function step3Heading(count: number) {
  return count === 1
    ? "1 snippet conflicts with your existing library. Choose how to resolve each one."
    : `${count} snippets conflict with your existing library. Choose how to resolve each one.`;
}

/** Click Next, waiting for it to be enabled and for the new step to render. */
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

/** Open the Nth combobox and choose `optionName` from its listbox. */
async function chooseOption(
  user: ReturnType<typeof userEvent.setup>,
  index: number,
  optionName: string | RegExp
) {
  // Wait for the step's selects to exist before indexing into them; the step
  // renders asynchronously behind the Next click.
  const combos = await screen.findAllByRole("combobox");
  await user.click(combos[index]!);
  const option = await screen.findByRole("option", { name: optionName });
  await user.click(option);
}

describe("ImportWizard — conflict resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedSnippets = [stored()];
    bulkSaveSnippets.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("detects a collision and shows both sides of it", async () => {
    await renderWizard();
    uploadJson({
      format: "clipio",
      snippets: [stored({ label: "Greeting", content: "new content" })],
    });

    const user = userEvent.setup();
    await clickNext(user, step3Heading(1));

    // Both columns must be visible, or the user is asked to overwrite
    // something they cannot see.
    expect(screen.getByText("Greeting")).toBeInTheDocument();
    expect(screen.getByText("Stored")).toBeInTheDocument();
    expect(screen.getByText("Existing (both conflict)")).toBeInTheDocument();
  });

  it("defaults to skipping, so the stored snippet survives untouched", async () => {
    await renderWizard();
    uploadJson({
      format: "clipio",
      snippets: [stored({ label: "Greeting", content: "new content" })],
    });

    const user = userEvent.setup();
    await clickNext(user, step3Heading(1));
    await clickNext(user);

    // Skip is the default resolution, so nothing is queued and the import
    // button is disabled. The stored snippet is protected by that: no write is
    // attempted at all, rather than a write that happens to exclude it.
    expect(
      screen.getByRole("button", { name: /import 0 snippets/i })
    ).toBeDisabled();
    expect(bulkSaveSnippets).not.toHaveBeenCalled();
  });

  it("disables the import button when every conflict is skipped", async () => {
    await renderWizard();
    uploadJson({ format: "clipio", snippets: [stored({ label: "Greeting" })] });

    const user = userEvent.setup();
    await clickNext(user, step3Heading(1));
    await clickNext(user);

    // Zero snippets to add, so the import button must be disabled — otherwise
    // the user clicks "Import 0 snippets" and gets a success message for
    // nothing.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /import 0 snippets/i })
      ).toBeDisabled()
    );
  });

  it("overwrites the stored snippet when the user chooses overwrite", async () => {
    await renderWizard();
    uploadJson({
      format: "clipio",
      snippets: [stored({ label: "Greeting", content: "new content" })],
    });

    const user = userEvent.setup();
    await clickNext(user, step3Heading(1));
    await chooseOption(user, 1, /overwrite/i);
    await clickNext(user);

    await user.click(
      await screen.findByRole("button", { name: /import 1 snippet/i })
    );
    await waitFor(() => expect(bulkSaveSnippets).toHaveBeenCalled());

    // Exactly one snippet, carrying the incoming content. A missed removal here
    // leaves two entries with the same id and the overwrite looks like it did
    // nothing.
    const written = bulkSaveSnippets.mock.calls[0]![0] as unknown[];
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      id: STORED_ID,
      label: "Greeting",
      content: "new content",
    });
  });

  it("imports alongside when the user chooses rename, keeping the stored one", async () => {
    await renderWizard();
    uploadJson({
      format: "clipio",
      snippets: [stored({ label: "Greeting", content: "new content" })],
    });

    const user = userEvent.setup();
    await clickNext(user, step3Heading(1));
    await chooseOption(user, 1, /new shortcut|rename/i);

    // Choosing rename reveals an editable shortcut, pre-filled with a free one.
    expect(await screen.findByDisplayValue("/greet_2")).toBeInTheDocument();

    await clickNext(user);
    // The button counts snippets being ADDED, so it says 1 even though the
    // write will contain 2 — the stored one is not an import.
    await user.click(
      await screen.findByRole("button", { name: /import 1 snippet/i })
    );

    await waitFor(() => expect(bulkSaveSnippets).toHaveBeenCalled());
    const written = bulkSaveSnippets.mock.calls[0]![0] as Array<{
      label: string;
      shortcut: string;
    }>;
    // Both survive, on different triggers.
    expect(written).toHaveLength(2);
    expect(written.map((s) => s.shortcut).sort()).toEqual([
      "/greet",
      "/greet_2",
    ]);
  });

  it("applies a bulk resolution to every conflict at once", async () => {
    await renderWizard();
    uploadJson({
      format: "clipio",
      snippets: [
        stored({ label: "First" }),
        stored({ id: "bbbbbbbb-2222-4222-8222-222222222222", label: "Second" }),
      ],
    });

    const user = userEvent.setup();
    await clickNext(user, step3Heading(2));
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();

    // Combobox 0 is "Resolve all". After choosing overwrite, the confirm step
    // must count two imports — if the bulk choice did not reach the individual
    // rows, both would still be skipped and the count would be 0.
    await chooseOption(user, 0, /overwrite/i);
    await clickNext(user);
    expect(
      await screen.findByRole("button", { name: /import 2 snippets/i })
    ).toBeEnabled();
  });
});

describe("ImportWizard — placeholder decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedSnippets = [];
    bulkSaveSnippets.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function textBlaze(text: string) {
    return {
      version: 8,
      folders: [
        {
          name: "Work",
          snippets: [
            { name: "Signature", shortcut: "sig", type: "text", text },
          ],
        },
      ],
    };
  }

  it("lists the unsupported placeholder it found", async () => {
    await renderWizard();
    uploadJson(textBlaze("Best, {firstName}"), "textblaze.json");

    const user = userEvent.setup();
    await clickNext(user, STEP2_HEADING);

    expect(screen.getByText("{firstName}")).toBeInTheDocument();
    expect(screen.getByText("Signature")).toBeInTheDocument();
  });

  it("keeps the placeholder as literal text by default", async () => {
    await renderWizard();
    uploadJson(textBlaze("Best, {firstName}"), "textblaze.json");

    const user = userEvent.setup();
    await clickNext(user, STEP2_HEADING);
    await clickNext(user);
    await user.click(
      await screen.findByRole("button", { name: /import 1 snippet/i })
    );

    await waitFor(() => expect(bulkSaveSnippets).toHaveBeenCalled());
    // "keep" is the default resolution, so the token is left in the content
    // rather than silently deleted from the user's snippet.
    expect(bulkSaveSnippets.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ content: "Best, {firstName}" }),
    ]);
  });

  it("strips the token when the user chooses remove", async () => {
    await renderWizard();
    uploadJson(textBlaze("Best, {firstName}"), "textblaze.json");

    const user = userEvent.setup();
    await clickNext(user, STEP2_HEADING);
    // Combobox 1 is the per-snippet action.
    await chooseOption(user, 1, /remove/i);
    await clickNext(user);
    await user.click(
      await screen.findByRole("button", { name: /import 1 snippet/i })
    );

    await waitFor(() => expect(bulkSaveSnippets).toHaveBeenCalled());
    expect(bulkSaveSnippets.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ content: "Best, " }),
    ]);
  });

  it("imports nothing when the user chooses skip", async () => {
    await renderWizard();
    uploadJson(textBlaze("Best, {firstName}"), "textblaze.json");

    const user = userEvent.setup();
    await clickNext(user, STEP2_HEADING);
    await chooseOption(user, 1, /skip/i);
    await clickNext(user);

    // A skipped snippet leaves nothing to import, so the button must be
    // disabled rather than reporting "Imported 0 snippets".
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /import 0 snippets/i })
      ).toBeDisabled()
    );
  });

  it("applies a bulk action to every listed snippet", async () => {
    await renderWizard();
    uploadJson(
      {
        version: 8,
        folders: [
          {
            name: "Work",
            snippets: [
              { name: "One", shortcut: "one", type: "text", text: "Hi {a}" },
              { name: "Two", shortcut: "two", type: "text", text: "Bye {b}" },
            ],
          },
        ],
      },
      "textblaze.json"
    );

    const user = userEvent.setup();
    await clickNext(user, STEP2_HEADING);
    expect(screen.getByText("{a}")).toBeInTheDocument();
    expect(screen.getByText("{b}")).toBeInTheDocument();
    // Combobox 0 is "Apply to all".
    await chooseOption(user, 0, /remove/i);
    await clickNext(user);
    await user.click(
      await screen.findByRole("button", { name: /import 2 snippets/i })
    );

    await waitFor(() => expect(bulkSaveSnippets).toHaveBeenCalled());
    const written = bulkSaveSnippets.mock.calls[0]![0] as Array<{
      content: string;
    }>;
    expect(written.map((s) => s.content)).toEqual(["Hi ", "Bye "]);
  });
});
