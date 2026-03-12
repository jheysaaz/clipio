/**
 * Tests for src/lib/importers/detect.ts
 * spec: specs/importers.spec.md#detectFormat
 */

import { describe, it, expect } from "vitest";
import { detectFormat } from "./detect";

describe("detectFormat", () => {
  // ── Clipio versioned envelope ─────────────────────────────────────────────

  // spec: MUST return "clipio" for objects with format === "clipio"
  it('returns "clipio" for versioned envelope with snippets', () => {
    expect(detectFormat({ format: "clipio", version: 1, snippets: [] })).toBe(
      "clipio"
    );
  });

  it('returns "clipio" for versioned envelope with exportedAt', () => {
    expect(
      detectFormat({
        format: "clipio",
        version: 1,
        exportedAt: "2025-01-01T00:00:00Z",
        snippets: [],
      })
    ).toBe("clipio");
  });

  // ── Clipio legacy bare array ──────────────────────────────────────────────

  // spec: MUST return "clipio" for empty arrays
  it('returns "clipio" for empty array', () => {
    expect(detectFormat([])).toBe("clipio");
  });

  // spec: MUST return "clipio" for array whose first element has id, shortcut, content
  it('returns "clipio" for array with valid snippet shape', () => {
    expect(
      detectFormat([
        { id: "abc", shortcut: "hi", content: "Hello", label: "Hi" },
      ])
    ).toBe("clipio");
  });

  // spec: MUST return null for array whose first element is missing required fields
  it("returns null for array whose first element is missing id", () => {
    expect(detectFormat([{ shortcut: "hi", content: "Hello" }])).toBeNull();
  });

  it("returns null for array whose first element is missing shortcut", () => {
    expect(detectFormat([{ id: "abc", content: "Hello" }])).toBeNull();
  });

  it("returns null for array whose first element is missing content", () => {
    expect(detectFormat([{ id: "abc", shortcut: "hi" }])).toBeNull();
  });

  it("returns null for array whose first element has non-string id", () => {
    expect(
      detectFormat([{ id: 123, shortcut: "hi", content: "Hello" }])
    ).toBeNull();
  });

  // ── TextBlaze ─────────────────────────────────────────────────────────────

  // spec: MUST return "textblaze" for objects with version (number) AND folders (array)
  it('returns "textblaze" for object with version and folders', () => {
    expect(detectFormat({ version: 1, folders: [] })).toBe("textblaze");
  });

  it('returns "textblaze" for TextBlaze export with snippets', () => {
    expect(
      detectFormat({ version: 2, folders: [{ name: "General", snippets: [] }] })
    ).toBe("textblaze");
  });

  it("returns null when folders is present but version is not a number", () => {
    expect(detectFormat({ version: "1", folders: [] })).toBeNull();
  });

  it("returns null when version is present but folders is not an array", () => {
    expect(detectFormat({ version: 1, folders: "not-array" })).toBeNull();
  });

  // ── Power Text ────────────────────────────────────────────────────────────

  // spec: MUST return "powertext" for flat objects where all values are strings
  it('returns "powertext" for flat string-value object', () => {
    expect(detectFormat({ hello: "world", bye: "goodbye" })).toBe("powertext");
  });

  it('returns "powertext" for single-entry flat object', () => {
    expect(detectFormat({ hi: "Hello there!" })).toBe("powertext");
  });

  // spec: MUST return null for empty objects (PowerText requires at least one entry)
  it("returns null for empty object", () => {
    expect(detectFormat({})).toBeNull();
  });

  // spec: MUST return null for objects with mixed value types
  it("returns null when some values are not strings", () => {
    expect(detectFormat({ hi: "Hello", count: 42 })).toBeNull();
  });

  // spec: MUST return null for objects with structural Clipio/TextBlaze keys
  it("returns null for object with 'format' key", () => {
    expect(detectFormat({ format: "other", hi: "Hello" })).toBeNull();
  });

  it("returns null for object with 'version' key", () => {
    // version without folders → not textblaze, not powertext (has version key)
    expect(detectFormat({ version: "1", hi: "Hello" })).toBeNull();
  });

  it("returns null for object with 'snippets' key", () => {
    expect(detectFormat({ snippets: "data", hi: "Hello" })).toBeNull();
  });

  // ── Invalid inputs ────────────────────────────────────────────────────────

  // spec: MUST return null for null
  it("returns null for null input", () => {
    expect(detectFormat(null)).toBeNull();
  });

  // spec: MUST return null for non-objects
  it("returns null for string input", () => {
    expect(detectFormat("not an object")).toBeNull();
  });

  it("returns null for number input", () => {
    expect(detectFormat(42)).toBeNull();
  });

  it("returns null for boolean input", () => {
    expect(detectFormat(true)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(detectFormat(undefined)).toBeNull();
  });
});
