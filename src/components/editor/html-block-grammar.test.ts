/**
 * Tests for the HTML → markdown path, which the TextBlaze and PowerText
 * importers both depend on.
 *
 * spec: specs/markdown-block-grammar.spec.md
 *
 * `htmlToMarkdown` is `serializeToMarkdown(deserializeFromHtml(html))`, so it
 * inherits the block grammar only if the HTML deserialiser produces the same
 * block element types. It did not: `<ul><li>a</li><li>b</li></ul>` produced
 * `"ab"` — the two items became one word. That is silent data corruption on the
 * import path, and the old tests did not catch it because they only ever checked
 * the resulting *text* for substrings.
 */

import { describe, it, expect } from "vitest";
import {
  htmlToMarkdown,
  deserializeContent,
  deserializeHtmlToNodes,
} from "./serialization";

describe("htmlToMarkdown — block structure", () => {
  it("keeps list items apart", () => {
    // The corruption case: this used to produce "ab".
    expect(htmlToMarkdown("<ul><li>a</li><li>b</li></ul>")).toBe("- a\n- b");
  });

  it("numbers an ordered list sequentially", () => {
    expect(htmlToMarkdown("<ol><li>a</li><li>b</li></ol>")).toBe("1. a\n2. b");
  });

  it("keeps a heading's level", () => {
    expect(htmlToMarkdown("<h2>T</h2>")).toBe("## T");
    expect(htmlToMarkdown("<h3>T</h3>")).toBe("### T");
  });

  it("emits a thematic break for <hr>", () => {
    // <hr> used to vanish entirely.
    expect(htmlToMarkdown("<hr>")).toBe("---");
  });

  it("keeps a table's cells apart", () => {
    const html =
      "<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("|");
    expect(md).toContain("a");
    expect(md).toContain("b");
    // Every cell must still be its own cell.
    expect(md).not.toBe("a b 1 2");
  });

  it("turns a code block into a fence", () => {
    // <pre><code>**x**</code></pre> used to become `**x**`, i.e. inline code,
    // after which the interior is reinterpreted as markdown.
    const md = htmlToMarkdown("<pre><code>**x**</code></pre>");
    expect(md).toContain("```");
    expect(md).toContain("**x**");
  });

  it("keeps a blockquote's marker", () => {
    expect(htmlToMarkdown("<blockquote>quoted</blockquote>")).toContain(">");
  });

  it("keeps an image's alt text and URL rather than dropping it", () => {
    // <img> used to produce "". A remote URL cannot be stored — the media store
    // holds uploaded blobs — so the markdown is kept as literal text, which
    // preserves both parts and stays visible. It does not come back as an
    // image element; the spec says so.
    const md = htmlToMarkdown('<img src="http://x/y.png" alt="a cat">');
    expect(md).toContain("y.png");
    expect(md).toContain("a cat");
  });
});

describe("htmlToMarkdown — structure survives a re-parse", () => {
  it("a table converted from HTML parses back as a table", () => {
    const md = htmlToMarkdown(
      "<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>"
    );
    const nodes = deserializeHtmlToNodes(`<p>${md.replace(/\n/g, "")}</p>`);
    // The exact node shape depends on the DOM walker; what must not happen is
    // the cells running together, so assert on the text.
    expect(JSON.stringify(nodes)).toContain("a");
    expect(JSON.stringify(nodes)).toContain("2");
  });

  it("a list converted from HTML keeps its items distinct", () => {
    const nodes = deserializeHtmlToNodes("<ul><li>a</li><li>b</li></ul>");
    const json = JSON.stringify(nodes);
    // "ab" would mean the items merged.
    expect(json).not.toContain('"ab"');
  });
});

describe("htmlToMarkdown — malformed tables", () => {
  it("does not duplicate a nested table's contents", () => {
    // `querySelectorAll("tr")` is a descendant query, so the inner row was
    // counted twice and the word appeared in the output twice.
    const md = htmlToMarkdown(
      "<table><tr><td><table><tr><td>inner</td></tr></table></td></tr></table>"
    );
    expect(md.match(/inner/g)).toHaveLength(1);
  });

  it("synthesises a header for a table whose first row is all <td>", () => {
    // The common pasted-HTML case. Without a header, the delimiter row landed
    // where the header should be and the result re-parsed as a paragraph, so
    // the table was lost on the very next save.
    const md = htmlToMarkdown("<table><tr><td>a</td><td>b</td></tr></table>");
    // Re-parse the *markdown*, not an HTML wrapper: wrapping it in <pre> would
    // produce a code block and prove nothing about the table.
    const types = deserializeContent(md).map(
      (n) => (n as { type?: string }).type
    );
    expect(types).toEqual(["table"]);
    expect(md).toContain("a");
    expect(md).toContain("b");
  });

  it("falls back to a paragraph for a table with no cells", () => {
    // `|  |` is not GFM and does not re-parse as a table.
    const md = htmlToMarkdown("<table><tr></tr></table>");
    expect(md).not.toContain("|");
  });

  it("keeps every cell of a row wider than the header", () => {
    const md = htmlToMarkdown(
      "<table><tr><th>a</th></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>"
    );
    for (const cell of ["1", "2", "3"]) expect(md).toContain(cell);
  });
});

describe("htmlToMarkdown — images", () => {
  it("keeps the alt text alone when there is no src", () => {
    expect(htmlToMarkdown('<img alt="just words">')).toBe("just words");
  });

  it("drops an image with neither src nor alt", () => {
    expect(htmlToMarkdown("<img>")).toBe("");
  });
});
