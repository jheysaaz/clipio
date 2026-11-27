import { describe, expect, it } from "vitest";
import {
  duplicateSnippetFields,
  shortcutPrefixAndBody,
} from "./snippet-duplicate";
import type { Snippet } from "@/types";
import type { EditorFields } from "./snippet-draft";

const source: EditorFields = {
  label: "Address",
  shortcut: "/addr",
  content: "123 Fake Street",
  tags: ["personal", "work"],
};

function snippet(id: string, shortcut: string): Snippet {
  return {
    id,
    shortcut,
    label: id,
    content: "",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("shortcutPrefixAndBody", () => {
  it("splits a symbol prefix from the editable body", () => {
    expect(shortcutPrefixAndBody("/addr")).toEqual({
      prefix: "/",
      body: "addr",
    });
    expect(shortcutPrefixAndBody(";addr")).toEqual({
      prefix: ";",
      body: "addr",
    });
  });

  it("keeps an alphanumeric shortcut whole", () => {
    // Negative case: treating the first letter as a prefix would corrupt a
    // shortcut saved without a configured symbol.
    expect(shortcutPrefixAndBody("addr")).toEqual({ prefix: "", body: "addr" });
  });
});

describe("duplicateSnippetFields", () => {
  it("copies content and tags but gives the copy a non-conflicting shortcut", () => {
    const copy = duplicateSnippetFields(
      source,
      [snippet("s1", "/addr")],
      "Copy"
    );
    expect(copy).toEqual({
      label: "Copy",
      shortcut: "/copy-addr",
      content: source.content,
      tags: [...source.tags!],
    });
    expect(copy.tags).not.toBe(source.tags);
  });

  it("does not append to the source shortcut, which would be a prefix conflict", () => {
    // `/addr-copy` starts with `/addr`, so Clipio would refuse to save it.
    const copy = duplicateSnippetFields(
      source,
      [snippet("s1", "/addr")],
      "Copy"
    );
    expect(copy.shortcut.startsWith("/addr")).toBe(false);
  });

  it("numbered copies until every candidate is free", () => {
    const existing = [
      snippet("source", "/addr"),
      snippet("first", "/copy-addr"),
      snippet("second", "/copy-2-addr"),
    ];
    expect(
      duplicateSnippetFields(source, existing, "Another copy").shortcut
    ).toBe("/copy-3-addr");
  });

  it("handles an empty shortcut and a source with no prefix", () => {
    expect(
      duplicateSnippetFields({ ...source, shortcut: "" }, [], "Copy").shortcut
    ).toBe("copy-");
    expect(
      duplicateSnippetFields({ ...source, shortcut: "addr" }, [], "Copy")
        .shortcut
    ).toBe("copy-addr");
  });
});
