/**
 * Tests for the two string primitives the HTML-to-text surfaces share.
 *
 * Both are here because CodeQL found real weaknesses in the one-pass versions
 * that were duplicated across the sidebar preview and the insertion check.
 * Each test asserts on the exported function, and the negative cases are the
 * whole point: a decoder that handles ordinary entities is easy, one that does
 * not reconstruct tags or double-decode is what the finding was about.
 */

import { describe, expect, it } from "vitest";
import { decodeHtmlEntities, stripHtmlTags } from "./html-text";

describe("stripHtmlTags", () => {
  it("removes an ordinary tag", () => {
    expect(stripHtmlTags("<span>text</span>")).toBe("text");
  });

  it("keeps text that contains no tags", () => {
    expect(stripHtmlTags("plain < text")).toBe("plain < text");
  });

  it("removes a tag exposed only after an earlier one is removed", () => {
    // The `>` inside the quoted title ends the first match early. One pass
    // leaves `">payload</a>"` — a tag still present. This is the payload the
    // repeated-replacement fix has to handle.
    const out = stripHtmlTags('<a title=">">payload</a>');
    expect(out).toBe('">payload');
    expect(out).not.toMatch(/</);
  });

  it("is idempotent", () => {
    // The loop must stop on an unchanged pass rather than spinning. This is
    // the negative case for the repeated-replacement fix.
    const once = stripHtmlTags("<p>one</p> &lt;two&gt;");
    expect(stripHtmlTags(once)).toBe(once);
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes the entities the markdown converter emits", () => {
    expect(decodeHtmlEntities("a &amp; b &lt;c&gt; &quot;d&quot;")).toBe(
      'a & b <c> "d"'
    );
  });

  it("decodes apostrophes, non-breaking spaces and numerics", () => {
    expect(decodeHtmlEntities("it&#39;s&apos;ok&nbsp; &#x41; &#65;")).toBe(
      "it's'ok  A A"
    );
  });

  it("decodes each entity only once", () => {
    // The old chained replaces turned this into `<` by decoding `&amp;` and
    // then decoding the `&lt;` they had just produced. This is the negative
    // case for js/double-escaping.
    expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;");
    expect(decodeHtmlEntities("&amp;amp;")).toBe("&amp;");
  });

  it("leaves unknown entity names untouched", () => {
    expect(decodeHtmlEntities("&notanentity;")).toBe("&notanentity;");
  });

  it("leaves out-of-range and surrogate numeric references untouched", () => {
    // String.fromCodePoint throws on these; an entity in stored content must
    // not be able to break insertion. This is the negative case.
    expect(decodeHtmlEntities("&#1114112;")).toBe("&#1114112;");
    expect(decodeHtmlEntities("&#xD800;")).toBe("&#xD800;");
  });

  it("leaves an unterminated entity alone", () => {
    expect(decodeHtmlEntities("&amp no semicolon")).toBe("&amp no semicolon");
  });
});
