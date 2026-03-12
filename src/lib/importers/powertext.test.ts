/**
 * Tests for src/lib/importers/powertext.ts
 * spec: specs/importers.spec.md#PowerTextParser
 */

import { describe, it, expect } from "vitest";
import { PowerTextParser } from "./powertext";

describe("PowerTextParser.canParse", () => {
  // spec: MUST return true for flat string-value objects without structural keys
  it("returns true for simple flat string object", () => {
    expect(
      PowerTextParser.canParse({ hi: "Hello there!", bye: "Goodbye" })
    ).toBe(true);
  });

  it("returns true for single-entry object", () => {
    expect(PowerTextParser.canParse({ greeting: "Hello world" })).toBe(true);
  });

  // spec: MUST return false for empty objects
  it("returns false for empty object", () => {
    expect(PowerTextParser.canParse({})).toBe(false);
  });

  // spec: MUST return false for arrays
  it("returns false for arrays", () => {
    expect(PowerTextParser.canParse([])).toBe(false);
    expect(PowerTextParser.canParse([{ key: "val" }])).toBe(false);
  });

  // spec: MUST return false for null
  it("returns false for null", () => {
    expect(PowerTextParser.canParse(null)).toBe(false);
  });

  // spec: MUST return false when any value is non-string
  it("returns false when values include a number", () => {
    expect(PowerTextParser.canParse({ hi: "Hello", count: 42 })).toBe(false);
  });

  it("returns false when values include an object", () => {
    expect(PowerTextParser.canParse({ hi: {} })).toBe(false);
  });

  // spec: MUST return false for objects with structural Clipio keys
  it("returns false for object with 'format' key", () => {
    expect(PowerTextParser.canParse({ format: "clipio", hi: "Hello" })).toBe(
      false
    );
  });

  it("returns false for object with 'version' key", () => {
    expect(PowerTextParser.canParse({ version: 1, hi: "Hello" })).toBe(false);
  });

  it("returns false for object with 'folders' key", () => {
    expect(PowerTextParser.canParse({ folders: [], hi: "Hello" })).toBe(false);
  });

  it("returns false for object with 'snippets' key", () => {
    expect(PowerTextParser.canParse({ snippets: [], hi: "Hello" })).toBe(false);
  });
});

describe("PowerTextParser.parse", () => {
  // spec: MUST create one ParsedSnippet per key-value pair
  it("creates one snippet per entry", () => {
    const result = PowerTextParser.parse({ hi: "Hello", bye: "Goodbye" });
    expect(result).toHaveLength(2);
  });

  // spec: MUST set label and shortcut both to the key
  it("sets label and shortcut both to the key", () => {
    const result = PowerTextParser.parse({ greeting: "Hello world!" });
    expect(result[0].label).toBe("greeting");
    expect(result[0].shortcut).toBe("greeting");
  });

  // spec: MUST always tag each snippet with "power_text"
  it("always includes 'power_text' tag", () => {
    const result = PowerTextParser.parse({ hi: "Hello" });
    expect(result[0].tags).toContain("power_text");
  });

  // spec: MUST convert %clip% → {{clipboard}} (case-insensitive)
  it("converts %clip% to {{clipboard}}", () => {
    const result = PowerTextParser.parse({ paste: "Here: %clip%" });
    expect(result[0].content).toContain("{{clipboard}}");
  });

  it("converts %CLIP% to {{clipboard}} (uppercase)", () => {
    const result = PowerTextParser.parse({ paste: "Here: %CLIP%" });
    expect(result[0].content).toContain("{{clipboard}}");
  });

  it("converts %clipboard% to {{clipboard}}", () => {
    const result = PowerTextParser.parse({ paste: "%clipboard% pasted" });
    expect(result[0].content).toContain("{{clipboard}}");
  });

  // spec: MUST convert known %d(format) → {{date:id}}
  it("converts %d(YYYY-MM-DD) → {{date:iso}}", () => {
    const result = PowerTextParser.parse({ today: "%d(YYYY-MM-DD)" });
    expect(result[0].content).toContain("{{date:iso}}");
  });

  it("converts %d(MM/DD/YYYY) → {{date:us}}", () => {
    const result = PowerTextParser.parse({ today: "%d(MM/DD/YYYY)" });
    expect(result[0].content).toContain("{{date:us}}");
  });

  it("converts %d(DD/MM/YYYY) → {{date:eu}}", () => {
    const result = PowerTextParser.parse({ today: "%d(DD/MM/YYYY)" });
    expect(result[0].content).toContain("{{date:eu}}");
  });

  it("converts %d(MMMM Do, YYYY) → {{date:long}}", () => {
    const result = PowerTextParser.parse({ today: "%d(MMMM Do, YYYY)" });
    expect(result[0].content).toContain("{{date:long}}");
  });

  it("converts %d(MMM Do) → {{date:short}}", () => {
    const result = PowerTextParser.parse({ today: "%d(MMM Do)" });
    expect(result[0].content).toContain("{{date:short}}");
  });

  // spec: MUST flag unrecognised %d(...) format strings in unsupportedPlaceholders
  it("flags unknown date format as unsupported", () => {
    const result = PowerTextParser.parse({ today: "%d(YYYYMMDD)" });
    expect(result[0].unsupportedPlaceholders).toContain("%d(YYYYMMDD)");
  });

  // spec: MUST skip entries with empty keys or values
  it("skips entries with empty keys", () => {
    const result = PowerTextParser.parse({ "": "expansion", hi: "Hello" });
    expect(result).toHaveLength(1);
    expect(result[0].shortcut).toBe("hi");
  });

  it("skips entries with empty values", () => {
    const result = PowerTextParser.parse({ hi: "", bye: "Goodbye" });
    expect(result).toHaveLength(1);
    expect(result[0].shortcut).toBe("bye");
  });

  // spec: MUST deduplicate unsupportedPlaceholders
  it("deduplicates unsupported placeholders", () => {
    const result = PowerTextParser.parse({ today: "%d(X) and %d(X) again" });
    const count = result[0].unsupportedPlaceholders.filter(
      (p) => p === "%d(X)"
    ).length;
    expect(count).toBe(1);
  });

  // spec: suggestedId MUST be a UUID
  it("assigns a UUID as suggestedId", () => {
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const result = PowerTextParser.parse({ hi: "Hello" });
    expect(result[0].suggestedId).toMatch(UUID_RE);
  });

  // spec: HTML values → convert via markdown pipeline
  it("converts HTML expansion to markdown", () => {
    const result = PowerTextParser.parse({
      bold: "<strong>Hello</strong>",
    });
    expect(result[0].content).toBe("**Hello**");
  });

  // Plain text passes through
  it("passes plain text values through unchanged (after placeholder subs)", () => {
    const result = PowerTextParser.parse({ greet: "Hello, how are you?" });
    expect(result[0].content).toBe("Hello, how are you?");
  });
});
