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
    // Blank-only documents. `joinWithBreaks` used `result === ""` to mean "nothing
    // emitted yet", which is not the same thing: with every part empty, `result`
    // stayed empty after every iteration, no `<br>` was ever written, and `"\n"`
    // rendered as `""`. A snippet of only blank lines then inserted nothing and
    // the caller skipped it as empty. These were absent from this list, which is
    // why a suite built to catch exactly this divergence could not see it.
    "\n",
    "\n ",
    "\n\n",
    "\n\n\n",
    "\t\n",
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

describe("blank lines between blocks", () => {
  it("does not put a <br> between two blocks separated by a blank line", () => {
    // The regression: an empty part is not a block, so the guard added a <br>
    // next to whichever block bordered it.
    expect(markdownToHtmlWithBlocks("# H\n\nbody")).toBe("<h1>H</h1>body");
    expect(markdownToHtmlWithBlocks("intro\n\n# H\n\noutro")).toBe(
      "intro<h1>H</h1>outro"
    );
  });

  it("does not treat a whitespace-only line as blank", () => {
    // The half-applied version of this fix: only a literally empty part was
    // skipped, so a line holding a space or a tab still put a `<br>` next to the
    // block, plus a stray whitespace text node in the user's document.
    expect(markdownToHtmlWithBlocks("# H\n \nbody")).toBe("<h1>H</h1>body");
    expect(markdownToHtmlWithBlocks("# H\n\t\nbody")).toBe("<h1>H</h1>body");
    expect(markdownToHtmlWithBlocks("body\n \n# H")).toBe("body<h1>H</h1>");
  });

  it("keeps a blank line between two plain lines", () => {
    // The other half. Away from a block a blank line is content — the paragraph
    // break the user typed. Dropping it collapsed their spacing, which is a
    // regression rather than a fix.
    expect(markdownToHtmlWithBlocks("one\n\ntwo")).toBe("one<br><br>two");
  });

  it("drops leading and trailing blank lines", () => {
    expect(markdownToHtmlWithBlocks("\n\nbody\n\n")).toBe("body");
  });
});

describe("fenced code closing", () => {
  it("does not close on a body line that starts with an info string", () => {
    // The regression: `startsWith(marker)` closed here, so the rest of the code
    // leaked out and rendered as live markdown.
    const html = markdownToHtmlWithBlocks(
      "```js\nconst a = 1;\n```js is not a fence\nconst b = 2;\n```"
    );
    expect(html).toContain("const a = 1;");
    expect(html).toContain("const b = 2;");
    expect(html).toContain("```js is not a fence");
    // The whole body stayed inside the one <pre>, and nothing leaked as markup.
    expect(html.match(/<pre>/g)).toHaveLength(1);
    expect(html.endsWith("</code></pre>")).toBe(true);
  });

  it("does not close on a marker of a different character", () => {
    // A ~-delimited fence is not closed by ``` and vice versa.
    //
    // Shaped so this actually discriminates. `startsWith` happened to get it right,
    // and an implementation that checks only the marker *length* closes on these —
    // so the body marker is longer than the opener, and a line of real code
    // follows it. Without that trailing line both implementations produce the same
    // string and the test proves nothing. The previous version of this fixture had
    // exactly that problem.
    expect(markdownToHtmlWithBlocks("```\n~~~~\nstill code\n```")).toBe(
      "<pre><code>~~~~\nstill code</code></pre>"
    );
    expect(markdownToHtmlWithBlocks("~~~\n````\nstill code\n~~~")).toBe(
      "<pre><code>````\nstill code</code></pre>"
    );
  });

  it("does not close on a shorter marker of the same character", () => {
    // CommonMark: the closing fence must be at least as long as the opener.
    expect(markdownToHtmlWithBlocks("````\n```\ninner\n```\n````")).toBe(
      "<pre><code>```\ninner\n```</code></pre>"
    );
  });

  it("closes on a longer marker of the same character", () => {
    const html = markdownToHtmlWithBlocks("```\nbody\n`````");
    expect(html).toBe("<pre><code>body</code></pre>");
  });

  it("treats an unterminated fence as running to the end", () => {
    const html = markdownToHtmlWithBlocks("```\nnever closed\n**bold**");
    expect(html).toContain("**bold**");
    expect(html).toBe("<pre><code>never closed\n**bold**</code></pre>");
  });
});

describe("line endings", () => {
  /**
   * Every block construct, checked against CRLF.
   *
   * A CRLF line ended in `\r`, and every pattern here ends in `$` while JS `.`
   * does not match `\r` — so a CRLF heading matched *nothing* and rendered as the
   * literal text `# H` plus a stray carriage return. Worse, a CRLF list demoted
   * its first item out of the list, so the user's own bullet became visible text.
   * The whole suite was green because every fixture used `\n`.
   *
   * Parity against the `\n` form is the assertion, rather than a handful of
   * expected strings: it holds for constructs added later without anyone
   * remembering to write a second fixture.
   */
  const CONSTRUCTS: [string, string][] = [
    ["heading", "# Heading\n\nbody"],
    ["bullet list", "- one\n- two"],
    ["star list", "* one\n* two"],
    ["plus list", "+ one\n+ two"],
    ["ordered list", "1. one\n2. two"],
    ["ordered, paren", "1) one\n2) two"],
    ["blockquote", "> quoted"],
    ["two-line quote", "> one\n> two"],
    ["fenced code", "```js\ncode\n```"],
    ["tilde fence", "~~~\ncode\n~~~"],
    ["mixed", "intro\n\n# H\n\n- a\n- b\n\n> q\n\noutro"],
    ["plain lines", "one\ntwo\nthree"],
    ["blank between plain", "one\n\ntwo"],
  ];

  for (const [name, lf] of CONSTRUCTS) {
    it(`renders ${name} identically from CRLF`, () => {
      expect(markdownToHtmlWithBlocks(lf.replace(/\n/g, "\r\n"))).toBe(
        markdownToHtmlWithBlocks(lf)
      );
    });
  }

  it("renders a CRLF bullet list as a list, not as literal text", () => {
    // The damaging case, asserted directly: the first item must be inside the
    // <ul>, or the user's own bullet character reaches their document.
    const html = markdownToHtmlWithBlocks("- one\r\n- two");
    expect(html).toBe("<ul><li>one</li><li>two</li></ul>");
  });

  it("normalises a lone CR", () => {
    // Old Mac line endings. Rare, but free to handle and the same defect.
    expect(markdownToHtmlWithBlocks("# H\rbody")).toBe(
      markdownToHtmlWithBlocks("# H\nbody")
    );
  });
});

describe("block boundaries never take a stray <br>", () => {
  /**
   * `isBlockElement` is module-private, so it cannot be tested directly — and its
   * failure mode is a stray `<br>` in the user's field, which is exactly the kind
   * of drift nobody notices until a user screenshots it.
   *
   * So it is pinned through the public function instead, over *every* construct
   * the renderer can emit rather than just the heading. Adding a new block type
   * without adding it to `isBlockElement` fails here.
   */
  const WITH_BEFORE: [string, string][] = [
    ["heading", "# H\nafter"],
    ["bullet list", "- a\nafter"],
    ["ordered list", "1. a\nafter"],
    ["blockquote", "> q\nafter"],
    ["fenced code", "```\ncode\n```\nafter"],
  ];
  const WITH_AFTER: [string, string][] = [
    ["heading", "before\n# H"],
    ["bullet list", "before\n- a"],
    ["ordered list", "before\n1. a"],
    ["blockquote", "before\n> q"],
    ["fenced code", "before\n```\ncode\n```"],
  ];

  for (const [name, input] of WITH_BEFORE) {
    it(`does not put a <br> after a ${name}`, () => {
      // Asserted through the whole output rather than by searching for
      // `</h1><br>`: the block may close with any of five tags, and a check that
      // only names one of them would pass while the other four drifted.
      expect(markdownToHtmlWithBlocks(input)).not.toContain("<br>");
    });
  }

  for (const [name, input] of WITH_AFTER) {
    it(`does not put a <br> before a ${name}`, () => {
      expect(markdownToHtmlWithBlocks(input)).not.toContain("<br>");
    });
  }

  it("still breaks between two plain lines", () => {
    // The control. Without it, "no <br>" would be satisfied by a renderer that
    // dropped every line break — the opposite defect.
    expect(markdownToHtmlWithBlocks("one\ntwo")).toBe("one<br>two");
  });
});
