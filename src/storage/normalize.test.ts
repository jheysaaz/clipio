/**
 * Tests for src/storage/normalize.ts
 * spec: specs/content-format-migration.spec.md
 *
 * This function was three byte-identical private copies, one per backend. The
 * point of the test is not the behaviour — that is covered by
 * content-format-migration.test.ts — but that all three backends now go through
 * one definition, so a future normalisation step cannot be added to one backend
 * and forgotten in the other two.
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

  it("preserves every other field", () => {
    const out = normalizeStoredSnippet(
      makeSnippet({ id: "keep", tags: ["a"], usageCount: 3 })
    );
    expect(out.id).toBe("keep");
    expect(out.tags).toEqual(["a"]);
    expect(out.usageCount).toBe(3);
  });
});
