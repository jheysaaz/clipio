/**
 * Tests for src/storage/normalize.ts
 * spec: specs/content-format-migration.spec.md
 *
 * This function was three byte-identical private copies, one per backend, so
 * there is now one definition to change.
 *
 * **On what this file does and does not claim:** the duplication itself is not
 * testable — a shared helper and three copies behave identically, and no unit
 * test can tell them apart. A previous version of this header claimed that
 * "all three backends go through one definition" was the point of these tests,
 * which was false: nothing here imports the backends. These tests cover
 * `normalizeStoredSnippet`'s *behaviour*, and they overlap with
 * `content-format-migration.test.ts` — the `contentFormat` drop and the
 * legacy-HTML conversion are each asserted in both places. The redundancy is
 * left in place deliberately, so this module has direct coverage rather than
 * relying on a sibling file, but it should not be counted twice when judging how
 * much of the migration is covered.
 */

import { describe, it, expect } from "vitest";
import { normalizeStoredSnippet } from "./normalize";
import type { Snippet } from "@/types";

const makeSnippet = (overrides: Partial<Snippet> = {}): Snippet => ({
  id: "s1",
  label: "One",
  shortcut: "/one",
  content: "plain body",
  tags: [],
  usageCount: 0,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  ...overrides,
});

describe("normalizeStoredSnippet", () => {
  it("passes a modern snippet through unchanged", () => {
    const input = makeSnippet();
    expect(normalizeStoredSnippet(input)).toEqual(input);
  });

  it("converts a legacy html body", () => {
    const legacy = {
      ...makeSnippet({ content: "<p>Hi</p><p>There</p>" }),
      contentFormat: "html",
    } as unknown as Snippet;

    expect(normalizeStoredSnippet(legacy).content).toBe("Hi\n\nThere");
  });

  it("drops the retired flag", () => {
    const legacy = {
      ...makeSnippet(),
      contentFormat: "markdown",
    } as unknown as Snippet;

    expect(normalizeStoredSnippet(legacy)).not.toHaveProperty("contentFormat");
  });

  it("is idempotent", () => {
    const legacy = {
      ...makeSnippet({ content: "<p>Hi</p>" }),
      contentFormat: "html",
    } as unknown as Snippet;

    const once = normalizeStoredSnippet(legacy);
    expect(normalizeStoredSnippet(once)).toEqual(once);
  });

  it("does not mutate its input", () => {
    // The sync backend maps over a list it also persists, so an in-place edit
    // would write the migrated body back to storage as a side effect of reading.
    const input = makeSnippet();
    const before = { ...input };
    normalizeStoredSnippet(input);
    expect(input).toEqual(before);
  });

  // Field-level assertions on a *modified* snippet, so this is not subsumed by
  // the toEqual(input) pass-through test above: that one only shows untouched
  // snippets survive, and would still pass if the legacy path dropped `tags`.
  it("preserves every other field while converting the body", () => {
    // `contentFormat` is a legacy field that has already been dropped from the
    // `Snippet` type, so the legacy shape is built as a plain object — the same
    // way content-format-migration.test.ts does it.
    const input = {
      ...makeSnippet({ id: "keep", tags: ["a"], usageCount: 3 }),
      contentFormat: "html",
      // `content`, not `body`: that is the field the migration reads. An
      // earlier version of this test set `body`, which nothing looks at, so the
      // legacy branch never actually converted anything.
      content: "<b>hi</b>",
    } as unknown as Snippet;
    const out = normalizeStoredSnippet(input);
    expect(out.id).toBe("keep");
    expect(out.tags).toEqual(["a"]);
    expect(out.usageCount).toBe(3);
    // And the body really was converted, which is what makes this more than a
    // field-preservation check.
    expect(out.content).toBe("**hi**");
  });
});
