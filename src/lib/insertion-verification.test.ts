import { describe, it, expect } from "vitest";

import {
  insertionTextMatches,
  normaliseForComparison,
  plainTextFromHtml,
} from "./insertion-verification";

/**
 * The bug: confetti fired in textareas and never in rich editors.
 *
 * `verifyInsertionSuccessForContentEditable` compared `textContent` of the
 * inserted HTML against `innerText` of the field. `textContent` drops line
 * breaks; `innerText` produces them. So `"Heading<br>Some bold"` compared as
 * `"HeadingSome bold"` against `"Heading\nSome bold"` and never matched — and
 * confetti is gated on that match.
 *
 * Single-line snippets matched, which is why the e2e (a one-line markdown
 * snippet) stayed green. Every multi-line snippet in a rich editor silently lost
 * its confetti.
 */

describe("plainTextFromHtml", () => {
  it("turns a line break into a newline", () => {
    // The core defect: textContent would give "ab" here.
    expect(plainTextFromHtml("a<br>b")).toBe("a\nb");
  });

  it("turns a block boundary into a newline", () => {
    expect(plainTextFromHtml("<p>one</p><p>two</p>")).toBe("one\ntwo");
    expect(plainTextFromHtml("<h1>Title</h1><p>body</p>")).toBe("Title\nbody");
  });

  it("does NOT add list bullets, because innerText does not render them", () => {
    // The bug this guards, and why it existed: a bullet was injected on the
    // premise that `innerText` renders one. It does not — the bullet is CSS
    // `::marker`, verified in Chromium as "a\nb" for a two-item list. So the
    // extractor produced text the field never contained, and every list-bearing
    // snippet lost confetti and reported a phantom reverted insertion to Sentry.
    expect(plainTextFromHtml("<ul><li>one</li><li>two</li></ul>")).toBe(
      "one\ntwo"
    );
    expect(plainTextFromHtml("<ol><li>one</li><li>two</li></ol>")).toBe(
      "one\ntwo"
    );
  });

  it("decodes the entities the markdown converter emits", () => {
    expect(plainTextFromHtml("a &amp; b &lt;c&gt;")).toBe("a & b <c>");
    expect(plainTextFromHtml("it&#39;s")).toBe("it's");
  });

  it("drops tags it does not model rather than showing them", () => {
    expect(plainTextFromHtml("<span>text</span>")).toBe("text");
    expect(plainTextFromHtml("<a href='#'>link</a>")).toBe("link");
  });

  it("contributes nothing for an image", () => {
    expect(plainTextFromHtml('<img src="x.png" alt="ignored">')).toBe("");
  });

  it("returns an empty string for markup with no text", () => {
    // The signal the caller uses to switch to counting <img> elements.
    expect(plainTextFromHtml("")).toBe("");
    expect(plainTextFromHtml("<img src='a.png'>")).toBe("");
  });
});

describe("normaliseForComparison", () => {
  it("collapses every whitespace run to a single space", () => {
    expect(normaliseForComparison("a \n\n b\t c ")).toBe("a b c");
  });
});

describe("insertionTextMatches", () => {
  it("matches a single-line snippet", () => {
    // The case that always worked — worth pinning so the fix cannot break it.
    expect(
      insertionTextMatches(
        "<strong>Bold</strong> and <em>italic</em>",
        "Bold and italic"
      )
    ).toBe(true);
  });

  it("matches a multi-line snippet whose breaks innerText reproduces", () => {
    // The regression. `textContent` gave "HeadingSome bold" and never matched.
    expect(
      insertionTextMatches(
        "<h1>Heading</h1><p>Some <strong>bold</strong></p>",
        "Heading\nSome bold"
      )
    ).toBe(true);
  });

  it("matches regardless of how many blank lines the field renders", () => {
    // A <div> may contribute one break or two depending on the browser. The
    // check must not care, or confetti dies on a browser update.
    expect(insertionTextMatches("<p>one</p><p>two</p>", "one\ntwo")).toBe(true);
    expect(insertionTextMatches("<p>one</p><p>two</p>", "one\n\n\ntwo")).toBe(
      true
    );
    expect(insertionTextMatches("<p>one</p><p>two</p>", "one   two")).toBe(
      true
    );
  });

  it("matches the whole kitchen sink into a rendered field", () => {
    const html =
      "<h1>Heading</h1><p>Some <strong>bold</strong>, some <em>italic</em>.</p>" +
      "<ul><li>first item</li><li>second item</li></ul>" +
      "<blockquote>a blockquote</blockquote><ol><li>one</li><li>two</li></ol>";
    // Transcribed from a real Chromium `innerText`, with no bullets — which is
    // the point. The previous version typed "one" with a bullet and so agreed
    // with the implementation by construction; it asserted the bug.
    const rendered =
      "Heading\n\nSome bold, some italic.\n\nfirst item\nsecond item\na blockquote\none\ntwo";

    expect(insertionTextMatches(html, rendered)).toBe(true);
  });

  it("does not match when the text is absent", () => {
    // A host app that reverted the insertion must not be reported as success, or
    // confetti celebrates a failure.
    expect(insertionTextMatches("<p>hello</p>", "goodbye")).toBe(false);
  });

  it("does not match a partial insertion", () => {
    expect(insertionTextMatches("<p>hello world</p>", "hello")).toBe(false);
  });

  it("returns false for markup with no text, so the caller can check images", () => {
    expect(insertionTextMatches('<img src="a.png">', "anything")).toBe(false);
  });

  it("is not fooled by extra surrounding content", () => {
    // A rich editor usually already had text in it.
    expect(
      insertionTextMatches("<p>inserted</p>", "existing text inserted more")
    ).toBe(true);
  });
});
