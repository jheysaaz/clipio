/**
 * Tests for src/lib/importers/textblaze.ts
 * spec: specs/importers.spec.md#TextBlazeParser
 */

import { describe, it, expect } from "vitest";
import { TextBlazeParser } from "./textblaze";

const makeTBExport = (folders: unknown[] = []) => ({
  version: 1,
  folders,
});

const makeTBSnippet = (overrides = {}) => ({
  name: "My Snippet",
  shortcut: "/ms",
  type: "text",
  text: "Hello world",
  ...overrides,
});

describe("TextBlazeParser.canParse", () => {
  // spec: MUST return true for objects with version (number) AND folders (array)
  it("returns true for valid TextBlaze export", () => {
    expect(TextBlazeParser.canParse({ version: 1, folders: [] })).toBe(true);
  });

  it("returns true for TextBlaze export with version 2", () => {
    expect(TextBlazeParser.canParse({ version: 2, folders: [{}] })).toBe(true);
  });

  // spec: MUST return false for arrays
  it("returns false for arrays", () => {
    expect(TextBlazeParser.canParse([])).toBe(false);
  });

  // spec: MUST return false for null
  it("returns false for null", () => {
    expect(TextBlazeParser.canParse(null)).toBe(false);
  });

  it("returns false for non-objects", () => {
    expect(TextBlazeParser.canParse("string")).toBe(false);
  });

  // spec: MUST return false when folders is missing
  it("returns false when folders is missing", () => {
    expect(TextBlazeParser.canParse({ version: 1 })).toBe(false);
  });

  // spec: MUST return false when version is not a number
  it("returns false when version is a string", () => {
    expect(TextBlazeParser.canParse({ version: "1", folders: [] })).toBe(false);
  });

  // spec: MUST return false when folders is not an array
  it("returns false when folders is not an array", () => {
    expect(TextBlazeParser.canParse({ version: 1, folders: {} })).toBe(false);
  });
});

describe("TextBlazeParser.parse", () => {
  // spec: MUST return [] for an export with no folders
  it("returns empty array for no folders", () => {
    expect(TextBlazeParser.parse(makeTBExport([]))).toEqual([]);
  });

  // spec: MUST return [] for all-empty folders
  it("returns empty array for folders with no snippets", () => {
    expect(
      TextBlazeParser.parse(makeTBExport([{ name: "Empty", snippets: [] }]))
    ).toEqual([]);
  });

  // spec: MUST iterate all folders and their snippets
  it("parses snippets from multiple folders", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([
        {
          name: "Folder A",
          snippets: [makeTBSnippet({ shortcut: "/a", name: "A" })],
        },
        {
          name: "Folder B",
          snippets: [makeTBSnippet({ shortcut: "/b", name: "B" })],
        },
      ])
    );
    expect(result).toHaveLength(2);
  });

  // spec: MUST skip snippets with empty shortcut
  it("skips snippets with empty shortcut", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([{ snippets: [makeTBSnippet({ shortcut: "" })] }])
    );
    expect(result).toEqual([]);
  });

  // spec: MUST skip snippets with empty name/label
  it("skips snippets with empty name", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([{ snippets: [makeTBSnippet({ name: "" })] }])
    );
    expect(result).toEqual([]);
  });

  // spec: MUST tag each snippet with "text_blaze"
  it("always tags snippets with 'text_blaze'", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([{ name: "General", snippets: [makeTBSnippet()] }])
    );
    expect(result[0].tags).toContain("text_blaze");
  });

  // spec: MUST tag each snippet with the lowercased folder name
  it("adds lowercased folder name as a tag", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([{ name: "WORK EMAIL", snippets: [makeTBSnippet()] }])
    );
    expect(result[0].tags).toContain("work email");
  });

  // spec: folder with no name → tags = ["text_blaze"] only
  it("only adds text_blaze tag when folder has no name", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([{ snippets: [makeTBSnippet()] }])
    );
    expect(result[0].tags).toEqual(["text_blaze"]);
  });

  // spec: MUST convert {cursor} → {{cursor}}
  it("converts {cursor} to {{cursor}}", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([
        { snippets: [makeTBSnippet({ text: "Hello {cursor} there" })] },
      ])
    );
    expect(result[0].content).toContain("{{cursor}}");
    // Ensure no single-braced {cursor} remains (only double-braced {{cursor}})
    expect(result[0].content).not.toMatch(/(?<!\{)\{cursor\}(?!\})/);
  });

  // spec: MUST convert {clipboard} → {{clipboard}}
  it("converts {clipboard} to {{clipboard}}", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([
        { snippets: [makeTBSnippet({ text: "Paste: {clipboard}" })] },
      ])
    );
    expect(result[0].content).toContain("{{clipboard}}");
  });

  // spec: MUST record unrecognised {token} placeholders in unsupportedPlaceholders
  it("records unsupported placeholders", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([
        { snippets: [makeTBSnippet({ text: "Fill in {formtext:name}" })] },
      ])
    );
    expect(result[0].unsupportedPlaceholders).toContain("{formtext:name}");
  });

  // spec: MUST process type:"text" snippets using the text field
  it("uses text field for type:text snippets", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([
        {
          snippets: [
            makeTBSnippet({ type: "text", text: "Plain text content" }),
          ],
        },
      ])
    );
    expect(result[0].content).toBe("Plain text content");
  });

  // spec: MUST process type:"html" snippets by converting HTML → markdown
  it("converts HTML snippets to markdown", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([
        {
          snippets: [
            makeTBSnippet({
              type: "html",
              html: "<p><strong>Bold text</strong></p>",
              text: "Bold text",
            }),
          ],
        },
      ])
    );
    expect(result[0].content).toContain("**Bold text**");
  });

  // spec: HTML with data-mce-style attributes → stripped before conversion
  it("strips data-mce-style attributes from HTML", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([
        {
          snippets: [
            makeTBSnippet({
              type: "html",
              html: '<p data-mce-style="color:red">Hello</p>',
              text: "Hello",
            }),
          ],
        },
      ])
    );
    expect(result[0].content).not.toContain("data-mce-style");
  });

  // spec: suggestedId should be a UUID
  it("assigns a UUID as suggestedId", () => {
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const result = TextBlazeParser.parse(
      makeTBExport([{ snippets: [makeTBSnippet()] }])
    );
    expect(result[0].suggestedId).toMatch(UUID_RE);
  });

  // spec: label from snippet name
  it("sets label from snippet name", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([
        {
          snippets: [
            makeTBSnippet({ name: "My Email Snippet", shortcut: "/email" }),
          ],
        },
      ])
    );
    expect(result[0].label).toBe("My Email Snippet");
    expect(result[0].shortcut).toBe("/email");
  });

  // spec: when type is missing, treat as text type
  it("falls back to text field when type is missing", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([
        {
          snippets: [makeTBSnippet({ type: undefined, text: "fallback text" })],
        },
      ])
    );
    expect(result[0].content).toBe("fallback text");
  });

  // spec: when text is missing but html is present for text type, use html field
  it("uses html field as fallback when text field is missing for text type", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([
        {
          snippets: [
            {
              name: "Test",
              shortcut: "/test",
              type: "text",
              text: undefined,
              html: "html fallback",
            },
          ],
        },
      ])
    );
    expect(result[0].content).toBe("html fallback");
  });

  // spec: HTML with unsupported placeholders — records them
  it("records unsupported placeholders from HTML snippets", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([
        {
          snippets: [
            makeTBSnippet({
              type: "html",
              html: "<p>Hello {formtext:name}</p>",
              text: "Hello {formtext:name}",
            }),
          ],
        },
      ])
    );
    expect(result[0].unsupportedPlaceholders).toContain("{formtext:name}");
  });

  // spec: skips snippets with missing name
  it("skips snippets with undefined name", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([
        {
          snippets: [{ shortcut: "/test", type: "text", text: "content" }],
        },
      ])
    );
    expect(result).toEqual([]);
  });

  // spec: skips snippets with undefined shortcut
  it("skips snippets with undefined shortcut", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([
        {
          snippets: [{ name: "Test", type: "text", text: "content" }],
        },
      ])
    );
    expect(result).toEqual([]);
  });

  // spec: handles folders with no snippets property
  it("handles folder with missing snippets property", () => {
    const result = TextBlazeParser.parse(
      makeTBExport([{ name: "Empty Folder" }])
    );
    expect(result).toEqual([]);
  });
});
