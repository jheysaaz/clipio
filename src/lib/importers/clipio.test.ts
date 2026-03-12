/**
 * Tests for src/lib/importers/clipio.ts
 * spec: specs/importers.spec.md#ClipioParser
 */

import { describe, it, expect } from "vitest";
import { ClipioParser } from "./clipio";

const makeSnippet = (overrides = {}) => ({
  id: "test-id",
  label: "Test Snippet",
  shortcut: "ts",
  content: "Test content",
  tags: ["tag1"],
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  ...overrides,
});

describe("ClipioParser.canParse", () => {
  // spec: MUST return true for versioned envelope
  it("returns true for versioned envelope", () => {
    expect(
      ClipioParser.canParse({ format: "clipio", version: 1, snippets: [] })
    ).toBe(true);
  });

  // spec: MUST return true for empty array
  it("returns true for empty array", () => {
    expect(ClipioParser.canParse([])).toBe(true);
  });

  // spec: MUST return true for array with valid snippet shape
  it("returns true for array with valid first element", () => {
    expect(ClipioParser.canParse([makeSnippet()])).toBe(true);
  });

  // spec: MUST return false for null
  it("returns false for null", () => {
    expect(ClipioParser.canParse(null)).toBe(false);
  });

  it("returns false for non-objects", () => {
    expect(ClipioParser.canParse("string")).toBe(false);
    expect(ClipioParser.canParse(42)).toBe(false);
  });

  // spec: MUST return false for array whose first element is missing required fields
  it("returns false when first element is missing id", () => {
    expect(ClipioParser.canParse([{ shortcut: "hi", content: "c" }])).toBe(
      false
    );
  });

  it("returns false when first element is missing shortcut", () => {
    expect(ClipioParser.canParse([{ id: "x", content: "c" }])).toBe(false);
  });

  it("returns false when first element is missing content", () => {
    expect(ClipioParser.canParse([{ id: "x", shortcut: "hi" }])).toBe(false);
  });
});

describe("ClipioParser.parse", () => {
  // spec: MUST return [] for empty array
  it("returns empty array for empty array input", () => {
    expect(ClipioParser.parse([])).toEqual([]);
  });

  // spec: MUST return [] for envelope with empty snippets
  it("returns empty array for envelope with empty snippets", () => {
    expect(
      ClipioParser.parse({ format: "clipio", version: 1, snippets: [] })
    ).toEqual([]);
  });

  // spec: MUST parse versioned envelope by reading envelope.snippets
  it("parses snippets from versioned envelope", () => {
    const snippet = makeSnippet();
    const result = ClipioParser.parse({
      format: "clipio",
      version: 1,
      snippets: [snippet],
    });
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Test Snippet");
    expect(result[0].shortcut).toBe("ts");
    expect(result[0].content).toBe("Test content");
  });

  // spec: MUST parse legacy bare array
  it("parses snippets from legacy bare array", () => {
    const snippet = makeSnippet({
      label: "Hello",
      shortcut: "h",
      content: "Hi there",
    });
    const result = ClipioParser.parse([snippet]);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Hello");
  });

  // spec: MUST set suggestedId === snippet.id
  it("maps suggestedId to the snippet id", () => {
    const snippet = makeSnippet({ id: "my-unique-id" });
    const result = ClipioParser.parse([snippet]);
    expect(result[0].suggestedId).toBe("my-unique-id");
  });

  // spec: MUST preserve tags from the source
  it("preserves tags", () => {
    const snippet = makeSnippet({ tags: ["work", "email"] });
    const result = ClipioParser.parse([snippet]);
    expect(result[0].tags).toEqual(["work", "email"]);
  });

  // spec: MUST default tags to [] when missing
  it("defaults tags to [] when not present", () => {
    const { tags: _omit, ...snippetWithoutTags } = makeSnippet();
    const result = ClipioParser.parse([snippetWithoutTags]);
    expect(result[0].tags).toEqual([]);
  });

  // spec: MUST always set unsupportedPlaceholders to []
  it("sets unsupportedPlaceholders to empty array", () => {
    const result = ClipioParser.parse([makeSnippet()]);
    expect(result[0].unsupportedPlaceholders).toEqual([]);
  });

  // spec: MUST skip items that fail validation (missing required fields)
  it("skips invalid items in the array", () => {
    const valid = makeSnippet({ id: "good" });
    const invalid = { noId: true, content: "c" };
    const result = ClipioParser.parse([invalid, valid]);
    expect(result).toHaveLength(1);
    expect(result[0].suggestedId).toBe("good");
  });

  // spec: MUST handle envelope with mixed valid/invalid snippets
  it("filters out invalid snippets from envelope", () => {
    const valid = makeSnippet({ id: "valid-id" });
    const invalid = { id: 123, shortcut: "x", content: "c" }; // id is not a string
    const result = ClipioParser.parse({
      format: "clipio",
      version: 1,
      snippets: [valid, invalid],
    });
    expect(result).toHaveLength(1);
  });

  // Multiple snippets
  it("parses multiple snippets", () => {
    const snippets = [
      makeSnippet({ id: "1", label: "One", shortcut: "one" }),
      makeSnippet({ id: "2", label: "Two", shortcut: "two" }),
    ];
    const result = ClipioParser.parse(snippets);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("One");
    expect(result[1].label).toBe("Two");
  });
});
