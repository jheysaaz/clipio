/**
 * Tests for src/types/index.ts — createSnippet factory function
 * spec: specs/snippet-model.spec.md
 */

import { describe, it, expect } from "vitest";
import { createSnippet } from "./index";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("createSnippet", () => {
  // spec: MUST return an object satisfying the Snippet interface
  it("returns an object with all required Snippet fields", () => {
    const snippet = createSnippet({
      label: "Hello",
      shortcut: "hi",
      content: "Hello world!",
    });
    expect(snippet).toHaveProperty("id");
    expect(snippet).toHaveProperty("label");
    expect(snippet).toHaveProperty("shortcut");
    expect(snippet).toHaveProperty("content");
    expect(snippet).toHaveProperty("tags");
    expect(snippet).toHaveProperty("usageCount");
    expect(snippet).toHaveProperty("createdAt");
    expect(snippet).toHaveProperty("updatedAt");
  });

  // spec: MUST generate a unique id using crypto.randomUUID()
  it("generates a UUID v4 id", () => {
    const snippet = createSnippet({ label: "L", shortcut: "s", content: "c" });
    expect(snippet.id).toMatch(UUID_RE);
  });

  // spec: Two successive calls produce different id values
  it("generates a different id on each call", () => {
    const a = createSnippet({ label: "L", shortcut: "s", content: "c" });
    const b = createSnippet({ label: "L", shortcut: "s", content: "c" });
    expect(a.id).not.toBe(b.id);
  });

  // spec: MUST copy label, shortcut, and content from input unchanged
  it("copies label from form data", () => {
    const snippet = createSnippet({
      label: "My Label",
      shortcut: "ml",
      content: "c",
    });
    expect(snippet.label).toBe("My Label");
  });

  it("copies shortcut from form data", () => {
    const snippet = createSnippet({
      label: "L",
      shortcut: "myshortcut",
      content: "c",
    });
    expect(snippet.shortcut).toBe("myshortcut");
  });

  it("copies content from form data", () => {
    const snippet = createSnippet({
      label: "L",
      shortcut: "s",
      content: "Hello **world**!",
    });
    expect(snippet.content).toBe("Hello **world**!");
  });

  // spec: MUST set tags to form.tags when provided
  it("uses provided tags", () => {
    const snippet = createSnippet({
      label: "L",
      shortcut: "s",
      content: "c",
      tags: ["work", "email"],
    });
    expect(snippet.tags).toEqual(["work", "email"]);
  });

  // spec: MUST set tags to [] when form.tags is undefined
  it("defaults tags to empty array when not provided", () => {
    const snippet = createSnippet({ label: "L", shortcut: "s", content: "c" });
    expect(snippet.tags).toEqual([]);
  });

  it("defaults tags to empty array when tags is explicitly undefined", () => {
    const snippet = createSnippet({
      label: "L",
      shortcut: "s",
      content: "c",
      tags: undefined,
    });
    expect(snippet.tags).toEqual([]);
  });

  // spec: MUST set usageCount to 0
  it("sets usageCount to 0", () => {
    const snippet = createSnippet({ label: "L", shortcut: "s", content: "c" });
    expect(snippet.usageCount).toBe(0);
  });

  // spec: MUST set createdAt and updatedAt to the same current ISO 8601 timestamp
  it("sets createdAt and updatedAt to the same value", () => {
    const snippet = createSnippet({ label: "L", shortcut: "s", content: "c" });
    expect(snippet.createdAt).toBe(snippet.updatedAt);
  });

  it("sets createdAt to a valid ISO 8601 string", () => {
    const snippet = createSnippet({ label: "L", shortcut: "s", content: "c" });
    const parsed = new Date(snippet.createdAt);
    expect(parsed.getTime()).not.toBeNaN();
    expect(snippet.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // spec: MUST NOT mutate the form input
  it("does not mutate the form input", () => {
    const form = { label: "L", shortcut: "s", content: "c", tags: ["a"] };
    const originalTags = [...form.tags];
    createSnippet(form);
    expect(form.tags).toEqual(originalTags);
  });

  // spec: empty content string → stored verbatim
  it("stores empty string content verbatim", () => {
    const snippet = createSnippet({ label: "L", shortcut: "s", content: "" });
    expect(snippet.content).toBe("");
  });
});
