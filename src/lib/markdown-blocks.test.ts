import { describe, it, expect } from "vitest";

import { markdownToHtmlWithBlocks } from "./markdown-blocks";
import { markdownToHtml } from "./markdown";

/**
 * The bug: `markdownToHtml` converted one line at a time and joined with `<br>`,
 * so `**bold**` rendered while `# Heading`, `- item` and `> quote` were inserted
 * as literal characters. The output was still valid escaped HTML, so nothing
 * failed — the marks simply arrived on the page.
 *
 * These tests pin both halves of the contract:
 *
 *  1. block constructs become real elements
 *  2. everything else is unchanged, because a snippet written as `first\nsecond`
 *     is two lines of one paragraph and must stay two lines
 */

describe("markdownToHtmlWithBlocks — block constructs", () => {
  it("renders an ATX heading as a heading, not literal #'s", () => {
    const html = markdownToHtmlWithBlocks("# Heading");
    expect(html).toBe("<h1>Heading</h1>");
    // The specific regression: the marker must not survive into the output.
    expect(html).not.toContain("#");
  });

  it("renders every heading level", () => {
    for (let level = 1; level <= 6; level++) {
      const hashes = "#".repeat(level);
      expect(markdownToHtmlWithBlocks(`${hashes} Title`)).toBe(
        `<h${level}>Title</h${level}>`
      );
    }
  });

  it("applies inline formatting inside a heading", () => {
    expect(markdownToHtmlWithBlocks("## **bold** title")).toBe(
      "<h2><strong>bold</strong> title</h2>"
    );
  });

  it("does not treat a hash without a space as a heading", () => {
    // CommonMark requires the space, and so does every real Markdown renderer.
    // Without this check, `#hashtag` becomes an empty heading.
    expect(markdownToHtmlWithBlocks("#hashtag")).toContain("#hashtag");
  });

  it("renders a run of unordered items as one list", () => {
    expect(markdownToHtmlWithBlocks("- first item\n- second item")).toBe(
      "<ul><li>first item</li><li>second item</li></ul>"
    );
  });

  it("accepts all three unordered markers", () => {
    for (const marker of ["-", "*", "+"]) {
      expect(markdownToHtmlWithBlocks(`${marker} item`)).toBe(
        "<ul><li>item</li></ul>"
      );
    }
  });

  it("renders a run of ordered items as one list", () => {
    expect(markdownToHtmlWithBlocks("1. one\n2. two")).toBe(
      "<ol><li>one</li><li>two</li></ol>"
    );
  });

  it("accepts a closing paren on an ordered item", () => {
    expect(markdownToHtmlWithBlocks("1) one")).toBe("<ol><li>one</li></ol>");
  });

  it("does not merge an ordered and an unordered run into one list", () => {
    // Rendering `- a` then `1. b` as one list would reorder the content.
    const html = markdownToHtmlWithBlocks("- a\n1. b");
    expect(html).toContain("<ul><li>a</li></ul>");
    expect(html).toContain("<ol><li>b</li></ol>");
  });

  it("applies inline formatting inside a list item", () => {
    expect(markdownToHtmlWithBlocks("- **bold** item")).toBe(
      "<ul><li><strong>bold</strong> item</li></ul>"
    );
  });

  it("renders a blockquote, dropping the marker", () => {
    expect(markdownToHtmlWithBlocks("> a blockquote")).toBe(
      "<blockquote>a blockquote</blockquote>"
    );
  });

  it("keeps a multi-line blockquote as one quote with a line break", () => {
    expect(markdownToHtmlWithBlocks("> first\n> second")).toBe(
      "<blockquote>first<br>second</blockquote>"
    );
  });

  it("applies inline formatting inside a blockquote", () => {
    expect(markdownToHtmlWithBlocks("> **bold** quote")).toBe(
      "<blockquote><strong>bold</strong> quote</blockquote>"
    );
  });

  it("renders a fenced code block verbatim, without inline conversion", () => {
    // Converting `**` inside a fence would be wrong: it is literal text there.
    expect(markdownToHtmlWithBlocks("```\nconst a = **not bold**;\n```")).toBe(
      "<pre><code>const a = **not bold**;</code></pre>"
    );
  });

  it("escapes HTML inside a fenced code block", () => {
    // The one place raw `<` must not become a tag: a snippet can legitimately
    // contain code, and `<script>` in it must not execute.
    expect(markdownToHtmlWithBlocks("```\n<b>hi</b>\n```")).toBe(
      "<pre><code>&lt;b&gt;hi&lt;/b&gt;</code></pre>"
    );
  });

  it("tags the fence language when one is given", () => {
    expect(markdownToHtmlWithBlocks("```ts\nconst a = 1;\n```")).toBe(
      '<pre><code class="language-ts">const a = 1;</code></pre>'
    );
  });

  it("closes an unterminated fence at the end of input", () => {
    // Truncated content must not swallow the rest of the document or throw.
    expect(markdownToHtmlWithBlocks("```\nunclosed")).toBe(
      "<pre><code>unclosed</code></pre>"
    );
  });
});

describe("markdownToHtmlWithBlocks — mixed content", () => {
  it("renders the whole kitchen sink without leaking a single marker", () => {
    // Taken from samples/clipio-export.json, which is what surfaced the bug.
    const markdown = [
      "# Heading",
      "",
      "Some **bold**, some _italic_, and `inline code`.",
      "",
      "- first item",
      "- second item",
      "",
      "> a blockquote",
      "",
      "1. one",
      "2. two",
      "",
      "[Clipio](https://clipio.xyz)",
    ].join("\n");

    const html = markdownToHtmlWithBlocks(markdown);

    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<ul><li>first item</li><li>second item</li></ul>");
    expect(html).toContain("<blockquote>a blockquote</blockquote>");
    expect(html).toContain("<ol><li>one</li><li>two</li></ol>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>inline code</code>");
    expect(html).toContain('href="https://clipio.xyz"');

    // No block marker may survive. This is the assertion that would have caught
    // the original bug.
    expect(html).not.toMatch(/^# Heading/m);
    expect(html).not.toContain("- first item");
    expect(html).not.toContain("> a blockquote");
  });

  it("does not insert a <br> next to a block element", () => {
    // `<br>` immediately before or after a heading or list is visible as a blank
    // line in the target field.
    const html = markdownToHtmlWithBlocks("intro\n# Heading\noutro");
    expect(html).not.toContain("<br><h1>");
    expect(html).not.toContain("</h1><br>");
    expect(html).toContain("intro");
    expect(html).toContain("outro");
  });

  it("still joins plain lines with <br>", () => {
    expect(markdownToHtmlWithBlocks("Line 1\nLine 2")).toBe("Line 1<br>Line 2");
  });
});

// ---------------------------------------------------------------------------
// The two functions must not diverge on content with no block syntax
// ---------------------------------------------------------------------------

describe("markdownToHtmlWithBlocks — parity with markdownToHtml", () => {
  const PLAIN = [
    "Hello world",
    "Line 1\nLine 2",
    "A\nB\nC",
    "Some **bold** and _italic_ text",
    "A link: [Clipio](https://clipio.xyz)",
    "Trailing {{cursor}} placeholder",
    "",
    "   ",
    "100% of the time",
    "a-b and c_d and 2+2",
    "<script>alert(1)</script>",
    "Ünïcödé — em dash, ellipsis…",
  ];

  for (const input of PLAIN) {
    it(`matches the old line-by-line behaviour for ${JSON.stringify(input)}`, () => {
      // Content with no block syntax must render exactly as it did before. If
      // these ever diverge, an existing snippet changes appearance on upgrade —
      // which is the regression this split is most likely to cause.
      expect(markdownToHtmlWithBlocks(input)).toBe(markdownToHtml(input));
    });
  }

  it("returns an empty string for empty input", () => {
    expect(markdownToHtmlWithBlocks("")).toBe("");
  });
});
