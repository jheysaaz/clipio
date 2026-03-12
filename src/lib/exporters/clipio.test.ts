/**
 * Tests for src/lib/exporters/clipio.ts
 * spec: specs/exporters.spec.md
 */

import { describe, it, expect } from "vitest";
import { buildClipioExport } from "./clipio";
import type { Snippet } from "~/types";

const makeSnippet = (overrides: Partial<Snippet> = {}): Snippet => ({
  id: "test-id",
  label: "Test",
  shortcut: "ts",
  content: "Test content",
  tags: [],
  usageCount: 0,
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  ...overrides,
});

describe("buildClipioExport", () => {
  // spec: MUST return an object with version set to the literal 1
  it("sets version to 1", () => {
    const result = buildClipioExport([]);
    expect(result.version).toBe(1);
  });

  // spec: MUST return an object with format set to the literal "clipio"
  it('sets format to "clipio"', () => {
    const result = buildClipioExport([]);
    expect(result.format).toBe("clipio");
  });

  // spec: MUST set exportedAt to a valid ISO 8601 timestamp
  it("sets exportedAt to a valid ISO date string", () => {
    const result = buildClipioExport([]);
    const parsed = new Date(result.exportedAt);
    expect(parsed.getTime()).not.toBeNaN();
  });

  it("sets exportedAt to a string that looks like an ISO timestamp", () => {
    const result = buildClipioExport([]);
    expect(result.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // spec: MUST pass the snippets array through unchanged
  it("passes the snippets array through", () => {
    const snippets = [makeSnippet({ id: "a" }), makeSnippet({ id: "b" })];
    const result = buildClipioExport(snippets);
    expect(result.snippets).toEqual(snippets);
  });

  // spec: MUST work correctly with an empty snippets array
  it("works with an empty snippets array", () => {
    const result = buildClipioExport([]);
    expect(result.snippets).toEqual([]);
  });

  // spec: MUST NOT mutate the input snippets array
  it("does not mutate the input array", () => {
    const snippets = [makeSnippet()];
    const originalLength = snippets.length;
    buildClipioExport(snippets);
    expect(snippets.length).toBe(originalLength);
  });

  // spec: result is a valid ClipioExport shape
  it("returns the correct envelope shape", () => {
    const snippets = [makeSnippet()];
    const result = buildClipioExport(snippets);
    expect(result).toMatchObject({
      version: 1,
      format: "clipio",
      snippets,
    });
    expect(typeof result.exportedAt).toBe("string");
  });

  // spec: exportedAt reflects the time of the call (within a reasonable window)
  it("sets exportedAt close to the current time", () => {
    const before = Date.now();
    const result = buildClipioExport([]);
    const after = Date.now();
    const exportedTime = new Date(result.exportedAt).getTime();
    expect(exportedTime).toBeGreaterThanOrEqual(before);
    expect(exportedTime).toBeLessThanOrEqual(after);
  });
});
