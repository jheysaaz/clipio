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
  escapeHtmlAttr,
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

// ---------------------------------------------------------------------------
// processSnippetContent — image & gif placeholders
// ---------------------------------------------------------------------------

describe("processSnippetContent — image & gif placeholders", () => {
  const noClipboard = () => "";

  // ── Plain text mode ───────────────────────────────────────────────────────

  it("replaces {{image:id}} with '[image]' in plain text mode", () => {
    const result = processSnippetContent(
      "See: {{image:abc123}}",
      false,
      noClipboard
    );
    expect(result.content).toBe("See: [image]");
  });

  it("replaces multiple {{image:id}} placeholders in plain text mode", () => {
    const result = processSnippetContent(
      "{{image:aaa}} and {{image:bbb}}",
      false,
      noClipboard
    );
    expect(result.content).toBe("[image] and [image]");
  });

  it("replaces {{gif:id}} with default Giphy URL in plain text mode", () => {
    const result = processSnippetContent(
      "GIF: {{gif:abc123}}",
      false,
      noClipboard
    );
    expect(result.content).toContain("abc123");
    expect(result.content).toContain("giphy.com");
  });

  it("uses custom resolveGif in plain text mode", () => {
    const result = processSnippetContent(
      "{{gif:myId}}",
      false,
      noClipboard,
      undefined,
      (id) => `https://example.com/${id}.gif`
    );
    expect(result.content).toBe("https://example.com/myId.gif");
  });

  // ── HTML mode ─────────────────────────────────────────────────────────────

  it("resolves {{image:id}} to <img src> in HTML mode with resolveMedia", () => {
    const result = processSnippetContent(
      "{{image:abc-123-def}}",
      true,
      noClipboard,
      (_id) => ({ src: "blob:http://localhost/fake-url" })
    );
    expect(result.content).toContain('src="blob:http://localhost/fake-url"');
    expect(result.content).not.toContain("data-clipio-media");
  });

  it("omits image from HTML when resolveMedia returns null", () => {
    const result = processSnippetContent(
      "before {{image:abc-123-def}} after",
      true,
      noClipboard,
      (_id) => null
    );
    expect(result.content).not.toContain("data-clipio-media");
    expect(result.content).not.toContain("<img");
    expect(result.content).toContain("before");
    expect(result.content).toContain("after");
  });

  it("keeps <img src> for GIFs in HTML mode (already resolved by markdownToHtml)", () => {
    const result = processSnippetContent("{{gif:giphy123}}", true, noClipboard);
    expect(result.content).toContain("giphy123");
    expect(result.content).toContain("<img");
  });

  it("passes through without resolveMedia (image left with data-clipio-media attr)", () => {
    const result = processSnippetContent(
      "{{image:abc-123-def}}",
      true,
      noClipboard
      // no resolveMedia
    );
    // Without resolver, the data-clipio-media attribute remains as-is
    expect(result.content).toContain("data-clipio-media");
  });

  it("existing tests remain backward compatible (no resolveMedia/Gif args)", () => {
    const result = processSnippetContent("**bold**", true, noClipboard);
    expect(result.content).toBe("<strong>bold</strong>");
  });

  // ── Image-only snippet guard (content.ts line 517) ────────────────────────
  // The fix changes the guard from `!getPlainTextFromHtml(processedContent)`
  // (which is true for image-only HTML) to `!processedContent?.trim()`.
  // These tests verify that processSnippetContent returns a non-empty HTML
  // string for image-only snippets so the guard passes.
  // Note: markdownInlineToHtml matches {{image:<uuid>}} where uuid is [a-f0-9-]+.

  it("returns non-empty HTML string for image-only snippet (guard must not drop it)", () => {
    const result = processSnippetContent(
      "{{image:abc123de-fa01-4567-89ab-cdef01234567}}",
      true,
      noClipboard,
      (_id) => ({ src: "data:image/png;base64,abc==" })
    );
    // The HTML string itself must be non-empty — the fixed guard checks this
    expect(result.content.trim()).not.toBe("");
    expect(result.content).toContain("<img");
  });

  it("resolved image-only snippet HTML contains the data URL src", () => {
    const dataUrl = "data:image/png;base64,iVBOR==";
    const result = processSnippetContent(
      "{{image:abc123de-fa01-4567-89ab-cdef01234567}}",
      true,
      noClipboard,
      (_id) => ({ src: dataUrl })
    );
    expect(result.content).toContain(`src="${dataUrl}"`);
  });

  // spec: width suffix in placeholder is preserved in the resolved <img> style
  it("preserves image width in HTML mode when placeholder has a width suffix", () => {
    const result = processSnippetContent(
      "{{image:abc123de-fa01-4567-89ab-cdef01234567:320}}",
      true,
      noClipboard,
      (_id) => ({ src: "blob:http://localhost/fake-url" })
    );
    expect(result.content).toContain("width:320px");
    expect(result.content).toContain('src="blob:http://localhost/fake-url"');
  });

  // spec: image without width suffix still gets max-width:100% fallback style
  it("applies default max-width style when image placeholder has no width suffix", () => {
    const result = processSnippetContent(
      "{{image:abc123de-fa01-4567-89ab-cdef01234567}}",
      true,
      noClipboard,
      (_id) => ({ src: "blob:http://localhost/fake-url" })
    );
    expect(result.content).toContain("max-width:100%");
    expect(result.content).not.toContain("width:undefinedpx");
  });

  // spec: alt text from media metadata is injected into <img alt="...">
  it("injects alt text into resolved <img> tag", () => {
    const result = processSnippetContent(
      "{{image:abc123de-fa01-4567-89ab-cdef01234567}}",
      true,
      noClipboard,
      (_id) => ({ src: "blob:http://localhost/fake-url", alt: "My screenshot" })
    );
    expect(result.content).toContain('alt="My screenshot"');
  });

  // spec: double-quotes in alt text are escaped
  it("escapes double quotes in alt text", () => {
    const result = processSnippetContent(
      "{{image:abc123de-fa01-4567-89ab-cdef01234567}}",
      true,
      noClipboard,
      (_id) => ({ src: "blob:http://localhost/fake-url", alt: 'Say "hello"' })
    );
    expect(result.content).toContain("Say &quot;hello&quot;");
  });

  // spec: no alt attribute emitted when alt is absent
  it("omits alt attribute when media has no alt", () => {
    const result = processSnippetContent(
      "{{image:abc123de-fa01-4567-89ab-cdef01234567}}",
      true,
      noClipboard,
      (_id) => ({ src: "blob:http://localhost/fake-url" })
    );
    expect(result.content).not.toContain('alt="');
  });

  // spec: single-quotes in alt are escaped to prevent attribute injection
  it("escapes single quotes in alt text", () => {
    const result = processSnippetContent(
      "{{image:abc123de-fa01-4567-89ab-cdef01234567}}",
      true,
      noClipboard,
      (_id) => ({ src: "blob:http://localhost/fake-url", alt: "it's here" })
    );
    expect(result.content).toContain("it&#39;s here");
    expect(result.content).not.toContain("it's here");
  });

  // spec: < and > in alt are escaped to prevent HTML injection
  it("escapes angle brackets in alt text", () => {
    const result = processSnippetContent(
      "{{image:abc123de-fa01-4567-89ab-cdef01234567}}",
      true,
      noClipboard,
      (_id) => ({
        src: "blob:http://localhost/fake-url",
        alt: "<script>alert(1)</script>",
      })
    );
    expect(result.content).toContain("&lt;script&gt;");
    expect(result.content).not.toContain("<script>");
  });
});

// ---------------------------------------------------------------------------
// escapeHtmlAttr
// ---------------------------------------------------------------------------

describe("escapeHtmlAttr", () => {
  it("escapes double quotes", () => {
    expect(escapeHtmlAttr('say "hi"')).toBe("say &quot;hi&quot;");
  });

  it("escapes single quotes", () => {
    expect(escapeHtmlAttr("it's")).toBe("it&#39;s");
  });

  it("escapes less-than and greater-than", () => {
    expect(escapeHtmlAttr("<b>bold</b>")).toBe("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("escapes ampersands first to prevent double-escaping", () => {
    expect(escapeHtmlAttr("a & b")).toBe("a &amp; b");
  });

  it("returns empty string unchanged", () => {
    expect(escapeHtmlAttr("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(escapeHtmlAttr("hello world")).toBe("hello world");
  });
});
