/**
 * Tests for src/lib/html-to-markdown.ts
 * spec: specs/content-format-migration.spec.md
 *
 * This converter runs in every extension context, including the MV3 service
 * worker, so it must not touch the DOM. It is a single code path used
 * everywhere: behaviour differing by context would make a snippet convert
 * differently depending on who read it first.
 */

import { describe, it, expect } from "vitest";
import { htmlToMarkdownPortable, decodeEntities } from "./html-to-markdown";

describe("decodeEntities", () => {
  it("decodes a named entity", () => {
    expect(decodeEntities("a &amp; b")).toBe("a & b");
  });

  it("decodes a decimal numeric entity", () => {
    expect(decodeEntities("&#169;")).toBe("©");
  });

  it("decodes a hex numeric entity", () => {
    expect(decodeEntities("&#x2014;")).toBe("—");
  });

  it("leaves an unknown entity alone rather than mangling it", () => {
    expect(decodeEntities("&notarealentity;")).toBe("&notarealentity;");
  });

  it("decodes nbsp to a normal space", () => {
    expect(decodeEntities("a&nbsp;b")).toBe("a b");
  });

  it("ignores an out-of-range code point", () => {
    expect(decodeEntities("&#999999999;")).toBe("");
  });
});

describe("htmlToMarkdownPortable — blocks", () => {
  it("returns empty for empty input", () => {
    expect(htmlToMarkdownPortable("")).toBe("");
  });

  it("returns empty for whitespace-only input", () => {
    expect(htmlToMarkdownPortable("   \n  ")).toBe("");
  });

  it("separates paragraphs with a blank line", () => {
    expect(htmlToMarkdownPortable("<p>one</p><p>two</p>")).toBe("one\n\ntwo");
  });

  it("separates divs", () => {
    expect(htmlToMarkdownPortable("<div>one</div><div>two</div>")).toBe(
      "one\n\ntwo"
    );
  });

  it("keeps a heading's text and drops the tag", () => {
    expect(htmlToMarkdownPortable("<h2>Title</h2>")).toBe("Title");
  });

  it("collapses more than two blank lines", () => {
    const out = htmlToMarkdownPortable("<p>a</p><p></p><p></p><p></p><p>b</p>");
    expect(out).not.toContain("\n\n\n");
  });

  it("preserves inline text without a block", () => {
    expect(htmlToMarkdownPortable("plain text")).toBe("plain text");
  });
});

describe("htmlToMarkdownPortable — inline marks", () => {
  it("converts strong to bold", () => {
    expect(htmlToMarkdownPortable("<strong>x</strong>")).toBe("**x**");
  });

  it("converts b to bold", () => {
    expect(htmlToMarkdownPortable("<b>x</b>")).toBe("**x**");
  });

  it("converts em to italic", () => {
    expect(htmlToMarkdownPortable("<em>x</em>")).toBe("_x_");
  });

  it("converts i to italic", () => {
    expect(htmlToMarkdownPortable("<i>x</i>")).toBe("_x_");
  });

  it("converts del to strikethrough", () => {
    expect(htmlToMarkdownPortable("<del>x</del>")).toBe("~~x~~");
  });

  it("converts code to backticks", () => {
    expect(htmlToMarkdownPortable("<code>x</code>")).toBe("`x`");
  });

  it("converts underline to plain text (markdown has no underline)", () => {
    expect(htmlToMarkdownPortable("<u>x</u>")).toBe("x");
  });

  it("nests bold and italic", () => {
    const out = htmlToMarkdownPortable("<strong><em>x</em></strong>");
    expect(out).toContain("**");
    expect(out).toContain("_");
  });

  it("does not lose content when a mark is never closed", () => {
    const out = htmlToMarkdownPortable("<strong>unclosed text");
    expect(out).toContain("unclosed text");
  });

  it("unwinds a mismatched nesting without swallowing the rest", () => {
    // </strong> closing an <em> must not discard the trailing text.
    const out = htmlToMarkdownPortable("<em><strong>x</em>tail");
    expect(out).toContain("tail");
  });
});

describe("htmlToMarkdownPortable — links", () => {
  it("converts a link with a double-quoted href", () => {
    expect(htmlToMarkdownPortable('<a href="https://x.test">link</a>')).toBe(
      "[link](https://x.test)"
    );
  });

  it("converts a link with a single-quoted href", () => {
    expect(htmlToMarkdownPortable("<a href='https://x.test'>link</a>")).toBe(
      "[link](https://x.test)"
    );
  });

  it("converts a link with an unquoted href", () => {
    expect(htmlToMarkdownPortable("<a href=https://x.test>link</a>")).toBe(
      "[link](https://x.test)"
    );
  });

  it("keeps the link text and the URL", () => {
    const out = htmlToMarkdownPortable('<a href="https://x.test">click</a>');
    expect(out).toContain("click");
    expect(out).toContain("https://x.test");
  });

  it("keeps a link with no href as plain text", () => {
    expect(htmlToMarkdownPortable("<a>bare</a>")).toBe("bare");
  });
});

describe("htmlToMarkdownPortable — br and lists", () => {
  it("converts <br> to a newline", () => {
    expect(htmlToMarkdownPortable("a<br>b")).toBe("a\nb");
  });

  it("converts a self-closing <br/> to a newline", () => {
    expect(htmlToMarkdownPortable("a<br/>b")).toBe("a\nb");
  });

  it("bullets list items", () => {
    const out = htmlToMarkdownPortable("<ul><li>a</li><li>b</li></ul>");
    expect(out).toContain("- a");
    expect(out).toContain("- b");
  });

  it("numbers list items", () => {
    const out = htmlToMarkdownPortable("<ol><li>a</li><li>b</li></ol>");
    expect(out).toContain("1. a");
    expect(out).toContain("1. b");
  });

  it("separates table cells with a space rather than concatenating", () => {
    // The DOM-based path produced "ab" with no separator at all, which is
    // genuine data loss. A space at least keeps the two values apart.
    const out = htmlToMarkdownPortable(
      "<table><tr><td>a</td><td>b</td></tr></table>"
    );
    expect(out).toContain("a");
    expect(out).toContain("b");
    expect(out).not.toBe("ab");
  });
});

describe("htmlToMarkdownPortable — unknown and hostile markup", () => {
  it("keeps the text of an unknown element and drops the tag", () => {
    expect(htmlToMarkdownPortable("<section>kept</section>")).toBe("kept");
  });

  it("keeps the text of an unknown inline element", () => {
    expect(htmlToMarkdownPortable("<span>kept</span>")).toBe("kept");
  });

  it("does not emit script contents as text", () => {
    // Script bodies are never user-visible content; emitting them would put
    // code where the user wrote none.
    const out = htmlToMarkdownPortable("<script>alert(1)</script>");
    expect(out).toBe("");
  });

  it("does not emit style contents", () => {
    expect(htmlToMarkdownPortable("<style>body{color:red}</style>")).toBe("");
  });

  it("keeps visible text that follows a script block", () => {
    const out = htmlToMarkdownPortable("<script>x()</script>visible");
    expect(out).toBe("visible");
  });

  it("handles a nested script tag", () => {
    const out = htmlToMarkdownPortable(
      "<script>var a='<script>';</script>after"
    );
    expect(out).toContain("after");
  });

  it("drops an onerror attribute along with its tag", () => {
    const out = htmlToMarkdownPortable('<div onclick="alert(1)">text</div>');
    expect(out).toBe("text");
    expect(out).not.toContain("onclick");
  });

  it("carries a javascript: href through unchanged", () => {
    // Asserting the *absence* of the scheme here would be a lie: the converter
    // has no sanitiser, and inventing one would make the markdown wrong for
    // every other consumer. Safety lives at the sink — sanitizeUrl drops the
    // scheme when the markdown is rendered. See markdown.test.ts.
    const out = htmlToMarkdownPortable('<a href="javascript:alert(1)">x</a>');
    expect(out).toBe("[x](javascript:alert(1))");
  });
});

describe("htmlToMarkdownPortable — no DOM dependency", () => {
  it("runs with DOMParser removed from the global", () => {
    // The property that makes this usable in an MV3 service worker, where
    // DOMParser is a ReferenceError.
    const original = (globalThis as Record<string, unknown>)["DOMParser"];
    delete (globalThis as Record<string, unknown>)["DOMParser"];
    try {
      const out = htmlToMarkdownPortable("<p><strong>works</strong></p>");
      expect(out).toBe("**works**");
    } finally {
      if (original !== undefined) {
        (globalThis as Record<string, unknown>)["DOMParser"] = original;
      }
    }
  });
});

/**
 * Adversarial input.
 *
 * The first implementation tokenised with `/<tag[^>]*>/`, which is quadratic:
 * `[^>]*` is greedy and must be followed by `>`, so every `<` with no later `>`
 * consumed to end-of-input and backtracked. A 32 KB body of `<b` — which is what
 * a truncated or copy-pasted HTML snippet looks like — took 738 ms, and this
 * function runs on every getSnippets() inside the MV3 service worker.
 */
describe("htmlToMarkdownPortable — adversarial input", () => {
  it("converts a large unterminated-tag body quickly", () => {
    // Quadratic was 12.3 s at this size; linear is ~1 ms. The bound is loose
    // enough not to flake but tight enough to catch the regression.
    const body = "<b".repeat(128_000);
    const start = performance.now();
    htmlToMarkdownPortable(body);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });

  it("scales roughly linearly, not quadratically", () => {
    const time = (reps: number) => {
      const body = "<b".repeat(reps);
      const start = performance.now();
      htmlToMarkdownPortable(body);
      return performance.now() - start;
    };
    time(50_000); // warm up, so the comparison is not dominated by JIT
    const small = time(50_000);
    const large = time(200_000); // 4x the input
    // Quadratic would be ~16x. Allow a wide 8x so a slow machine cannot flake
    // this, while still failing loudly on a super-linear scan.
    expect(large).toBeLessThan(Math.max(small * 8, 50));
  });

  it("treats a bare < as literal text", () => {
    expect(htmlToMarkdownPortable("a < b")).toBe("a < b");
    expect(htmlToMarkdownPortable("5<6 and 7>8")).toBe("5<6 and 7>8");
  });

  it("does not let a > inside a quoted attribute end the tag", () => {
    expect(htmlToMarkdownPortable('<a title="a>b" href="u">t</a>')).toBe(
      "[t](u)"
    );
  });

  it("does not mistake an = inside a quoted value for an attribute boundary", () => {
    expect(htmlToMarkdownPortable('<a title="x=y" href="u">t</a>')).toBe(
      "[t](u)"
    );
  });

  it("drops an unterminated tag at the end", () => {
    expect(htmlToMarkdownPortable("keep<b")).toBe("keep");
  });

  /**
   * Regression: an infinite loop.
   *
   * findTagEnd returns -1 for an unterminated tag, and -1 used to be assigned
   * straight to the scan cursor. `indexOf("<", -1)` coerces -1 to 0, so the
   * scanner jumped back to the start and re-entered the same branch forever,
   * with no allocation and no await — pinning the MV3 service worker at 100% CPU
   * on every read of a single legacy snippet. `if a <! b` is plain prose, so
   * this was reachable without any exotic payload.
   *
   * Each case must terminate, so a short timeout is the assertion.
   */
  it.each([
    ["a doctype marker with no close", "if a <! b"],
    ["a processing instruction with no close", "php <?php echo 1"],
    ["an unterminated processing instruction", '<?xml version="1.0"'],
    ["a bare comment opener", "<!-"],
    ["an unterminated script with a bad tag inside", "<script>x<a"],
    ["an unterminated style with a bad tag inside", "<style><b"],
  ])("terminates on %s", (_label, input) => {
    expect(() => htmlToMarkdownPortable(input)).not.toThrow();
  });

  it("keeps the text before an unterminated doctype marker", () => {
    expect(htmlToMarkdownPortable("if a <! b")).toBe("if a");
  });

  it("does not treat ?? as a tag", () => {
    expect(htmlToMarkdownPortable("x ?? y")).toBe("x ?? y");
  });
});

/**
 * Comments, CDATA and doctypes.
 *
 * The DOM path walks only text and element nodes, so a comment (nodeType 8) is
 * dropped along with its contents. Matching that matters: converting markup
 * *inside* a comment would put text on the page that the user never typed and
 * the editor never showed.
 */
describe("htmlToMarkdownPortable — non-content markup is dropped", () => {
  it("drops a comment and its contents", () => {
    expect(htmlToMarkdownPortable("<!-- <b>x</b> -->after")).toBe("after");
  });

  it("drops a conditional comment", () => {
    expect(
      htmlToMarkdownPortable("<!--[if IE]><b>ie</b><![endif]-->after")
    ).toBe("after");
  });

  it("drops a CDATA section", () => {
    expect(htmlToMarkdownPortable("<![CDATA[x]]>after")).toBe("after");
  });

  it("drops a doctype", () => {
    expect(htmlToMarkdownPortable("<!DOCTYPE html><p>a</p>")).toBe("a");
  });

  it("drops an unterminated comment and everything after it", () => {
    // A browser also swallows the rest of the document in this case.
    expect(htmlToMarkdownPortable("<!-- never closed")).toBe("");
  });
});

describe("htmlToMarkdownPortable — definition lists", () => {
  it("separates dt and dd with a space rather than concatenating", () => {
    // Without a separator "t" and "d" would merge into "td", losing the split.
    expect(htmlToMarkdownPortable("<dl><dt>t</dt><dd>d</dd></dl>")).toBe("t d");
  });
});

describe("decodeEntities — invalid code points", () => {
  it("maps &#0; to the replacement character, per HTML5", () => {
    expect(decodeEntities("&#0;end")).toBe("\uFFFDend");
  });

  it("maps a lone surrogate to the replacement character", () => {
    // A lone surrogate in a JS string is a latent encoding bug.
    expect(decodeEntities("&#xD800;end")).toBe("\uFFFDend");
  });

  it("keeps a valid astral code point", () => {
    expect(decodeEntities("&#x1F600;")).toBe("\u{1F600}");
  });
});
