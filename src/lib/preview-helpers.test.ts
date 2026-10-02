/**
 * Tests for src/lib/preview-helpers.ts
 * spec: specs/snippet-preview.spec.md
 * spec: specs/preview-anchor.spec.md
 * spec: specs/preview-helpers.spec.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fuzzyMatchSnippets,
  calculatePreviewPosition,
  detectPreviewTrigger,
  createPreviewTooltip,
  type ContentSnippet,
  type PreviewSettings,
} from "@/lib/preview-helpers";

// The markdown module is deliberately NOT mocked.
//
// It used to be, with a hand-rolled reimplementation of `markdownToPlainText`
// that handled `**bold**`, `*italic*` and `` `code` `` and nothing else. So the
// preview tests asserted against a simplified stand-in rather than the real
// renderer, and any divergence between the two — a snippet that previews
// differently from how it will actually insert — was invisible here and would
// only show up in a browser.
//
// The real module is pure, needs no browser, and is already covered by
// markdown.test.ts, so letting it run costs nothing and tests the truth.

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

const makeSnippet = (
  overrides: Partial<ContentSnippet> = {}
): ContentSnippet => ({
  id: "test-id",
  shortcut: "/test",
  content: "Test content",
  label: "Test Snippet",
  ...overrides,
});

const makeSettings = (
  overrides: Partial<PreviewSettings> = {}
): PreviewSettings => ({
  enabled: true,
  triggerPrefix: "/",
  keyboardShortcut: "Ctrl+Shift+Space",
  ...overrides,
});

// Mock DOM environment
const mockElement = {
  getBoundingClientRect: vi.fn(() => ({
    left: 100,
    top: 200,
    bottom: 220,
    right: 300,
    width: 200,
    height: 20,
  })),
  value: "test value",
  selectionStart: 0,
  isContentEditable: false,
} as unknown as HTMLInputElement;

// ---------------------------------------------------------------------------
// Caret-measurement stubs
// ---------------------------------------------------------------------------

type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const rect = (
  left: number,
  top: number,
  width: number,
  height: number
): DOMRect =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

/**
 * The caret is measured by laying the text up to the cursor in a hidden mirror
 * and reading a marker span inside it. happy-dom performs no layout, so the
 * three rects involved are stubbed here:
 *
 *   - the control keeps `control`;
 *   - the mirror is laid out at the viewport origin (0,0);
 *   - the marker span sits `caret.x` / `caret.y` px inside that mirror.
 *
 * That makes the helper's output fully determined without a layout engine, while
 * still running the real measurement code — no branch is skipped.
 *
 * The mirror element is captured in `captured.mirror` so a test can assert on
 * the styles it was given. happy-dom's `getComputedStyle` returns empty strings
 * for everything, so `stubControlStyle` is what makes those assertions
 * meaningful: without it the mirror would be built from "" and any assertion
 * about it would pass no matter what the code copied.
 */
type Captured = {
  mirror: HTMLElement | null;
  markerText: string | null;
};

let captured: Captured = { mirror: null, markerText: null };

let disposeRects: () => void = () => {};

const stubRects = (
  control: Rect,
  caret: { x: number; y: number; height: number }
) => {
  captured = { mirror: null, markerText: null };
  const spy = vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element) {
      if (
        this instanceof HTMLInputElement ||
        this instanceof HTMLTextAreaElement
      ) {
        return rect(control.left, control.top, control.width, control.height);
      }
      if (this.tagName === "SPAN") {
        captured.markerText = this.textContent;
        return rect(caret.x, caret.y, 0, caret.height);
      }
      captured.mirror = this as HTMLElement; // the mirror div
      return rect(0, 0, 0, 0); // laid out at the origin
    });
  return () => spy.mockRestore();
};

/**
 * happy-dom reports every computed style as "", so the mirror would be built
 * from empty strings and assertions about it would be decorative. Returning a
 * distinctive set of real values makes "did the code copy this?" observable.
 */
const CONTROL_STYLE = {
  fontFamily: "Inter",
  fontSize: "13px",
  fontStyle: "normal",
  fontWeight: "400",
  fontVariant: "normal",
  lineHeight: "20px",
  letterSpacing: "0.5px",
  textIndent: "0px",
  textTransform: "none",
  tabSize: "4",
  padding: "6px",
  border: "1px solid rgb(0, 0, 0)",
} as unknown as CSSStyleDeclaration;

let disposeStyle: () => void = () => {};

const stubControlStyle = () => {
  const spy = vi
    .spyOn(window, "getComputedStyle")
    .mockReturnValue(CONTROL_STYLE);
  return () => spy.mockRestore();
};

// ---------------------------------------------------------------------------
// fuzzyMatchSnippets tests
// ---------------------------------------------------------------------------

describe("fuzzyMatchSnippets", () => {
  const snippets = [
    makeSnippet({ id: "1", shortcut: "/hello", label: "Hello World" }),
    makeSnippet({ id: "2", shortcut: "/hi", label: "Quick Hi" }),
    makeSnippet({ id: "3", shortcut: "/help", label: "Help Command" }),
  ];

  // spec: empty array → empty map and empty lengths
  it("returns empty array for empty query", () => {
    const result = fuzzyMatchSnippets("", snippets);
    expect(result).toEqual([]);
  });

  it("returns empty array for empty snippets", () => {
    const result = fuzzyMatchSnippets("hello", []);
    expect(result).toEqual([]);
  });

  // spec: exact prefix match on shortcut gets highest score (1000)
  it("prioritizes exact prefix matches on shortcut", () => {
    const result = fuzzyMatchSnippets("/hel", snippets); // Query with prefix
    expect(result).toHaveLength(2);
    expect(result[0].snippet.id).toBe("1"); // "/hello" should rank higher
    expect(result[0].relevanceScore).toBe(1000);
    expect(result[0].highlightRanges).toEqual([
      { start: 0, end: 4, field: "shortcut" }, // Full "/hel" prefix
    ]);
  });

  // spec: fuzzy match scoring and sorting
  it("scores fuzzy matches correctly", () => {
    const result = fuzzyMatchSnippets("/hi", snippets);
    expect(result).toHaveLength(1); // Only "/hi" matches, not "Hi" in label

    // "/hi" exact match should have score 1000
    expect(result[0].snippet.id).toBe("2");
    expect(result[0].relevanceScore).toBe(1000);
  });

  // spec: case-insensitive matching
  it("performs case-insensitive matching", () => {
    const result = fuzzyMatchSnippets("HELLO", snippets); // Match against label
    expect(result).toHaveLength(1);
    expect(result[0].snippet.id).toBe("1");
  });

  // spec: handles special regex characters
  it("handles special regex characters without throwing", () => {
    expect(() => fuzzyMatchSnippets(".*+?^${}()|[]\\", snippets)).not.toThrow();
  });

  // spec: query longer than any snippet field returns empty
  it("returns empty array when query is longer than any field", () => {
    const result = fuzzyMatchSnippets(
      "superlongquerythatdoesntmatchanything",
      snippets
    );
    expect(result).toEqual([]);
  });

  // spec: maintains original order for identical scores
  it("maintains snippet order for identical scores", () => {
    const identicalSnippets = [
      makeSnippet({ id: "1", shortcut: "/test", label: "Test" }),
      makeSnippet({ id: "2", shortcut: "/test", label: "Test" }),
    ];
    const result = fuzzyMatchSnippets("test", identicalSnippets);
    expect(result[0].snippet.id).toBe("1");
    expect(result[1].snippet.id).toBe("2");
  });
});

// ---------------------------------------------------------------------------
// calculatePreviewPosition tests
// ---------------------------------------------------------------------------

describe("calculatePreviewPosition", () => {
  beforeEach(() => {
    // Mock window properties
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      writable: true,
    });
    Object.defineProperty(window, "innerWidth", {
      value: 1200,
      writable: true,
    });
    Object.defineProperty(window, "pageXOffset", { value: 0, writable: true });
    Object.defineProperty(window, "pageYOffset", { value: 0, writable: true });

    // Reset mock
    (mockElement.getBoundingClientRect as any).mockClear();
  });

  afterEach(() => {
    disposeRects();
    disposeStyle();
    // Safety net: this block spies on Element.prototype, which every other
    // suite in the shared happy-dom environment also lays out. If a future test
    // stubs twice without disposing, this still un-installs the spy.
    vi.restoreAllMocks();
    disposeRects = () => {};
    disposeStyle = () => {};
    document.body.innerHTML = "";
  });

  // spec: a real input with a caret offset is anchored to the caret, not to
  // the element's bottom edge.
  it("anchors to the caret rather than the element bottom for a real input", () => {
    const input = document.createElement("input");
    input.value = "/hel";
    document.body.appendChild(input);

    const elRect = rect(100, 200, 400, 260);
    // A one-line marker: its bottom sits on the caret's baseline.
    const caret = { x: 18, y: 9, height: 14 };
    disposeRects = stubRects(elRect, caret);

    const result = calculatePreviewPosition(input, 4);

    // caret top-left = element top-left + (caret − mirror) inside the mirror.
    expect(result.x).toBe(elRect.left + caret.x);
    expect(result.y).toBe(elRect.top + caret.y + caret.height + 5);

    // The regression this pins: the palette must not be pinned to the field's
    // bottom edge, which is what a lost cursorPos produced.
    expect(result.y).toBeLessThan(elRect.bottom);
  });

  // spec: a scrolled textarea reports the caret at its *visible* line.
  it("offsets the caret by scrollTop and scrollLeft of a scrolled field", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "first line\n/second line\nthird";
    textarea.scrollTop = 40;
    textarea.scrollLeft = 7;
    document.body.appendChild(textarea);

    const elRect = rect(100, 200, 400, 260);
    disposeRects = stubRects(elRect, { x: 30, y: 20, height: 14 });

    const result = calculatePreviewPosition(textarea, 19);

    expect(result.x).toBe(elRect.left + 30 - 7);
    expect(result.y).toBe(elRect.top + 20 + 14 - 40 + 5);
  });

  // spec: preview-anchor — the mirror reproduces the control's metrics, so a
  // caret measured in the mirror lands in the same place as in the real field.
  it("reproduces the control's text metrics and box on the mirror", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "/hel";
    document.body.appendChild(textarea);
    Object.defineProperty(textarea, "offsetWidth", { value: 321 });

    const elRect = rect(100, 200, 400, 260);
    disposeRects = stubRects(elRect, { x: 24, y: 16, height: 14 });
    disposeStyle = stubControlStyle();

    calculatePreviewPosition(textarea, 4);

    const mirror = captured.mirror;
    expect(mirror).not.toBeNull();
    const css = mirror!.style;

    // Metrics that change glyph advance or line breaking. A missing one makes
    // the mirror wrap on different columns than the control.
    for (const prop of [
      "fontFamily",
      "fontSize",
      "fontStyle",
      "fontWeight",
      "fontVariant",
      "lineHeight",
      "letterSpacing",
      "textIndent",
      "textTransform",
      "tabSize",
      "padding",
      "border",
    ] as const) {
      expect(`${prop}=${css[prop]}`).toBe(`${prop}=${CONTROL_STYLE[prop]}`);
    }

    // border-box + the control's border-box width makes the mirror's *content*
    // box the same width as the control's, so wrapping columns line up.
    expect(css.boxSizing).toBe("border-box");
    expect(css.width).toBe("321px");

    // The mirror's own setup. `white-space: pre-wrap` is what makes the mirror
    // wrap exactly like a textarea; `pre` would never wrap and report a caret
    // on the first line for text that is on its third.
    expect(css.whiteSpace).toBe("pre-wrap");
    expect(css.wordWrap).toBe("break-word");
    expect(css.overflowWrap).toBe("break-word");

    // Hidden and out of flow, pinned to the viewport origin so it never depends
    // on — or perturbs — the page's own layout.
    expect(css.position).toBe("absolute");
    expect(css.visibility).toBe("hidden");
    expect(css.top).toBe("0px");
    expect(css.left).toBe("0px");
  });

  // spec: preview-anchor — the mirror holds only the text up to the caret, and
  // the caret itself is marked by a zero-width character. A visible "|" glyph
  // has a non-zero advance and would wrap at the wrap column, reporting the
  // caret a whole line too low; laying out the whole value would make the
  // measurement depend on text the user has not typed yet.
  it("lays out only the text up to the caret, marked zero-width", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "/hel and more text that is past the caret";
    document.body.appendChild(textarea);

    const elRect = rect(100, 200, 400, 260);
    disposeRects = stubRects(elRect, { x: 24, y: 16, height: 14 });
    disposeStyle = stubControlStyle();

    calculatePreviewPosition(textarea, 4);

    expect(captured.mirror?.textContent).toBe("/hel\u200b");
    expect(captured.markerText).toBe("\u200b");
  });

  // spec: element-bounds fallback still applies when no caret offset is given.
  it("falls back to element bounds when cursorPos is omitted", () => {
    const input = document.createElement("input");
    input.value = "/hel";
    document.body.appendChild(input);

    const elRect = rect(100, 200, 400, 260);
    disposeRects = stubRects(elRect, { x: 18, y: 9, height: 14 });

    const result = calculatePreviewPosition(input);

    expect(result.x).toBe(elRect.left);
    expect(result.y).toBe(elRect.bottom + 5);
  });

  // spec: positions above cursor when insufficient space below
  //
  // Uses a real <textarea> on purpose. The previous version of this test passed
  // a plain object literal, which is neither an input nor contenteditable, so
  // calculatePreviewPosition returned its safe fallback and the mocked rect was
  // never read — the "flip above" branch was never executed.
  it("positions preview above cursor when insufficient space below", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "/hel";
    document.body.appendChild(textarea);

    // Caret at y=660 in an 800px viewport: 140px below, 660px above.
    disposeRects = stubRects(rect(100, 620, 400, 120), {
      x: 18,
      y: 40,
      height: 14,
    });
    disposeStyle = stubControlStyle();

    const result = calculatePreviewPosition(textarea, 4);

    const caretY = 620 + 40 + 14; // 674
    // Flipped: sits above the caret, sized to the space above it.
    expect(result.maxHeight).toBe(caretY - 25);
    expect(result.y).toBe(caretY - (caretY - 25) - 5);
    expect(result.y).toBeLessThan(caretY);
  });

  // spec: clamps horizontal position to viewport bounds (with 10px margin)
  it("clamps horizontal position to viewport bounds", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "/hel";
    document.body.appendChild(textarea);

    disposeStyle = stubControlStyle();

    // Near the right edge in a 1200px viewport: clamped to viewport − 320 − 10.
    disposeRects = stubRects(rect(100, 200, 400, 260), {
      x: 1150,
      y: 9,
      height: 14,
    });
    expect(calculatePreviewPosition(textarea, 4).x).toBe(890);

    // Left of the viewport: clamped to the 10px margin, not a negative offset.
    // caret.x is relative to the field, so −200 puts the caret 100px off-screen.
    disposeRects();
    disposeRects = stubRects(rect(100, 200, 400, 260), {
      x: -200,
      y: 9,
      height: 14,
    });
    expect(calculatePreviewPosition(textarea, 4).x).toBe(10);
  });

  // spec: returns safe fallback for invalid elements
  it("returns safe fallback position for invalid elements", () => {
    const invalidElement = {} as HTMLElement;
    const result = calculatePreviewPosition(invalidElement, 5);
    expect(result).toEqual({ x: 10, y: 10, maxHeight: 300 });
  });

  // spec: handles contenteditable elements
  it("handles contenteditable elements", () => {
    const editableElement = {
      ...mockElement,
      isContentEditable: true,
      getBoundingClientRect: mockElement.getBoundingClientRect,
    } as unknown as HTMLElement;

    // Mock getSelection
    const mockRange = {
      getBoundingClientRect: () => ({ left: 150, bottom: 250 }),
    };
    const mockSelection = {
      rangeCount: 1,
      getRangeAt: () => mockRange,
    };
    Object.defineProperty(window, "getSelection", {
      value: () => mockSelection,
      writable: true,
    });

    const result = calculatePreviewPosition(editableElement);
    expect(result.x).toBe(150);
    expect(result.y).toBeGreaterThan(250);
  });
});

// ---------------------------------------------------------------------------
// detectPreviewTrigger tests
// ---------------------------------------------------------------------------

describe("detectPreviewTrigger", () => {
  const settings = makeSettings();

  // spec: returns null when preview is disabled
  it("returns null when preview is disabled", () => {
    const disabledSettings = makeSettings({ enabled: false });
    const result = detectPreviewTrigger("Hello /wor", 9, disabledSettings);
    expect(result).toBeNull();
  });

  // spec: detects prefix at start of text (no word boundary required)
  it("matches shortcut at start of text", () => {
    const result = detectPreviewTrigger("/hello", 6, settings);
    expect(result).not.toBeNull();
    expect(result!.startPos).toBe(0);
    expect(result!.endPos).toBe(6);
    expect(result!.query).toBe("hello");
  });

  // spec: requires word boundary before prefix
  it("requires word boundary before prefix", () => {
    const result = detectPreviewTrigger("email/test", 10, settings);
    expect(result).toBeNull(); // No word boundary before "/"
  });

  it("matches prefix after space (word boundary)", () => {
    const result = detectPreviewTrigger("Hello /wor", 10, settings);
    expect(result).not.toBeNull();
    expect(result!.startPos).toBe(6);
    expect(result!.endPos).toBe(10);
    expect(result!.query).toBe("wor");
  });

  // spec: matches prefix after newline (word boundary)
  it("matches prefix after newline", () => {
    const result = detectPreviewTrigger("Hello\n/test", 11, settings);
    expect(result).not.toBeNull();
    expect(result!.startPos).toBe(6);
    expect(result!.query).toBe("test");
  });

  // spec: returns rightmost prefix when multiple exist
  it("returns rightmost prefix when multiple exist", () => {
    const result = detectPreviewTrigger("/first /second", 14, settings);
    expect(result).not.toBeNull();
    expect(result!.startPos).toBe(7); // Second occurrence
    expect(result!.query).toBe("second");
  });

  // spec: returns null when cursor is at position 0
  it("returns null when cursor is at position 0", () => {
    const result = detectPreviewTrigger("/hello", 0, settings);
    expect(result).toBeNull();
  });

  // spec: handles empty prefix (always triggers when enabled)
  it("handles empty prefix by always triggering", () => {
    const emptyPrefixSettings = makeSettings({ triggerPrefix: "" });
    const result = detectPreviewTrigger("hello world", 5, emptyPrefixSettings);
    expect(result).not.toBeNull();
    expect(result!.startPos).toBe(0);
    expect(result!.endPos).toBe(5);
    expect(result!.query).toBe("hello");
  });

  // spec: returns null for empty text
  it("returns null for empty text", () => {
    const result = detectPreviewTrigger("", 0, settings);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createPreviewTooltip tests
// ---------------------------------------------------------------------------

describe("createPreviewTooltip", () => {
  // spec: truncates content to ~100 characters at word boundary
  it("truncates long content at word boundary", () => {
    const longContent =
      "This is a very long snippet content that should be truncated properly at a word boundary near 100 characters to provide a good preview experience.";
    const result = createPreviewTooltip(longContent);

    expect(result.length).toBeLessThanOrEqual(103); // ~100 + "..."
    expect(result.endsWith("...")).toBe(true);
    expect(result.lastIndexOf(" ")).toBeGreaterThan(50); // Truncated at word boundary
  });

  // spec: removes placeholder tokens from display
  it("removes placeholder tokens", () => {
    const content =
      "Hello {{clipboard}} - today is {{date:iso}} and {{cursor}} here!";
    const result = createPreviewTooltip(content);
    expect(result).toBe("Hello - today is and here!");
  });

  // spec: strips markdown formatting
  it("strips markdown formatting", () => {
    // Expectations are the real renderer's, not a stand-in's. This test used to
    // run against a hand-rolled `markdownToPlainText` mock that also stripped
    // `*italic*`, which Clipio does not: its emphasis marker is `_italic_`, so
    // `*text*` is literal. The mock and this expectation were wrong together,
    // and the pair hid it.
    const content = "Hello **world**! This is _italic_ and `code`.";
    const result = createPreviewTooltip(content);
    expect(result).toBe("Hello world! This is italic and code.");
  });

  it("leaves a single-asterisk span alone, because _ is the emphasis marker", () => {
    // Pins the divergence that the mock introduced, so it cannot come back.
    const result = createPreviewTooltip("a *b* c");
    expect(result).toBe("a *b* c");
  });

  // spec: normalizes whitespace
  it("normalizes whitespace", () => {
    const content = "Hello    world\n\n\nwith   lots\tof\r\nwhitespace!";
    const result = createPreviewTooltip(content);
    expect(result).toBe("Hello world with lots of whitespace!");
  });

  // spec: returns "(empty snippet)" for empty or whitespace-only content
  it('returns "(empty snippet)" for empty content', () => {
    expect(createPreviewTooltip("")).toBe("(empty snippet)");
    expect(createPreviewTooltip("   ")).toBe("(empty snippet)");
    expect(createPreviewTooltip("\n\t\r")).toBe("(empty snippet)");
  });

  it('returns "(empty snippet)" for content with only placeholders', () => {
    const result = createPreviewTooltip(
      "{{clipboard}} {{date:iso}} {{cursor}}"
    );
    expect(result).toBe("(empty snippet)");
  });

  // spec: content under 100 chars returns as-is (no ellipsis)
  it("returns short content without ellipsis", () => {
    const shortContent = "This is a short snippet.";
    const result = createPreviewTooltip(shortContent);
    expect(result).toBe("This is a short snippet.");
    expect(result.endsWith("...")).toBe(false);
  });

  // spec: handles very long first word by truncating at character boundary
  it("handles very long first word", () => {
    const content =
      "Supercalifragilisticexpialidocioussuperlongwordthatcannotbetruncatedatwordboundaryverylongwordindeed and more text that will definitely exceed the 100 character limit";
    const result = createPreviewTooltip(content);
    expect(result.length).toBeLessThanOrEqual(103);
    expect(result.endsWith("...")).toBe(true);
  });

  // NOTE: this file used to end with a "handles markdown processing errors
  // gracefully" test that mocked `markdownToPlainText` into throwing. It has
  // been removed rather than reworked.
  //
  // The fallback it covered is real — `createPreviewTooltip` does catch and
  // return "(content preview unavailable)" — but the only way to reach it was to
  // make the mocked module throw. `markdownToPlainText` is a pure, total
  // function over a string, so with the real module that branch is unreachable
  // from a test. Keeping a mock purely to throw would test the mock, which is
  // the thing this wave is removing.
  //
  // The branch is recorded here rather than silently left uncovered: if
  // `markdownToPlainText` ever grows a failure mode, this is the test that
  // should be written to reach it.
});
