/**
 * Tests for the markdown block grammar.
 *
 * spec: specs/markdown-block-grammar.spec.md
 *
 * These are round-trip tests. The claim under test is that opening a snippet and
 * saving it does not change the snippet, so the assertions are about the *pair*
 * of operations rather than about either one in isolation — which is how a
 * serializer and a parser can each be individually plausible and still destroy
 * the document between them.
 */

import { describe, it, expect } from "vitest";
import { serializeToMarkdown, deserializeContent } from "./serialization";

/** Deserialise then re-serialise: the exact thing an open/save cycle does. */
function roundTrip(markdown: string): string {
  return serializeToMarkdown(deserializeContent(markdown));
}

/** Block types produced, ignoring inline detail. */
function blockTypes(markdown: string): string[] {
  return deserializeContent(markdown).map(
    (n) => (n as { type?: string }).type ?? "?"
  );
}

describe("markdown block grammar — headings", () => {
  it.each([1, 2, 3, 4, 5, 6])("round-trips an h%d", (level) => {
    const md = `${"#".repeat(level)} Title`;
    expect(roundTrip(md)).toBe(md);
  });

  it("produces a heading element, not a paragraph", () => {
    expect(blockTypes("## Title")).toEqual(["h2"]);
  });

  it("does not treat '#tag' as a heading", () => {
    // Snippets are full of #channel and #1. A '#' with no space is not a marker.
    expect(blockTypes("#channel")).toEqual(["p"]);
    expect(roundTrip("#channel")).toBe("#channel");
  });

  it("does not treat a closing sequence as a heading", () => {
    expect(blockTypes("Title\n===")).toEqual(["h1"]);
  });

  it("round-trips an empty heading", () => {
    // `#` on its own is an empty h1, not a paragraph. An earlier version of
    // this test asserted `["p"]`, which was simply wrong.
    expect(blockTypes("#")).toEqual(["h1"]);
    expect(roundTrip("#")).toBe("#");
  });
});

describe("markdown block grammar — thematic breaks", () => {
  it.each(["---", "***", "___"])("parses %s as a break", (md) => {
    expect(blockTypes(md)).toEqual(["hr"]);
  });

  it("normalises any break marker to --- and stays stable", () => {
    // Which glyph a break was written with carries no meaning, so the
    // serialiser emits `---`. The property that matters is that saving twice
    // does not keep changing the document.
    for (const md of ["---", "***", "___"]) {
      const once = roundTrip(md);
      expect(once).toBe("---");
      expect(roundTrip(once)).toBe(once);
    }
  });

  it("produces a thematic break element", () => {
    expect(blockTypes("---")).toEqual(["hr"]);
  });

  it("does not treat a setext underline under text as a break", () => {
    expect(blockTypes("Title\n---")).toEqual(["h2"]);
  });
});

describe("markdown block grammar — fenced code", () => {
  it("keeps the fence interior verbatim", () => {
    const md = [
      "```js",
      "const a = **b**;",
      "const c = {{date:iso}};",
      "```",
    ].join("\n");
    // The whole point: `**b**` inside a fence must NOT become a bold mark.
    const nodes = deserializeContent(md);
    expect(nodes).toHaveLength(1);
    const code = nodes[0] as { type?: string; language?: string };
    expect(code.type).toBe("code");
    expect(code.language).toBe("js");
    expect(roundTrip(md)).toBe(md);
  });

  it("does not convert placeholders inside a fence", () => {
    const nodes = deserializeContent("```\n{{date:iso}}\n```");
    const json = JSON.stringify(nodes);
    expect(json).not.toContain("DATE_PLACEHOLDER");
  });

  it("treats an unterminated fence as running to end of input", () => {
    const nodes = deserializeContent("```\nstill code\n");
    expect((nodes[0] as { type?: string }).type).toBe("code");
  });

  it("does not close a fence with a shorter run than opened it", () => {
    // CommonMark: ``` cannot be closed by ```
    const md = ["````", "```", "still inside", "````"].join("\n");
    expect(roundTrip(md)).toBe(md);
  });

  it("allows an unlabelled fence", () => {
    const md = ["```", "plain", "```"].join("\n");
    expect(roundTrip(md)).toBe(md);
  });
});

describe("markdown block grammar — lists", () => {
  it.each(["-", "*", "+"])("parses %s as a list marker", (marker) => {
    expect(blockTypes(`${marker} a\n${marker} b`)).toEqual(["ul"]);
  });

  it("normalises list markers to - and stays stable", () => {
    // As with thematic breaks, `*` and `+` and `-` all mean the same thing, so
    // the serialiser emits `-`. Stability across two saves is the real claim.
    for (const marker of ["-", "*", "+"]) {
      const once = roundTrip(`${marker} a\n${marker} b`);
      expect(once).toBe("- a\n- b");
      expect(roundTrip(once)).toBe(once);
    }
  });

  it("produces a list element rather than paragraphs", () => {
    expect(blockTypes("- a\n- b")).toEqual(["ul"]);
  });

  it("round-trips an ordered list", () => {
    const md = "1. a\n2. b";
    expect(roundTrip(md)).toBe(md);
    expect(blockTypes(md)).toEqual(["ol"]);
  });

  it("keeps nested lists nested", () => {
    const md = "- a\n  - b";
    const nodes = deserializeContent(md);
    const list = nodes[0] as { type?: string; children?: unknown[] };
    expect(list.type).toBe("ul");

    // A ul's children are `li`; the nested list is inside the first `li`.
    const item = list.children?.[0] as {
      type?: string;
      children?: { type?: string }[];
    };
    expect(item.type).toBe("li");
    expect(item.children?.some((c) => c.type === "ul")).toBe(true);
  });

  it("round-trips a nested list", () => {
    const md = "- a\n  - b";
    expect(roundTrip(md)).toBe(md);
  });

  it("does not treat 'a - b' as a list", () => {
    expect(blockTypes("a - b")).toEqual(["p"]);
  });

  it("does not treat a lone dash as a list", () => {
    expect(blockTypes("-")).toEqual(["p"]);
  });

  it("preserves the text of an item containing inline marks", () => {
    const nodes = deserializeContent("- **bold** item");
    expect(JSON.stringify(nodes)).toContain("bold");
  });
});

describe("markdown block grammar — block quotes", () => {
  it("round-trips a quote", () => {
    const md = "> quoted";
    expect(roundTrip(md)).toBe(md);
  });

  it("produces a blockquote element", () => {
    expect(blockTypes("> quoted")).toEqual(["blockquote"]);
  });

  it("round-trips a multi-line quote", () => {
    const md = "> one\n> two";
    expect(roundTrip(md)).toBe(md);
  });
});

describe("markdown block grammar — tables", () => {
  // This is the corruption case the wave exists for: two cells serialised to "ab"
  // with no separator at all.
  const md = ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n");

  it("round-trips a table", () => {
    expect(roundTrip(md)).toBe(md);
  });

  it("keeps the cell separator so cells never merge", () => {
    const out = roundTrip(md);
    expect(out).toContain("|");
  });

  it("keeps every cell addressable", () => {
    const nodes = deserializeContent(md);
    const json = JSON.stringify(nodes);
    for (const cell of ["a", "b", "1", "2"]) {
      expect(json).toContain(cell);
    }
  });

  it("pads a delimiter row that is shorter than the header", () => {
    const ragged = ["| a | b |", "| --- |", "| 1 | 2 |"].join("\n");
    expect(blockTypes(ragged)).toEqual(["table"]);

    // The body row must keep both cells, which is the point of padding to the
    // header's width rather than the delimiter's.
    const out = roundTrip(ragged);
    expect(out).toContain("1");
    expect(out).toContain("2");
  });

  it("does not split a cell on an escaped pipe, and does not drop later cells", () => {
    // The real bug this covers: `splitRow` unescapes `\|` before the caller
    // counts cells, so a header containing one was measured as narrower and
    // every body cell past the header width was silently deleted.
    const md = ["| a \\| b |", "| --- | --- |", "| 1 | 2 |"].join("\n");
    const nodes = deserializeContent(md);
    const json = JSON.stringify(nodes);

    // Both body cells must be present. "2" disappearing is the failure.
    expect(json).toContain("1");
    expect(json).toContain("2");

    const roundTripped = roundTrip(md);
    expect(roundTripped).toContain("2");
  });

  it("does not truncate a body row that is wider than the header", () => {
    const md = ["| a |", "| --- |", "| 1 | 2 | 3 |"].join("\n");
    const roundTripped = roundTrip(md);
    expect(roundTripped).toContain("2");
    expect(roundTripped).toContain("3");
  });
});

describe("markdown block grammar — paragraphs and mixed content", () => {
  it("leaves plain text as paragraphs", () => {
    expect(blockTypes("one\n\ntwo")).toEqual(["p", "p"]);
  });

  it("keeps a heading and a following paragraph distinct", () => {
    expect(blockTypes("# T\n\nbody")).toEqual(["h1", "p"]);
  });

  it("round-trips a document mixing blocks", () => {
    const md = [
      "# Title",
      "",
      "Intro paragraph.",
      "",
      "- one",
      "- two",
      "",
      "> quote",
      "",
      "```",
      "code",
      "```",
      "",
      "---",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    expect(roundTrip(md)).toBe(md);
  });

  it("yields exactly one empty paragraph for empty input", () => {
    expect(deserializeContent("")).toEqual([
      { type: "p", children: [{ text: "" }] },
    ]);
    expect(deserializeContent("   \n  ")).toEqual([
      { type: "p", children: [{ text: "" }] },
    ]);
  });

  it("normalises CRLF before scanning", () => {
    expect(blockTypes("# T\r\n\r\nbody")).toEqual(["h1", "p"]);
  });
});

describe("markdown block grammar — media placeholder widths", () => {
  it("keeps a zero width", () => {
    // Wave 6 built `formatImagePlaceholder`, which handles 0 correctly, but
    // serialization.ts was still on the `width ? ... : ...` pattern, where 0 is
    // falsy and the width is dropped.
    expect(roundTrip("{{image:abc:0}}")).toBe("{{image:abc:0}}");
  });

  it("keeps a zero width on a gif", () => {
    expect(roundTrip("{{gif:xyz:0}}")).toBe("{{gif:xyz:0}}");
  });

  it("adds no width when there was none", () => {
    expect(roundTrip("{{image:abc}}")).toBe("{{image:abc}}");
  });

  it("keeps a normal width", () => {
    expect(roundTrip("{{image:abc:200}}")).toBe("{{image:abc:200}}");
  });
});
