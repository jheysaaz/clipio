/**
 * Tests for src/lib/importers/merge.ts
 *
 * These decide what an imported snippet becomes, so the cost of a mistake is a
 * user's snippet silently overwritten or duplicated. The tests below are
 * weighted towards the destructive outcomes: overwrite must not leak a stale
 * copy, skip must not import anything, rename must not collide again.
 */

import { describe, expect, it } from "vitest";
import {
  applyUnsupportedAction,
  buildFinalSnippets,
  detectConflicts,
  estimateJsonSize,
  suggestShortcut,
} from "./merge";
import type { Snippet } from "@/types";
import type { ConflictEntry, ParsedSnippet } from "./types";

function existing(partial: Partial<Snippet> & { id: string }): Snippet {
  return {
    label: partial.shortcut ?? "Existing",
    shortcut: `/existing-${partial.id}`,
    content: "old",
    tags: [],
    usageCount: 0,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    ...partial,
  } as Snippet;
}

function parsed(partial: Partial<ParsedSnippet> = {}): ParsedSnippet {
  return {
    suggestedId: "incoming-1",
    label: "Incoming",
    shortcut: "/incoming",
    content: "new",
    tags: [],
    ...partial,
  } as ParsedSnippet;
}

// ---------------------------------------------------------------------------
// applyUnsupportedAction
// ---------------------------------------------------------------------------

describe("applyUnsupportedAction", () => {
  const withPlaceholders = parsed({
    content: "Hi {{name}}, your code is {authToken} — ok?",
    unsupportedPlaceholders: ["authToken"],
  });

  it("drops the snippet entirely when the action is skip", () => {
    // null is the caller's signal to not import it at all.
    expect(applyUnsupportedAction(withPlaceholders, "skip")).toBeNull();
  });

  it("strips single-brace tokens and clears the list when removing", () => {
    const result = applyUnsupportedAction(withPlaceholders, "remove");

    expect(result?.content).toBe("Hi {{name}}, your code is  — ok?");
    expect(result?.unsupportedPlaceholders).toEqual([]);
  });

  it("keeps our own double-brace placeholders when removing", () => {
    // The whole point of the lookbehind/lookahead pair: {{image:…}} is Clipio
    // syntax and must survive an import, or every media snippet imported from
    // another format would lose its images.
    const result = applyUnsupportedAction(
      parsed({ content: "see {{image:abc:200}} and {token}" }),
      "remove"
    );

    expect(result?.content).toBe("see {{image:abc:200}} and ");
  });

  it("leaves content untouched when keeping, but clears the warnings", () => {
    const result = applyUnsupportedAction(withPlaceholders, "keep");

    expect(result?.content).toBe(withPlaceholders.content);
    // Clearing the list is what stops the wizard asking again for a snippet
    // the user has already answered for.
    expect(result?.unsupportedPlaceholders).toEqual([]);
  });

  it("does not mutate the snippet it was given", () => {
    const original = { ...withPlaceholders };
    applyUnsupportedAction(withPlaceholders, "remove");

    expect(withPlaceholders).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// detectConflicts
// ---------------------------------------------------------------------------

describe("detectConflicts", () => {
  const stored = existing({ id: "abc", shortcut: "/abc" });

  it("reports no conflict when nothing collides", () => {
    expect(detectConflicts([parsed()], [stored])).toEqual([]);
  });

  it("detects a collision on id", () => {
    const [conflict] = detectConflicts(
      [parsed({ suggestedId: "abc", shortcut: "/different" })],
      [stored]
    );

    expect(conflict.conflictType).toBe("id");
  });

  it("detects a collision on shortcut", () => {
    const [conflict] = detectConflicts(
      [parsed({ suggestedId: "different", shortcut: "/abc" })],
      [stored]
    );

    expect(conflict.conflictType).toBe("shortcut");
  });

  it("reports 'both' when the same snippet matches on id and shortcut", () => {
    const [conflict] = detectConflicts(
      [parsed({ suggestedId: "abc", shortcut: "/abc" })],
      [stored]
    );

    expect(conflict.conflictType).toBe("both");
    expect(conflict.existing.id).toBe("abc");
  });

  it("does not report 'both' when two DIFFERENT snippets are matched", () => {
    // Id collides with one stored snippet, shortcut with another. Reporting
    // "both" here would point the user at the wrong existing snippet.
    const a = existing({ id: "abc", shortcut: "/x" });
    const b = existing({ id: "zzz", shortcut: "/abc" });

    const [conflict] = detectConflicts(
      [parsed({ suggestedId: "abc", shortcut: "/abc" })],
      [a, b]
    );

    expect(conflict.conflictType).toBe("id");
    expect(conflict.existing.id).toBe("abc");
  });

  it("defaults every conflict to skip, so nothing is destroyed unasked", () => {
    const [conflict] = detectConflicts(
      [parsed({ suggestedId: "abc" })],
      [stored]
    );

    expect(conflict.resolution).toBe("skip");
  });

  it("reports every colliding snippet, not just the first", () => {
    const conflicts = detectConflicts(
      [
        parsed({ suggestedId: "abc", shortcut: "/a" }),
        parsed({ suggestedId: "def", shortcut: "/b" }),
        parsed({ suggestedId: "ghi", shortcut: "/c" }),
      ],
      [existing({ id: "abc" }), existing({ id: "def" })]
    );

    expect(conflicts).toHaveLength(2);
  });

  it("handles an empty existing list", () => {
    expect(detectConflicts([parsed()], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// suggestShortcut
// ---------------------------------------------------------------------------

describe("suggestShortcut", () => {
  it("returns the base when it is free", () => {
    expect(
      suggestShortcut("/new", [existing({ id: "a", shortcut: "/old" })])
    ).toBe("/new");
  });

  it("appends _2 when the base is taken", () => {
    expect(
      suggestShortcut("/taken", [existing({ id: "a", shortcut: "/taken" })])
    ).toBe("/taken_2");
  });

  it("skips over every taken suffix rather than returning a collision", () => {
    // The bug this pins: a loop that stopped at the first free-looking suffix
    // would hand back a shortcut that is already bound to another snippet, and
    // two snippets would expand on the same trigger.
    const stored = [
      existing({ id: "a", shortcut: "/x" }),
      existing({ id: "b", shortcut: "/x_2" }),
      existing({ id: "c", shortcut: "/x_3" }),
    ];

    expect(suggestShortcut("/x", stored)).toBe("/x_4");
  });

  it("is stable across repeated calls", () => {
    const stored = [existing({ id: "a", shortcut: "/x" })];
    expect(suggestShortcut("/x", stored)).toBe(suggestShortcut("/x", stored));
  });

  it("handles an empty store", () => {
    expect(suggestShortcut("/anything", [])).toBe("/anything");
  });
});

// ---------------------------------------------------------------------------
// estimateJsonSize
// ---------------------------------------------------------------------------

describe("estimateJsonSize", () => {
  it("measures the empty array itself, not zero", () => {
    // JSON.stringify([]) is the two-character string "[]". A 2-byte
    // overcount on an empty import is immaterial to the quota check, and it
    // keeps the function a pure measurement rather than a special case.
    expect(estimateJsonSize([])).toBe(2);
  });

  it("grows with the content", () => {
    const small = estimateJsonSize([existing({ id: "a", content: "x" })]);
    const large = estimateJsonSize([
      existing({ id: "a", content: "x".repeat(500) }),
    ]);

    expect(large).toBeGreaterThan(small);
  });

  it("measures the JSON payload, not the object count", () => {
    // Guards against an implementation that returned snippets.length, which
    // would never trip the sync-quota warning.
    expect(estimateJsonSize([existing({ id: "a" })])).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// buildFinalSnippets
// ---------------------------------------------------------------------------

describe("buildFinalSnippets", () => {
  const stored = existing({ id: "abc", shortcut: "/abc", label: "Stored" });

  function conflictFor(
    snippet: ParsedSnippet,
    against: Snippet,
    resolution: ConflictEntry["resolution"],
    renamedShortcut?: string
  ): ConflictEntry {
    return {
      incoming: snippet,
      existing: against,
      conflictType: "both",
      resolution,
      renamedShortcut,
    };
  }

  it("appends a non-colliding snippet and keeps the stored one", () => {
    const incoming = parsed();
    const result = buildFinalSnippets([stored], [incoming], []);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(stored);
    expect(result[1]).toMatchObject({
      id: incoming.suggestedId,
      shortcut: incoming.shortcut,
    });
  });

  it("drops an incoming snippet resolved to skip", () => {
    const incoming = parsed({ suggestedId: "abc", shortcut: "/abc" });
    const result = buildFinalSnippets(
      [stored],
      [incoming],
      [conflictFor(incoming, stored, "skip")]
    );

    // The stored snippet survives untouched and nothing is imported.
    expect(result).toEqual([stored]);
  });

  it("replaces the stored snippet when resolved to overwrite", () => {
    const incoming = parsed({
      suggestedId: "abc",
      shortcut: "/abc",
      label: "Replacement",
    });
    const result = buildFinalSnippets(
      [stored],
      [incoming],
      [conflictFor(incoming, stored, "overwrite")]
    );

    // Exactly one snippet, carrying the incoming content. If the overwrite
    // branch forgot to drop the old one, the list would be length 2 with a
    // duplicate id and the user's edit would appear to have been ignored.
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "abc",
      label: "Replacement",
      content: "new",
    });
  });

  it("resets usageCount on an overwrite", () => {
    const used = existing({ id: "abc", shortcut: "/abc", usageCount: 42 });
    const incoming = parsed({ suggestedId: "abc", shortcut: "/abc" });

    const result = buildFinalSnippets(
      [used],
      [incoming],
      [conflictFor(incoming, used, "overwrite")]
    );

    expect(result[0].usageCount).toBe(0);
  });

  it("gives a renamed snippet a fresh id and the new shortcut", () => {
    const incoming = parsed({ suggestedId: "abc", shortcut: "/abc" });
    const result = buildFinalSnippets(
      [stored],
      [incoming],
      [conflictFor(incoming, stored, "rename", "/abc_2")]
    );

    expect(result).toHaveLength(2);
    expect(result[1].shortcut).toBe("/abc_2");
    // Reusing the colliding id would overwrite the stored snippet instead of
    // living alongside it.
    expect(result[1].id).not.toBe("abc");
    expect(result[0].id).toBe("abc");
  });

  it("falls back to the incoming shortcut when no rename was chosen", () => {
    const incoming = parsed({ suggestedId: "abc", shortcut: "/abc" });
    const result = buildFinalSnippets(
      [stored],
      [incoming],
      [conflictFor(incoming, stored, "rename")]
    );

    expect(result[1].shortcut).toBe("/abc");
  });

  it("applies resolutions per snippet, not to the whole batch", () => {
    const keep = parsed({ suggestedId: "new-1", shortcut: "/new-1" });
    const clash = parsed({ suggestedId: "abc", shortcut: "/abc" });

    const result = buildFinalSnippets(
      [stored],
      [keep, clash],
      [conflictFor(clash, stored, "skip")]
    );

    expect(result).toHaveLength(2);
    expect(result.map((s) => s.shortcut)).toEqual(["/abc", "/new-1"]);
  });

  it("stamps a fresh updatedAt on imported snippets", () => {
    const incoming = parsed();
    const [added] = buildFinalSnippets([], [incoming], []);

    expect(added.updatedAt).not.toBe(stored.updatedAt);
    expect(Date.parse(added.updatedAt)).not.toBeNaN();
  });

  it("does not mutate the stored snippets it was given", () => {
    const incoming = parsed({ suggestedId: "abc", shortcut: "/abc" });
    const snapshot = JSON.stringify(stored);

    buildFinalSnippets(
      [stored],
      [incoming],
      [conflictFor(incoming, stored, "overwrite")]
    );

    expect(JSON.stringify(stored)).toBe(snapshot);
  });

  it("handles an empty import", () => {
    expect(buildFinalSnippets([stored], [], [])).toEqual([stored]);
  });
});
