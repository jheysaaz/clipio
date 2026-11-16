/**
 * The insertion path, end to end.
 *
 * Unit tests on the converter are not enough on their own: the bug this file
 * exists for lived in the *wiring*. `markdownToHtml` handled inline markdown
 * correctly and was called correctly — it simply had no block-level handling,
 * so `# Heading` and `- item` arrived at the contenteditable as their own
 * source. Everything below the converter was correct, which is why nothing
 * failed loudly.
 *
 * So these tests drive `processSnippetContent`, which is what the content script
 * actually calls, and assert on what the target field would receive.
 */

import { describe, it, expect } from "vitest";

import { processSnippetContent } from "./content-helpers";

/** The snippet from samples/clipio-export.json that surfaced the bug. */
const KITCHEN_SINK = [
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

const insert = (content: string, asHtml = true) =>
  processSnippetContent(content, asHtml, () => "").content;

describe("insertion into a rich field", () => {
  it("renders block markdown as elements, not as literal source", () => {
    // The reported bug, verbatim: the marks were visible on the page.
    const out = insert(KITCHEN_SINK);

    expect(out).toContain("<h1>Heading</h1>");
    expect(out).toContain("<ul><li>first item</li><li>second item</li></ul>");
    expect(out).toContain("<blockquote>a blockquote</blockquote>");
    expect(out).toContain("<ol><li>one</li><li>two</li></ol>");

    // Not one marker may survive. This is the assertion that fails on a
    // regression; the ones above would pass against a partially-working renderer.
    expect(out).not.toContain("# Heading");
    expect(out).not.toContain("- first item");
    expect(out).not.toContain("> a blockquote");
  });

  it("still renders inline markdown", () => {
    // Guards against fixing the blocks by replacing the converter wholesale.
    const out = insert(KITCHEN_SINK);
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
    expect(out).toContain("<code>inline code</code>");
    expect(out).toContain('href="https://clipio.xyz"');
  });

  it("replaces {{cursor}} with the caret marker, inside a block", () => {
    // Not "survives intact": processSnippetContent deliberately swaps it for a
    // span the content script later uses to position the caret. This asserts the
    // substitution still happens when the placeholder sits under a heading.
    const out = insert("# Title\n\nHi {{cursor}}");
    expect(out).toContain("<h1>Title</h1>");
    expect(out).toContain("clipio-cursor");
    expect(out).not.toContain("{{cursor}}");
  });

  it("keeps plain-text insertion free of markup", () => {
    // `asHtml: false` is the <input> path. Markup there would be inserted
    // literally, so this must stay plain.
    const out = insert(KITCHEN_SINK, false);
    expect(out).not.toContain("<h1>");
    expect(out).not.toContain("<ul>");
    expect(out).not.toContain("<blockquote>");
  });
});
