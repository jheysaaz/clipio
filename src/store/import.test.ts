import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  advanceFromPlaceholders,
  advanceFromUpload,
  applyUnsupportedChoices,
  canAdvanceFromUpload,
  countImported,
  detectedParserLabel,
  initialiseImport,
  importStore,
  needsPlaceholderStep,
  prefillConflictResolutions,
  previewFinalSnippets,
  resetImport,
  routeAfterPlaceholders,
  routeAfterUpload,
  runImport,
  seedUnsupportedEntries,
  useImport,
  willExceedQuota,
  type ImportState,
  type ZipMediaEntry,
} from "./import";

import { captureMessage } from "@/lib/sentry";
import type { Snippet } from "@/types";
import type { MediaMetadata } from "@/storage/backends/media";
import type { ConflictEntry, ParsedSnippet } from "@/lib/importers/types";

const storage = vi.hoisted(() => ({
  getSnippets: vi.fn(),
  getStorageStatus: vi.fn(),
  bulkSaveSnippets: vi.fn(),
}));

vi.mock("@/storage", () => storage);
vi.mock("@/storage/backends/media", () => ({ restoreMediaEntry: vi.fn() }));
vi.mock("@/lib/sentry", () => ({
  captureError: vi.fn(),
  captureMessage: vi.fn(),
}));

function snippet(overrides: Partial<Snippet> = {}): Snippet {
  return {
    id: "s1",
    label: "First",
    shortcut: "/a",
    content: "content",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function parsed(overrides: Partial<ParsedSnippet> = {}): ParsedSnippet {
  return {
    suggestedId: "p1",
    label: "First",
    shortcut: "/a",
    content: "content",
    unsupportedPlaceholders: [],
    ...overrides,
  } as ParsedSnippet;
}

/** Media metadata as the ZIP importer produces it. */
function meta(id: string): MediaMetadata {
  return {
    id,
    mimeType: "image/png",
    size: 10,
    width: 100,
    height: 100,
    createdAt: "2026-01-01T00:00:00.000Z",
  } as MediaMetadata;
}

/** One entry's worth of ZIP media. */
function zipEntry(id: string): ZipMediaEntry {
  return { blob: new Blob(["x"]), meta: meta(id) };
}

function conflict(overrides: Partial<ConflictEntry> = {}): ConflictEntry {
  return {
    incoming: parsed(),
    existing: snippet(),
    resolution: "overwrite",
    renamedShortcut: "/a-2",
    ...overrides,
  } as ConflictEntry;
}

function state(): ImportState {
  return importStore.state;
}

beforeEach(() => {
  resetImport();
  storage.getSnippets.mockResolvedValue([]);
  storage.getStorageStatus.mockResolvedValue({ mode: "sync" });
  storage.bulkSaveSnippets.mockResolvedValue(undefined);
  vi.mocked(captureMessage).mockClear();
});

// ---------------------------------------------------------------------------

describe("needsPlaceholderStep", () => {
  it("is false when every placeholder was understood", () => {
    expect(
      needsPlaceholderStep([parsed(), parsed({ suggestedId: "p2" })])
    ).toBe(false);
  });

  it("is true when any snippet has an unsupported placeholder", () => {
    const rows = [
      parsed(),
      parsed({
        suggestedId: "p2",
        unsupportedPlaceholders: ["{{foo}}"],
      }),
    ];
    expect(needsPlaceholderStep(rows)).toBe(true);
  });

  it("is false for an empty parse", () => {
    expect(needsPlaceholderStep([])).toBe(false);
  });
});

describe("seedUnsupportedEntries", () => {
  it("lists only the snippets with unsupported placeholders, all defaulting to keep", () => {
    // "Keep" is the non-destructive default, and it is the right one for the
    // failure this step exists to handle: text the importer did not understand is
    // better left as it was than silently deleted.
    const rows = [
      parsed(),
      parsed({
        suggestedId: "p2",
        unsupportedPlaceholders: ["{{foo}}"],
      }),
    ];

    expect(seedUnsupportedEntries(rows)).toEqual([
      { snippet: rows[1], action: "keep" },
    ]);
  });
});

describe("applyUnsupportedChoices", () => {
  it("passes through snippets the user never saw", () => {
    // The negative case with teeth: `applyUnsupportedAction` returning `null`
    // means "this action removes the snippet", not "nothing to do here". A
    // snippet with no unsupported placeholders is not in the entries list at all,
    // so keying only off the entries would lose it.
    const rows = [parsed(), parsed({ suggestedId: "p2" })];
    const out = applyUnsupportedChoices(rows, []);

    expect(out.map((s) => s.suggestedId)).toEqual(["p1", "p2"]);
  });

  it("applies a per-snippet action", () => {
    const rows = [
      parsed({
        suggestedId: "p1",
        unsupportedPlaceholders: ["{{foo}}"],
      }),
    ];

    const out = applyUnsupportedChoices(rows, [
      { snippet: rows[0], action: "remove" },
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].unsupportedPlaceholders).toEqual([]);
    // The row is reported as resolved even though the text was kept as literal —
    // that is what "keep" means, and the wizard must not re-offer the step.
    expect(out[0].content).toBe(rows[0].content);
  });

  it("drops a snippet the user chose to skip entirely", () => {
    const rows = [
      parsed({
        suggestedId: "p1",
        unsupportedPlaceholders: ["{{foo}}"],
      }),
    ];

    const out = applyUnsupportedChoices(rows, [
      { snippet: rows[0], action: "skip" },
    ]);

    expect(out).toHaveLength(0);
  });

  it("matches entries by id, not by position", () => {
    // The step boundary moves rows around; position would apply a choice to the
    // wrong snippet.
    const rows = [
      parsed({ suggestedId: "p1" }),
      parsed({
        suggestedId: "p2",
        unsupportedPlaceholders: ["{{foo}}"],
      }),
    ];

    const out = applyUnsupportedChoices(rows, [
      { snippet: rows[1], action: "remove" },
    ]);

    expect(out.map((s) => s.unsupportedPlaceholders.length)).toEqual([0, 0]);
  });
});

describe("prefillConflictResolutions", () => {
  it("suggests a shortcut for every conflict, not only renames", () => {
    // Every conflict gets one. The previous code computed it in a ternary whose
    // two branches were identical — which read as "only rename gets a
    // suggestion" and was not what it did, so the intent was invisible.
    const incoming = [parsed({ shortcut: "/a" })];
    const existing = [snippet({ id: "e1", shortcut: "/a" })];

    const conflicts = prefillConflictResolutions(incoming, existing);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].renamedShortcut).not.toBe("/a");
  });

  it("suggests a shortcut for an overwrite as well as a rename", () => {
    const incoming = [parsed({ shortcut: "/a" })];
    const existing = [snippet({ id: "e1", shortcut: "/a" })];
    const detected = prefillConflictResolutions(incoming, existing);
    const asOverwrite = detected.map((c) => ({
      ...c,
      resolution: "overwrite" as const,
    }));

    expect(asOverwrite[0].renamedShortcut).toBe(detected[0].renamedShortcut);
  });

  it("returns nothing when there are no conflicts", () => {
    expect(prefillConflictResolutions([parsed()], [])).toEqual([]);
  });
});

describe("routeAfterUpload", () => {
  it("goes to the placeholder step when something was not understood", () => {
    const routing = routeAfterUpload(
      [
        parsed({
          suggestedId: "p1",
          unsupportedPlaceholders: ["{{foo}}"],
        }),
      ],
      []
    );

    expect(routing.kind).toBe("review-placeholders");
  });

  it("goes to the conflict step when a snippet already exists", () => {
    const routing = routeAfterUpload(
      [parsed({ shortcut: "/a" })],
      [snippet({ id: "e1", shortcut: "/a" })]
    );

    expect(routing.kind).toBe("review-conflicts");
  });

  it("goes straight to confirm when there is nothing to review", () => {
    const routing = routeAfterUpload([parsed()], []);
    expect(routing.kind).toBe("confirm");
    // And it carries the list forward, so the caller cannot store a different one.
    expect(routing.snippets).toHaveLength(1);
  });

  it("prefers the placeholder step when both would apply", () => {
    // Placeholders first: resolving them can change the snippet's identity, and
    // detecting conflicts against a snippet that is about to change would show
    // the user rows that then stop existing.
    const routing = routeAfterUpload(
      [
        parsed({
          shortcut: "/a",
          unsupportedPlaceholders: ["{{foo}}"],
        }),
      ],
      [snippet({ id: "e1", shortcut: "/a" })]
    );

    expect(routing.kind).toBe("review-placeholders");
  });
});

describe("routeAfterPlaceholders", () => {
  it("goes to conflicts using the applied snippets", () => {
    // The conflicts must be detected against what the user actually chose, not
    // what was parsed before the step.
    const rows = [
      parsed({
        suggestedId: "p1",
        shortcut: "/a",
        unsupportedPlaceholders: ["{{foo}}"],
      }),
    ];
    const routing = routeAfterPlaceholders(
      rows,
      [{ snippet: rows[0], action: "keep" }],
      [snippet({ id: "e1", shortcut: "/a" })]
    );

    expect(routing.kind).toBe("review-conflicts");
  });

  it("goes to confirm when resolving the placeholders left no conflicts", () => {
    const rows = [
      parsed({
        suggestedId: "p1",
        unsupportedPlaceholders: ["{{foo}}"],
      }),
    ];

    const routing = routeAfterPlaceholders(rows, [], []);
    expect(routing.kind).toBe("confirm");
    expect(routing.snippets).toHaveLength(1);
  });

  it("does not re-offer the placeholder step", () => {
    const rows = [
      parsed({
        suggestedId: "p1",
        unsupportedPlaceholders: ["{{foo}}"],
      }),
    ];

    // Otherwise the wizard would loop back to a step it has already passed.
    expect(routeAfterPlaceholders(rows, [], []).kind).not.toBe(
      "review-placeholders"
    );
  });
});

describe("countImported", () => {
  it("counts every new snippet", () => {
    expect(
      countImported(
        [parsed({ suggestedId: "p1" }), parsed({ suggestedId: "p2" })],
        []
      )
    ).toBe(2);
  });

  it("counts an overwrite on the same id as an import", () => {
    // The regression the e2e caught. When the conflict is on the *id*, an
    // overwrite rewrites that id — so counting "rows whose id is new" returns 0
    // for an import that visibly replaced a snippet, and the button, disabled at
    // 0, stops working.
    const existing = [snippet({ id: "p1", shortcut: "/a" })];
    const incoming = [parsed({ suggestedId: "p1", shortcut: "/a" })];
    const conflicts = prefillConflictResolutions(incoming, existing).map(
      (c) => ({
        ...c,
        resolution: "overwrite" as const,
      })
    );

    expect(conflicts[0].conflictType).toBe("both");
    expect(countImported(incoming, conflicts)).toBe(1);
  });

  it("counts a shortcut-only overwrite as an import too", () => {
    const existing = [snippet({ id: "e1", shortcut: "/a" })];
    const incoming = [parsed({ suggestedId: "p1", shortcut: "/a" })];
    const conflicts = prefillConflictResolutions(incoming, existing).map(
      (c) => ({
        ...c,
        resolution: "overwrite" as const,
      })
    );

    expect(countImported(incoming, conflicts)).toBe(1);
  });

  it("counts an overwrite as one changed row", () => {
    // Not zero. An overwrite writes a snippet carrying the *incoming* id, so by id
    // it is a row the library did not have — and the user sees one snippet's
    // content change.
    //
    // This was checked against the component's previous formula
    // (`final - existing + overwriteCount`), which also returned 1. So this is not
    // a fix for a wrong number; it is one expression replacing two that had to be
    // re-derived in agreement.
    const existing = [snippet({ id: "e1", shortcut: "/a" })];
    const incoming = [parsed({ suggestedId: "p1", shortcut: "/a" })];

    const conflicts = prefillConflictResolutions(incoming, existing).map(
      (c) => ({
        ...c,
        resolution: "overwrite" as const,
      })
    );

    expect(countImported(incoming, conflicts)).toBe(1);
    // And the overwritten snippet is genuinely gone from what will be written.
    expect(
      previewFinalSnippets(existing, incoming, conflicts).map((s) => s.content)
    ).toEqual(["content"]);
  });

  it("counts a skip as nothing added", () => {
    const existing = [snippet({ id: "e1", shortcut: "/a" })];
    const incoming = [parsed({ suggestedId: "p1", shortcut: "/a" })];
    const conflicts = prefillConflictResolutions(incoming, existing).map(
      (c) => ({
        ...c,
        resolution: "skip" as const,
      })
    );

    expect(countImported(incoming, conflicts)).toBe(0);
  });

  it("counts a rename as an addition", () => {
    const existing = [snippet({ id: "e1", shortcut: "/a" })];
    const incoming = [parsed({ suggestedId: "p1", shortcut: "/a" })];
    const conflicts = prefillConflictResolutions(incoming, existing).map(
      (c) => ({
        ...c,
        resolution: "rename" as const,
      })
    );

    expect(countImported(incoming, conflicts)).toBe(1);
  });

  it("counts nothing for an empty parse", () => {
    expect(countImported([], [])).toBe(0);
  });
});

describe("willExceedQuota", () => {
  it("is false in local mode", () => {
    // Local storage has no sync quota. Warning about one would be noise that
    // trains the user to ignore the warning.
    expect(willExceedQuota([], [parsed()], [], "local")).toBe(false);
  });

  it("warns when a huge import would cross the line in sync mode", () => {
    const huge = parsed({
      content: "x".repeat(200_000),
    });
    expect(willExceedQuota([], [huge], [], "sync")).toBe(true);
  });

  it("does not warn for a small import", () => {
    expect(willExceedQuota([], [parsed()], [], "sync")).toBe(false);
  });
});

describe("canAdvanceFromUpload", () => {
  it("needs a parse, no error and a chosen format", () => {
    const base = {
      ...state(),
      parsedSnippets: [parsed()],
      selectedFormat: "clipio" as const,
    };
    expect(canAdvanceFromUpload(base)).toBe(true);

    // The negative cases, one at a time.
    expect(canAdvanceFromUpload({ ...base, parsedSnippets: [] })).toBe(false);
    expect(canAdvanceFromUpload({ ...base, parseError: "bad" })).toBe(false);
    expect(canAdvanceFromUpload({ ...base, selectedFormat: "" })).toBe(false);
  });
});

describe("detectedParserLabel", () => {
  it("returns nothing when no format was detected", () => {
    expect(detectedParserLabel(null)).toBeUndefined();
  });

  it("returns the parser for a detected format", () => {
    expect(detectedParserLabel("clipio")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------

describe("the wizard", () => {
  it("walks upload → confirm when there is nothing to review", () => {
    importStore.setState((prev) => ({
      ...prev,
      parsedSnippets: [parsed()],
      selectedFormat: "clipio",
    }));

    act(() => advanceFromUpload());

    expect(state().step).toBe(4);
  });

  it("stops at the placeholder step first", () => {
    importStore.setState((prev) => ({
      ...prev,
      parsedSnippets: [
        parsed({
          suggestedId: "p1",
          unsupportedPlaceholders: ["{{foo}}"],
        }),
      ],
    }));

    act(() => advanceFromUpload());
    expect(state().step).toBe(2);

    act(() => advanceFromPlaceholders());
    expect(state().step).toBe(4);
  });

  it("carries the resolved snippets forward, not the originals", () => {
    // The two must not describe different snippets, or the confirmation step
    // shows one list and writes another.
    //
    // `remove` strips *single-brace* `{token}` patterns and deliberately leaves
    // `{{...}}` alone — Clipio's own placeholders are not the target. `skip` is
    // what drops the text entirely.
    const rows = [
      parsed({
        suggestedId: "p1",
        content: "keep {{image:a1b2c3d4}} and drop {token}",
        unsupportedPlaceholders: ["{{foo}}"],
      }),
    ];
    importStore.setState((prev) => ({
      ...prev,
      parsedSnippets: rows,
      unsupportedEntries: [{ snippet: rows[0], action: "remove" }],
    }));

    act(() => advanceFromPlaceholders());

    expect(state().parsedSnippets[0].content).toBe(
      "keep {{image:a1b2c3d4}} and drop "
    );
  });

  it("loads the library and the storage mode", async () => {
    storage.getSnippets.mockResolvedValue([snippet({ id: "e1" })]);
    storage.getStorageStatus.mockResolvedValue({ mode: "local" });

    await initialiseImport();

    expect(state().existingSnippets).toHaveLength(1);
    expect(state().storageMode).toBe("local");
  });

  it("still loads what it can when one read fails", async () => {
    // Two independent reads. A failing storage-status read must not leave the
    // wizard with no library, which would silently skip conflict detection and
    // overwrite whatever collided.
    storage.getSnippets.mockResolvedValue([snippet({ id: "e1" })]);
    storage.getStorageStatus.mockRejectedValue(new Error("no status"));

    await initialiseImport();

    expect(state().existingSnippets).toHaveLength(1);
  });

  it("writes the library and reports the count", async () => {
    importStore.setState((prev) => ({
      ...prev,
      parsedSnippets: [parsed({ suggestedId: "p1" })],
    }));

    const count = await runImport();

    expect(count).toBe(1);
    expect(storage.bulkSaveSnippets).toHaveBeenCalledOnce();
    expect(state().importDone).toBe(true);
    expect(state().importedCount).toBe(1);
  });

  it("returns null and records the error when the write fails", async () => {
    // `null`, not `0` — a caller must not mistake "the write failed" for "there
    // was nothing to import" and report success.
    storage.bulkSaveSnippets.mockRejectedValue(new Error("quota"));
    importStore.setState((prev) => ({ ...prev, parsedSnippets: [parsed()] }));

    await expect(runImport()).resolves.toBeNull();

    expect(state().importError).toBe("quota");
    expect(state().importDone).toBe(false);
    // And `importing` is cleared, or the button would spin forever.
    expect(state().importing).toBe(false);
  });

  it("resets to a blank wizard but keeps the loaded library", () => {
    // Called when the wizard closes. The component's own `useState` initialisers
    // only ran on mount, and the wizard is often kept mounted behind a dialog —
    // so without this, reopening resumed halfway with the previous file loaded.
    importStore.setState((prev) => ({
      ...prev,
      step: 4,
      fileName: "old.json",
      parsedSnippets: [parsed()],
      importDone: true,
      importedCount: 7,
      existingSnippets: [snippet({ id: "e1" })],
    }));

    resetImport();

    expect(state().step).toBe(1);
    expect(state().fileName).toBeNull();
    expect(state().parsedSnippets).toEqual([]);
    expect(state().importedCount).toBe(0);
    // The library is not re-read on reset; it is already loaded and re-reading
    // would flash the conflict step with an empty library.
    expect(state().existingSnippets).toHaveLength(1);
  });
});

describe("React bindings", () => {
  it("re-renders when the step changes", () => {
    // Measured rather than merely present: a binding wired to the wrong store
    // fails silently, since the selector returns a valid undefined-shaped value.
    const { result } = renderHook(() => ({
      step: useImport((s) => s.step),
      parsed: useImport((s) => s.parsedSnippets.length),
    }));

    expect(result.current.step).toBe(1);

    act(() => {
      importStore.setState((prev) => ({
        ...prev,
        step: 3,
        parsedSnippets: [parsed()],
      }));
    });

    expect(result.current.step).toBe(3);
    expect(result.current.parsed).toBe(1);
  });
});

describe("ZIP media", () => {
  /**
   * The partial-failure report. Dropped once during this refactor — the media save
   * moved out of the component and the report went with it — and caught by the
   * component's own e2e. A user importing a 200-image archive and losing three of
   * them would otherwise see nothing: the import succeeds, the snippets import, and
   * three images are silently broken.
   */
  it("reports how many blobs were lost", async () => {
    const { restoreMediaEntry } = await import("@/storage/backends/media");
    vi.mocked(restoreMediaEntry)
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error("corrupt entry") as never);

    const blobs = new Map([
      ["a1b2c3d4", zipEntry("a1b2c3d4")],
      ["b2c3d4e5", zipEntry("b2c3d4e5")],
    ]);
    importStore.setState((prev) => ({
      ...prev,
      isZipImport: true,
      zipMediaBlobs: blobs,
      parsedSnippets: [parsed()],
    }));

    await runImport();

    expect(captureMessage).toHaveBeenCalledWith(
      "ZIP import: some media blobs failed to save",
      "warning",
      { saved: 1, total: 2 }
    );
  });

  it("does not report when every blob saved", async () => {
    const { restoreMediaEntry } = await import("@/storage/backends/media");
    vi.mocked(restoreMediaEntry).mockResolvedValue(undefined as never);

    importStore.setState((prev) => ({
      ...prev,
      isZipImport: true,
      zipMediaBlobs: new Map([["a1b2c3d4", zipEntry("a1b2c3d4")]]),
      parsedSnippets: [parsed()],
    }));

    await runImport();

    // No warning on a clean import. A report that fires on success trains the user
    // to ignore it.
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("still writes the snippets when a blob fails", async () => {
    const { restoreMediaEntry } = await import("@/storage/backends/media");
    vi.mocked(restoreMediaEntry).mockRejectedValue(
      new Error("corrupt") as never
    );

    importStore.setState((prev) => ({
      ...prev,
      isZipImport: true,
      zipMediaBlobs: new Map([["a1b2c3d4", zipEntry("a1b2c3d4")]]),
      parsedSnippets: [parsed()],
    }));

    await expect(runImport()).resolves.toBe(1);

    // The snippet text is still worth importing without its image.
    expect(storage.bulkSaveSnippets).toHaveBeenCalledOnce();
  });

  it("does not touch media for a non-ZIP import", async () => {
    const { restoreMediaEntry } = await import("@/storage/backends/media");
    importStore.setState((prev) => ({
      ...prev,
      isZipImport: false,
      zipMediaBlobs: new Map([["a1b2c3d4", zipEntry("a1b2c3d4")]]),
      parsedSnippets: [parsed()],
    }));

    await runImport();

    expect(restoreMediaEntry).not.toHaveBeenCalled();
  });
});
