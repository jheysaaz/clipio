/**
 * Tests for pipe-table cell escaping, used by both Markdown emitters.
 */

import { describe, expect, it } from "vitest";
import { escapeMarkdownTableCell } from "./markdown-table";

describe("escapeMarkdownTableCell", () => {
  it("escapes a pipe so it stays inside the cell", () => {
    expect(escapeMarkdownTableCell("a|b")).toBe("a\\|b");
  });

  it("escapes every pipe, not only the first", () => {
    expect(escapeMarkdownTableCell("a|b|c")).toBe("a\\|b\\|c");
  });

  it("doubles a backslash before a pipe", () => {
    // The negative case for the CodeQL finding: escaping only the pipe would
    // turn this source `\|` into `\\|`, which re-opens the cell delimiter.
    expect(escapeMarkdownTableCell("a\\|b")).toBe("a\\\\\\|b");
  });

  it("escapes backslashes that are not followed by a pipe", () => {
    expect(escapeMarkdownTableCell("C:\\tmp")).toBe("C:\\\\tmp");
  });

  it("leaves plain text alone", () => {
    expect(escapeMarkdownTableCell("ordinary cell")).toBe("ordinary cell");
  });

  it("leaves an empty cell empty", () => {
    expect(escapeMarkdownTableCell("")).toBe("");
  });
});
