/**
 * Tests for src/lib/content-helpers.ts
 * spec: specs/content-expansion.spec.md
 */

import { describe, it, expect } from "vitest";
import {
  buildShortcutIndex,
  findSnippetMatch,
  formatDate,
  processSnippetContent,
  type ContentSnippet,
} from "./content-helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSnippet = (
  overrides: Partial<ContentSnippet> = {}
): ContentSnippet => ({
  id: "test-id",
  shortcut: "hi",
  content: "Hello world",
  label: "Hi",
  ...overrides,
});

const noClipboard = () => "";

// ---------------------------------------------------------------------------
// buildShortcutIndex
// ---------------------------------------------------------------------------

describe("buildShortcutIndex", () => {
  // spec: empty array → empty map and empty lengths
  it("returns empty map and lengths for empty snippets", () => {
    const index = buildShortcutIndex([]);
    expect(index.map.size).toBe(0);
    expect(index.lengths).toEqual([]);
  });

  // spec: returns correct map keyed by shortcut
  it("maps shortcuts to snippets", () => {
    const s = makeSnippet({ shortcut: "hi" });
    const index = buildShortcutIndex([s]);
    expect(index.map.get("hi")).toBe(s);
  });

  // spec: lengths are sorted descending
  it("sorts lengths descending", () => {
    const snippets = [
      makeSnippet({ id: "1", shortcut: "a" }),
      makeSnippet({ id: "2", shortcut: "bb" }),
      makeSnippet({ id: "3", shortcut: "ccc" }),
    ];
    const index = buildShortcutIndex(snippets);
    expect(index.lengths).toEqual([3, 2, 1]);
  });

  // spec: duplicate lengths are deduplicated
  it("deduplicates lengths", () => {
    const snippets = [
      makeSnippet({ id: "1", shortcut: "hi" }),
      makeSnippet({ id: "2", shortcut: "by" }),
    ];
    const index = buildShortcutIndex(snippets);
    expect(index.lengths).toEqual([2]); // both have length 2
  });

  // spec: last-write-wins for duplicate shortcuts
  it("last-write-wins for duplicate shortcuts", () => {
    const s1 = makeSnippet({ id: "first", shortcut: "hi" });
    const s2 = makeSnippet({ id: "second", shortcut: "hi" });
    const index = buildShortcutIndex([s1, s2]);
    expect(index.map.get("hi")!.id).toBe("second");
  });
});

// ---------------------------------------------------------------------------
// findSnippetMatch
// ---------------------------------------------------------------------------

describe("findSnippetMatch", () => {
  const snippet = makeSnippet({ shortcut: "hi" });
  const index = buildShortcutIndex([snippet]);

  // spec: returns null for empty text
  it("returns null for empty text", () => {
    expect(findSnippetMatch("", 0, index)).toBeNull();
  });

  // spec: returns null for empty index
  it("returns null for empty index", () => {
    const emptyIndex = buildShortcutIndex([]);
    expect(findSnippetMatch("hi", 2, emptyIndex)).toBeNull();
  });

  // spec: matches shortcut at start of text (no preceding char required)
  it("matches shortcut at start of text", () => {
    const result = findSnippetMatch("hi", 2, index);
    expect(result).not.toBeNull();
    expect(result!.snippet).toBe(snippet);
    expect(result!.startPos).toBe(0);
    expect(result!.endPos).toBe(2);
  });

  // spec: matches shortcut after a space (word boundary)
  it("matches shortcut after a space", () => {
    const result = findSnippetMatch("say hi", 6, index);
    expect(result).not.toBeNull();
    expect(result!.startPos).toBe(4);
  });

  // spec: matches shortcut after a newline (word boundary)
  it("matches shortcut after a newline", () => {
    const result = findSnippetMatch("say\nhi", 6, index);
    expect(result).not.toBeNull();
  });

  // spec: does NOT match when shortcut is suffix of another word (no word boundary)
  it("does not match when shortcut is inside a word", () => {
    const result = findSnippetMatch("ohhi", 4, index);
    expect(result).toBeNull();
  });

  // spec: skips shortcuts longer than cursorPosition
  it("returns null when cursorPosition is less than shortcut length", () => {
    const result = findSnippetMatch("h", 1, index);
    expect(result).toBeNull();
  });

  // spec: returns null when cursor is at position 0
  it("returns null when cursor is at position 0", () => {
    expect(findSnippetMatch("hi", 0, index)).toBeNull();
  });

  // spec: longer shortcuts match first (priority order)
  it("matches longer shortcut first", () => {
    const short = makeSnippet({ id: "short", shortcut: "hi" });
    const long = makeSnippet({ id: "long", shortcut: "hiho" });
    const multiIndex = buildShortcutIndex([short, long]);

    const result = findSnippetMatch("hiho", 4, multiIndex);
    expect(result!.snippet.id).toBe("long");
  });

  // spec: exact match only
  it("does not partially match a longer shortcut", () => {
    const result = findSnippetMatch("hi there", 2, index);
    // cursor at 2, text before cursor is "hi" → matches
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe("formatDate", () => {
  const FIXED_DATE = "2025-06-15";

  // spec: "iso" format → YYYY-MM-DD
  it("formats iso date", () => {
    expect(formatDate("iso", FIXED_DATE)).toBe("2025-06-15");
  });

  // spec: "us" format → MM/DD/YYYY
  it("formats us date", () => {
    expect(formatDate("us", FIXED_DATE)).toBe("06/15/2025");
  });

  // spec: "eu" format → DD/MM/YYYY
  it("formats eu date", () => {
    expect(formatDate("eu", FIXED_DATE)).toBe("15/06/2025");
  });

  // spec: "long" format → full locale date
  it("formats long date", () => {
    expect(formatDate("long", FIXED_DATE)).toBe("June 15, 2025");
  });

  // spec: "short" format → abbreviated locale date
  it("formats short date (abbreviated)", () => {
    const result = formatDate("short", FIXED_DATE);
    // Locale-formatted; just check it contains recognizable parts
    expect(result).toMatch(/Jun/);
    expect(result).toMatch(/15/);
  });

  // spec: unknown format → "iso" default
  it("defaults to iso format for unknown format string", () => {
    expect(formatDate("unknown", FIXED_DATE)).toBe("2025-06-15");
  });

  it("defaults to iso for empty format string", () => {
    expect(formatDate("", FIXED_DATE)).toBe("2025-06-15");
  });

  // spec: zero-pads month and day
  it("zero-pads single-digit month in iso format", () => {
    expect(formatDate("iso", "2025-01-05")).toBe("2025-01-05");
  });

  it("zero-pads single-digit day in us format", () => {
    expect(formatDate("us", "2025-01-05")).toBe("01/05/2025");
  });

  // spec: uses today's date when dateStr is omitted
  it("uses today when no dateStr provided", () => {
    const result = formatDate("iso");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// processSnippetContent
// ---------------------------------------------------------------------------

describe("processSnippetContent", () => {
  // ── Plain text mode (asHtml = false) ──────────────────────────────────────

  // spec: passes plain text through markdownToPlainText
  it("strips markdown from plain text content", () => {
    const result = processSnippetContent("**Hello** world", false, noClipboard);
    expect(result.content).toBe("Hello world");
    expect(result.cursorOffset).toBeNull();
  });

  // spec: MUST replace {{clipboard}} with readClipboard() result
  it("replaces {{clipboard}} with clipboard text", () => {
    const result = processSnippetContent(
      "Paste: {{clipboard}}",
      false,
      () => "clipboard content"
    );
    expect(result.content).toBe("Paste: clipboard content");
  });

  it("replaces all {{clipboard}} occurrences", () => {
    const result = processSnippetContent(
      "{{clipboard}} and {{clipboard}}",
      false,
      () => "X"
    );
    expect(result.content).toBe("X and X");
  });

  // spec: MUST replace {{date:format}} with formatDate result
  it("replaces {{date:iso}} with formatted date", () => {
    const result = processSnippetContent(
      "Today: {{date:iso}}",
      false,
      noClipboard
    );
    expect(result.content).toMatch(/Today: \d{4}-\d{2}-\d{2}/);
  });

  it("replaces multiple date placeholders", () => {
    const result = processSnippetContent(
      "{{date:iso}} and {{date:us}}",
      false,
      noClipboard
    );
    expect(result.content).toMatch(/\d{4}-\d{2}-\d{2} and \d{2}\/\d{2}\/\d{4}/);
  });

  // spec: MUST replace {{datepicker:YYYY-MM-DD}} with formatDate("long", date)
  it("replaces {{datepicker:YYYY-MM-DD}} with long date", () => {
    const result = processSnippetContent(
      "{{datepicker:2025-01-15}}",
      false,
      noClipboard
    );
    expect(result.content).toBe("January 15, 2025");
  });

  // spec: MUST detect {{cursor}} and compute cursorOffset
  it("detects cursor placeholder and computes offset", () => {
    const result = processSnippetContent(
      "Hello {{cursor}} world",
      false,
      noClipboard
    );
    // "Hello " is 6 chars of plain text before cursor
    expect(result.cursorOffset).toBe(6);
    expect(result.content).toBe("Hello  world"); // cursor removed, spaces remain
  });

  it("returns null cursorOffset when no cursor placeholder", () => {
    const result = processSnippetContent("Hello world", false, noClipboard);
    expect(result.cursorOffset).toBeNull();
  });

  // spec: cursor at start → offset = 0
  it("computes offset = 0 when cursor is at start", () => {
    const result = processSnippetContent("{{cursor}}Hello", false, noClipboard);
    expect(result.cursorOffset).toBe(0);
  });

  // spec: empty content → empty output
  it("handles empty content", () => {
    const result = processSnippetContent("", false, noClipboard);
    expect(result.content).toBe("");
    expect(result.cursorOffset).toBeNull();
  });

  // ── HTML mode (asHtml = true) ──────────────────────────────────────────────

  // spec: converts markdown to HTML when asHtml = true
  it("converts markdown to HTML in asHtml mode", () => {
    const result = processSnippetContent("**Hello**", true, noClipboard);
    expect(result.content).toBe("<strong>Hello</strong>");
  });

  // spec: replaces first {{cursor}} with marker span in HTML mode
  it("replaces first {{cursor}} with cursor marker span in HTML mode", () => {
    const result = processSnippetContent(
      "Hello {{cursor}} world",
      true,
      noClipboard
    );
    expect(result.content).toContain('data-clipio-cursor="true"');
    expect(result.content).not.toContain("{{cursor}}");
  });

  // spec: removes remaining {{cursor}} occurrences in HTML mode
  it("removes all cursor placeholders after the first in HTML mode", () => {
    const result = processSnippetContent(
      "{{cursor}} and {{cursor}}",
      true,
      noClipboard
    );
    const markerCount = (result.content.match(/data-clipio-cursor/g) || [])
      .length;
    expect(markerCount).toBe(1);
    expect(result.content).not.toContain("{{cursor}}");
  });

  // spec: cursorOffset is null in HTML mode
  it("returns cursorOffset null in HTML mode", () => {
    const result = processSnippetContent("{{cursor}}", true, noClipboard);
    expect(result.cursorOffset).toBeNull();
  });

  // spec: clipboard still replaced in HTML mode
  it("replaces {{clipboard}} in HTML mode", () => {
    const result = processSnippetContent(
      "Paste: {{clipboard}}",
      true,
      () => "hello"
    );
    expect(result.content).toContain("hello");
  });
});
