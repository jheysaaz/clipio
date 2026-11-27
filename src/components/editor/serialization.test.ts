/**
 * Tests for src/components/editor/serialization.ts
 */

import { describe, it, expect } from "vitest";
import {
  serializeToMarkdown,
  deserializeContent,
  deserializeHtmlToNodes,
  htmlToMarkdown,
  markdownToHtml,
  markdownToPlainText,
} from "./serialization";
import {
  CLIPBOARD_PLACEHOLDER,
  DATE_PLACEHOLDER,
  CURSOR_PLACEHOLDER,
  DATEPICKER_PLACEHOLDER,
  IMAGE_PLACEHOLDER,
  GIF_PLACEHOLDER,
  LINK_ELEMENT,
} from "./types";
import type { TElement, TText } from "platejs";

// ---------------------------------------------------------------------------
// Helpers to build Plate nodes
// ---------------------------------------------------------------------------

const p = (children: unknown[]): TElement =>
  ({ type: "p", children }) as TElement;

const text = (t: string, marks: Record<string, boolean> = {}) => ({
  text: t,
  ...marks,
});

const clipboardNode = (): TElement =>
  ({ type: CLIPBOARD_PLACEHOLDER, children: [{ text: "" }] }) as TElement;

const dateNode = (format: string): TElement =>
  ({ type: DATE_PLACEHOLDER, format, children: [{ text: "" }] }) as TElement;

const cursorNode = (): TElement =>
  ({ type: CURSOR_PLACEHOLDER, children: [{ text: "" }] }) as TElement;

const datepickerNode = (date: string, format?: string): TElement =>
  ({
    type: DATEPICKER_PLACEHOLDER,
    date,
    ...(format ? { format } : {}),
    children: [{ text: "" }],
  }) as TElement;

const linkNode = (url: string, label: string): TElement =>
  ({
    type: LINK_ELEMENT,
    url,
    children: [{ text: label }],
  }) as TElement;

const imageNode = (mediaId: string, width?: number): TElement =>
  ({
    type: IMAGE_PLACEHOLDER,
    mediaId,
    ...(width ? { width } : {}),
    children: [{ text: "" }],
  }) as TElement;

const gifNode = (giphyId: string, width?: number): TElement =>
  ({
    type: GIF_PLACEHOLDER,
    giphyId,
    ...(width ? { width } : {}),
    children: [{ text: "" }],
  }) as TElement;

// Inline voids now carry empty text leaves on each side so the caret has
// somewhere to stand; the element itself is never at index 0 any more.
const firstElementChild = (node: TElement): TElement =>
  node.children.find((child) => !("text" in child)) as TElement;

const tdNode = (content: string, align?: string): TElement =>
  ({
    type: "td",
    ...(align ? { align } : {}),
    children: [{ text: content }],
  }) as TElement;

const tableNode = (...rows: TElement[]): TElement =>
  ({ type: "table", children: rows }) as TElement;

const trNode = (...cells: TElement[]): TElement =>
  ({ type: "tr", children: cells }) as TElement;

// ---------------------------------------------------------------------------
// serializeToMarkdown
// ---------------------------------------------------------------------------

describe("serializeToMarkdown", () => {
  // plain text node → text content
  it("serializes plain text", () => {
    expect(serializeToMarkdown([p([text("Hello world")])])).toBe("Hello world");
  });

  it("returns empty string for empty text node", () => {
    expect(serializeToMarkdown([p([text("")])])).toBe("");
  });

  // bold mark → **text**
  it("serializes bold text", () => {
    expect(serializeToMarkdown([p([text("bold", { bold: true })])])).toBe(
      "**bold**"
    );
  });

  // italic mark → _text_
  it("serializes italic text", () => {
    expect(serializeToMarkdown([p([text("italic", { italic: true })])])).toBe(
      "_italic_"
    );
  });

  // underline mark → <u>text</u>
  it("serializes underline text", () => {
    expect(serializeToMarkdown([p([text("under", { underline: true })])])).toBe(
      "<u>under</u>"
    );
  });

  // strikethrough mark → ~~text~~
  it("serializes strikethrough text", () => {
    expect(
      serializeToMarkdown([p([text("strike", { strikethrough: true })])])
    ).toBe("~~strike~~");
  });

  // code mark → `text`
  it("serializes code text", () => {
    expect(serializeToMarkdown([p([text("code", { code: true })])])).toBe(
      "`code`"
    );
  });

  it("serializes clipboard placeholder", () => {
    expect(serializeToMarkdown([p([clipboardNode()])])).toBe("{{clipboard}}");
  });

  it("serializes date placeholder with format", () => {
    expect(serializeToMarkdown([p([dateNode("iso")])])).toBe("{{date:iso}}");
    expect(serializeToMarkdown([p([dateNode("us")])])).toBe("{{date:us}}");
    expect(serializeToMarkdown([p([dateNode("long")])])).toBe("{{date:long}}");
  });

  it("serializes cursor placeholder", () => {
    expect(serializeToMarkdown([p([cursorNode()])])).toBe("{{cursor}}");
  });

  // DATEPICKER_PLACEHOLDER → {{datepicker:date[:format]}}
  it("serializes datepicker placeholder, keeping the legacy token unchurned", () => {
    expect(serializeToMarkdown([p([datepickerNode("2025-06-15")])])).toBe(
      "{{datepicker:2025-06-15}}"
    );
    expect(
      serializeToMarkdown([p([datepickerNode("2025-06-15", "short")])])
    ).toBe("{{datepicker:2025-06-15:short}}");
    expect(
      serializeToMarkdown([p([datepickerNode("2025-06-15", "long")])])
    ).toBe("{{datepicker:2025-06-15}}");
  });

  // LINK_ELEMENT → [label](url)
  it("serializes link element", () => {
    expect(
      serializeToMarkdown([p([linkNode("https://example.com", "Click here")])])
    ).toBe("[Click here](https://example.com)");
  });

  // IMAGE_PLACEHOLDER → {{image:<mediaId>}}
  it("serializes image placeholder", () => {
    const mediaId = "550e8400-e29b-41d4-a716-446655440000";
    expect(serializeToMarkdown([p([imageNode(mediaId)])])).toBe(
      `{{image:${mediaId}}}`
    );
  });

  // GIF_PLACEHOLDER → {{gif:<giphyId>}}
  it("serializes gif placeholder", () => {
    expect(serializeToMarkdown([p([gifNode("abc123XYZ")])])).toBe(
      "{{gif:abc123XYZ}}"
    );
  });

  it("joins multiple paragraphs with a blank line", () => {
    // A single \n is enough to *start* a new block in CommonMark, but a
    // paragraph must be preceded by a blank line or it is absorbed into the
    // previous one. Joining with "\n" made every block boundary ambiguous.
    const result = serializeToMarkdown([
      p([text("First line")]),
      p([text("Second line")]),
    ]);
    expect(result).toBe("First line\n\nSecond line");
  });

  it("keeps the blank line after a media block", () => {
    // Inserting an image/GIF leaves the caret in an empty next paragraph. That
    // block used to be filtered out on save, erasing the line break.
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(serializeToMarkdown([p([imageNode(id)]), p([text("")])])).toBe(
      `{{image:${id}}}\n\n`
    );
    expect(
      serializeToMarkdown([p([gifNode("abc123XYZ")]), p([text("")])])
    ).toBe("{{gif:abc123XYZ}}\n\n");
  });

  it("still drops an empty paragraph after ordinary text", () => {
    // The exception is media-only: a trailing empty paragraph after text must
    // not leak a stray blank line into every saved snippet.
    expect(serializeToMarkdown([p([text("Hello")]), p([text("")])])).toBe(
      "Hello"
    );
  });

  // mixed content in same paragraph
  it("serializes mixed text and placeholders", () => {
    const result = serializeToMarkdown([
      p([text("Hello "), clipboardNode(), text(" world")]),
    ]);
    expect(result).toBe("Hello {{clipboard}} world");
  });

  it("escapes backslashes before pipes in table cells, aligned or not", () => {
    // Doubling only the pipe would leave the source backslash as an escape
    // for the delimiter, so one cell would be read as two (CodeQL #10). The
    // aligned cell used to skip escaping altogether.
    const out = serializeToMarkdown([
      tableNode(trNode(tdNode("a\\|b", "center"), tdNode("c"))),
    ]);
    expect(out.split("\n")[0]).toBe("| a\\\\\\|b | c |");
  });
});

// ---------------------------------------------------------------------------
// deserializeContent
// ---------------------------------------------------------------------------

describe("deserializeContent", () => {
  // empty input → single empty paragraph
  it("returns empty paragraph for empty string", () => {
    const result = deserializeContent("");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("p");
  });

  it("returns empty paragraph for whitespace-only string", () => {
    const result = deserializeContent("   ");
    expect(result).toHaveLength(1);
  });

  // delegates to markdown deserializer for plain text
  it("deserializes plain markdown", () => {
    const result = deserializeContent("Hello world");
    expect(result[0].children[0]).toMatchObject({ text: "Hello world" });
  });

  // delegates to HTML deserializer when content has HTML tags
  it("delegates to HTML deserializer for HTML content", () => {
    const result = deserializeHtmlToNodes("<p>Hello</p>");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("p");
  });

  it("deserializes HTML <a> tags as link elements", () => {
    const result = deserializeHtmlToNodes(
      '<p><a href="https://example.com">Click</a></p>'
    );
    expect(result).toHaveLength(1);
    const link = result[0].children[0] as TElement & { url: string };
    expect(link.type).toBe(LINK_ELEMENT);
    expect(link.url).toBe("https://example.com");
  });

  // HTML <a> with empty content → uses textContent fallback
  it("deserializes HTML <a> with no children", () => {
    const result = deserializeHtmlToNodes(
      '<p><a href="https://example.com"></a></p>'
    );
    expect(result).toHaveLength(1);
    const link = result[0].children[0] as TElement & { url: string };
    expect(link.type).toBe(LINK_ELEMENT);
  });

  it("deserializes HTML <br> as newline text", () => {
    const result = deserializeHtmlToNodes("<p>Line one<br>Line two</p>");
    expect(result).toHaveLength(1);
    const texts = result[0].children.map((c) =>
      "text" in c ? (c as TText).text : ""
    );
    expect(texts).toContain("\n");
  });

  it("deserializes HTML <span> by recursing into children", () => {
    const result = deserializeHtmlToNodes("<p><span>wrapped text</span></p>");
    expect(result).toHaveLength(1);
    const text = result[0].children[0] as TText;
    expect(text.text).toBe("wrapped text");
  });

  // HTML inline formatting elements: <strong>, <em>, <code>, etc.
  it("deserializes HTML <strong> as bold mark", () => {
    const result = deserializeHtmlToNodes("<p><strong>bold</strong></p>");
    expect(result[0].children[0]).toMatchObject({ text: "bold", bold: true });
  });

  it("deserializes HTML <em> as italic mark", () => {
    const result = deserializeHtmlToNodes("<p><em>italic</em></p>");
    expect(result[0].children[0]).toMatchObject({
      text: "italic",
      italic: true,
    });
  });

  it("deserializes HTML <code> as code mark", () => {
    const result = deserializeHtmlToNodes("<p><code>code</code></p>");
    expect(result[0].children[0]).toMatchObject({ text: "code", code: true });
  });

  it("deserializes HTML <s> as strikethrough mark", () => {
    const result = deserializeHtmlToNodes("<p><s>struck</s></p>");
    expect(result[0].children[0]).toMatchObject({
      text: "struck",
      strikethrough: true,
    });
  });

  // HTML nested inline marks: <strong><em>text</em></strong>
  it("deserializes nested HTML inline marks", () => {
    const result = deserializeHtmlToNodes(
      "<p><strong><em>bold italic</em></strong></p>"
    );
    expect(result[0].children[0]).toMatchObject({
      text: "bold italic",
      bold: true,
      italic: true,
    });
  });

  it("deserializes HTML <del> as strikethrough mark", () => {
    const result = deserializeHtmlToNodes("<p><del>deleted</del></p>");
    expect(result[0].children[0]).toMatchObject({
      text: "deleted",
      strikethrough: true,
    });
  });

  // HTML <b> as bold (alias for <strong>)
  it("deserializes HTML <b> as bold mark", () => {
    const result = deserializeHtmlToNodes("<p><b>bold</b></p>");
    expect(result[0].children[0]).toMatchObject({ text: "bold", bold: true });
  });

  // HTML <i> as italic (alias for <em>)
  it("deserializes HTML <i> as italic mark", () => {
    const result = deserializeHtmlToNodes("<p><i>italic</i></p>");
    expect(result[0].children[0]).toMatchObject({
      text: "italic",
      italic: true,
    });
  });

  it("deserializes HTML <u> inside a paragraph as underline mark", () => {
    const result = deserializeHtmlToNodes("<p><u>underlined</u></p>");
    expect(result[0].children[0]).toMatchObject({
      text: "underlined",
      underline: true,
    });
  });

  it("deserializes unknown HTML elements by recursing into children", () => {
    const result = deserializeHtmlToNodes("<p><section>content</section></p>");
    // The content should still appear
    const allText = result
      .flatMap((el) =>
        el.children.map((c) => ("text" in c ? (c as TText).text : ""))
      )
      .join("");
    expect(allText).toContain("content");
  });

  it("deserializes HTML <div> as paragraph", () => {
    const result = deserializeHtmlToNodes("<div>div content</div>");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("p");
  });

  // returns non-empty array always
  it("always returns at least one element", () => {
    expect(deserializeContent("")).toHaveLength(1);
    expect(deserializeContent("text")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// deserializeFromMarkdown (via deserializeContent)
// ---------------------------------------------------------------------------

describe("deserializeContent (markdown path)", () => {
  // MUST create CLIPBOARD_PLACEHOLDER for {{clipboard}}
  it("deserializes {{clipboard}} placeholder", () => {
    const result = deserializeContent("{{clipboard}}");
    const firstChild = firstElementChild(result[0]);
    expect(firstChild.type).toBe(CLIPBOARD_PLACEHOLDER);
  });

  // MUST create DATE_PLACEHOLDER with format prop for {{date:X}}
  it("deserializes {{date:iso}} placeholder", () => {
    const result = deserializeContent("{{date:iso}}");
    const firstChild = firstElementChild(result[0]) as TElement & {
      format: string;
    };
    expect(firstChild.type).toBe(DATE_PLACEHOLDER);
    expect(firstChild.format).toBe("iso");
  });

  it("deserializes {{date:long}} placeholder", () => {
    const result = deserializeContent("{{date:long}}");
    const firstChild = firstElementChild(result[0]) as TElement & {
      format: string;
    };
    expect(firstChild.format).toBe("long");
  });

  // MUST create CURSOR_PLACEHOLDER for {{cursor}}
  it("deserializes {{cursor}} placeholder", () => {
    const result = deserializeContent("{{cursor}}");
    const firstChild = firstElementChild(result[0]);
    expect(firstChild.type).toBe(CURSOR_PLACEHOLDER);
  });

  // MUST create DATEPICKER_PLACEHOLDER with date and optional format props
  it("deserializes datepicker placeholders with and without a format", () => {
    const legacy = deserializeContent("{{datepicker:2025-06-15}}");
    const legacyChild = firstElementChild(legacy[0]) as TElement & {
      date: string;
    };
    expect(legacyChild.type).toBe(DATEPICKER_PLACEHOLDER);
    expect(legacyChild.date).toBe("2025-06-15");
    expect(legacyChild.format).toBeUndefined();

    const formatted = deserializeContent("{{datepicker:2025-06-15:eu}}");
    const formattedChild = firstElementChild(formatted[0]) as TElement & {
      date: string;
      format?: string;
    };
    expect(formattedChild.type).toBe(DATEPICKER_PLACEHOLDER);
    expect(formattedChild.format).toBe("eu");
  });

  it("does not treat an unknown datepicker format as a placeholder", () => {
    const result = deserializeContent("{{datepicker:2025-06-15:tomato}}");
    const serialized = JSON.stringify(result);
    // Negative case: only the five known formats may become a picker node.
    expect(serialized).not.toContain(`"type":"${DATEPICKER_PLACEHOLDER}"`);
    expect(serialized).toContain("tomato");
  });

  // MUST create IMAGE_PLACEHOLDER with mediaId prop
  it("deserializes {{image:<uuid>}} placeholder", () => {
    const mediaId = "550e8400-e29b-41d4-a716-446655440000";
    const result = deserializeContent(`{{image:${mediaId}}}`);
    const firstChild = firstElementChild(result[0]) as TElement & {
      mediaId: string;
    };
    expect(firstChild.type).toBe(IMAGE_PLACEHOLDER);
    expect(firstChild.mediaId).toBe(mediaId);
  });

  // MUST create GIF_PLACEHOLDER with giphyId prop
  it("deserializes {{gif:<giphyId>}} placeholder", () => {
    const result = deserializeContent("{{gif:abc123XYZ}}");
    const firstChild = firstElementChild(result[0]) as TElement & {
      giphyId: string;
    };
    expect(firstChild.type).toBe(GIF_PLACEHOLDER);
    expect(firstChild.giphyId).toBe("abc123XYZ");
  });

  it("deserializes [label](url) as link element", () => {
    const result = deserializeContent("[Click here](https://example.com)");
    const firstChild = firstElementChild(result[0]) as TElement & {
      url: string;
    };
    expect(firstChild.type).toBe(LINK_ELEMENT);
    expect(firstChild.url).toBe("https://example.com");
  });

  it("deserializes **bold** as bold text node", () => {
    const result = deserializeContent("**bold**");
    expect(result[0].children[0]).toMatchObject({ text: "bold", bold: true });
  });

  it("deserializes _italic_ as italic text node", () => {
    const result = deserializeContent("_italic_");
    expect(result[0].children[0]).toMatchObject({
      text: "italic",
      italic: true,
    });
  });

  it("deserializes ~~strike~~ as strikethrough text node", () => {
    const result = deserializeContent("~~strike~~");
    expect(result[0].children[0]).toMatchObject({
      text: "strike",
      strikethrough: true,
    });
  });

  // code
  it("deserializes `code` as code text node", () => {
    const result = deserializeContent("`code`");
    expect(result[0].children[0]).toMatchObject({ text: "code", code: true });
  });

  it("deserializes <u>text</u> as underline text node", () => {
    const result = deserializeHtmlToNodes("<u>underlined</u>");
    expect(result[0].children[0]).toMatchObject({
      text: "underlined",
      underline: true,
    });
  });

  // a single newline is a soft break, not a paragraph boundary
  it("keeps a soft-wrapped line in one paragraph", () => {
    // This used to produce two paragraphs, one per line, which is wrong: in
    // markdown a lone newline inside a paragraph is a soft break. It also made
    // a hard-wrapped snippet gain a paragraph break on every save.
    const result = deserializeContent("Line one\nLine two");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("p");
    expect(result[0].children[0]).toMatchObject({ text: "Line one\nLine two" });
  });

  it("splits on a blank line", () => {
    const result = deserializeContent("Line one\n\nLine two");
    expect(result).toHaveLength(2);
    expect(result[0].children[0]).toMatchObject({ text: "Line one" });
    expect(result[1].children[0]).toMatchObject({ text: "Line two" });
  });
});

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe("serialize → deserialize → serialize round-trip", () => {
  const roundTrip = (md: string) => {
    const nodes = deserializeContent(md);
    return serializeToMarkdown(nodes);
  };

  it("round-trips plain text", () => {
    expect(roundTrip("Hello world")).toBe("Hello world");
  });

  it("round-trips bold text", () => {
    expect(roundTrip("**bold**")).toBe("**bold**");
  });

  it("round-trips italic text", () => {
    expect(roundTrip("_italic_")).toBe("_italic_");
  });

  it("round-trips clipboard placeholder", () => {
    expect(roundTrip("{{clipboard}}")).toBe("{{clipboard}}");
  });

  it("round-trips date placeholder", () => {
    expect(roundTrip("{{date:iso}}")).toBe("{{date:iso}}");
  });

  it("round-trips cursor placeholder", () => {
    expect(roundTrip("{{cursor}}")).toBe("{{cursor}}");
  });

  it("round-trips link", () => {
    expect(roundTrip("[Click here](https://example.com)")).toBe(
      "[Click here](https://example.com)"
    );
  });

  it("round-trips image placeholder", () => {
    const md = "{{image:550e8400-e29b-41d4-a716-446655440000}}";
    expect(roundTrip(md)).toBe(md);
  });

  it("round-trips gif placeholder", () => {
    expect(roundTrip("{{gif:abc123XYZ}}")).toBe("{{gif:abc123XYZ}}");
  });

  it("round-trips image placeholder with width", () => {
    const md = "{{image:550e8400-e29b-41d4-a716-446655440000:200}}";
    expect(roundTrip(md)).toBe(md);
  });

  it("round-trips gif placeholder with width", () => {
    expect(roundTrip("{{gif:abc123XYZ:350}}")).toBe("{{gif:abc123XYZ:350}}");
  });

  it("round-trips edited markdown with placeholders used by contenteditable expansion", () => {
    const md = "**Dear** {{clipboard}} _team_ {{cursor}}";
    expect(roundTrip(md)).toBe(md);
  });
});

// ---------------------------------------------------------------------------
// Width suffix — serialize / deserialize
// ---------------------------------------------------------------------------

describe("image/gif width suffix", () => {
  const mediaId = "550e8400-e29b-41d4-a716-446655440000";

  // ── serialize ──────────────────────────────────────────────────────────────

  it("serializes image node without width as {{image:<id>}}", () => {
    expect(serializeToMarkdown([p([imageNode(mediaId)])])).toBe(
      `{{image:${mediaId}}}`
    );
  });

  it("serializes image node with width as {{image:<id>:<width>}}", () => {
    expect(serializeToMarkdown([p([imageNode(mediaId, 200)])])).toBe(
      `{{image:${mediaId}:200}}`
    );
  });

  it("serializes gif node without width as {{gif:<id>}}", () => {
    expect(serializeToMarkdown([p([gifNode("abc123XYZ")])])).toBe(
      "{{gif:abc123XYZ}}"
    );
  });

  it("serializes gif node with width as {{gif:<id>:<width>}}", () => {
    expect(serializeToMarkdown([p([gifNode("abc123XYZ", 350)])])).toBe(
      "{{gif:abc123XYZ:350}}"
    );
  });

  // ── deserialize ────────────────────────────────────────────────────────────

  it("deserializes {{image:<id>}} without width — no width prop", () => {
    const result = deserializeContent(`{{image:${mediaId}}}`);
    const node = firstElementChild(result[0]) as TElement & {
      mediaId: string;
      width?: number;
    };
    expect(node.type).toBe(IMAGE_PLACEHOLDER);
    expect(node.mediaId).toBe(mediaId);
    expect(node.width).toBeUndefined();
  });

  it("deserializes {{image:<id>:200}} with width prop = 200", () => {
    const result = deserializeContent(`{{image:${mediaId}:200}}`);
    const node = firstElementChild(result[0]) as TElement & {
      mediaId: string;
      width?: number;
    };
    expect(node.type).toBe(IMAGE_PLACEHOLDER);
    expect(node.mediaId).toBe(mediaId);
    expect(node.width).toBe(200);
  });

  it("deserializes {{gif:<id>}} without width — no width prop", () => {
    const result = deserializeContent("{{gif:abc123XYZ}}");
    const node = firstElementChild(result[0]) as TElement & {
      giphyId: string;
      width?: number;
    };
    expect(node.type).toBe(GIF_PLACEHOLDER);
    expect(node.giphyId).toBe("abc123XYZ");
    expect(node.width).toBeUndefined();
  });

  it("deserializes {{gif:<id>:350}} with width prop = 350", () => {
    const result = deserializeContent("{{gif:abc123XYZ:350}}");
    const node = firstElementChild(result[0]) as TElement & {
      giphyId: string;
      width?: number;
    };
    expect(node.type).toBe(GIF_PLACEHOLDER);
    expect(node.giphyId).toBe("abc123XYZ");
    expect(node.width).toBe(350);
  });

  // ── mixed content ──────────────────────────────────────────────────────────

  it("deserializes text mixed with image+width placeholder", () => {
    const result = deserializeContent(`Hello {{image:${mediaId}:120}} world`);
    const children = result[0].children as Array<
      TElement & { mediaId?: string; width?: number }
    >;
    const imgNode = children.find((c) => c.type === IMAGE_PLACEHOLDER);
    expect(imgNode).toBeDefined();
    expect(imgNode!.width).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// markdownToHtml
// ---------------------------------------------------------------------------

describe("markdownToHtml", () => {
  // MUST return "" for empty/falsy input
  it("returns empty string for empty input", () => {
    expect(markdownToHtml("")).toBe("");
  });

  it("returns empty string for falsy input", () => {
    expect(markdownToHtml(null as any)).toBe("");
  });

  // MUST convert **text** → <strong>text</strong>
  it("converts bold markdown to strong tag", () => {
    expect(markdownToHtml("**bold**")).toBe("<strong>bold</strong>");
  });

  // MUST convert _text_ → <em>text</em>
  it("converts italic markdown to em tag", () => {
    expect(markdownToHtml("_italic_")).toBe("<em>italic</em>");
  });

  // MUST convert ~~text~~ → <s>text</s>
  it("converts strikethrough to s tag", () => {
    expect(markdownToHtml("~~strike~~")).toBe("<s>strike</s>");
  });

  // MUST convert `text` → <code>text</code>
  it("converts code to code tag", () => {
    expect(markdownToHtml("`code`")).toBe("<code>code</code>");
  });

  // MUST convert <u>text</u> → <u>text</u>
  it("passes through underline tag", () => {
    expect(markdownToHtml("<u>underline</u>")).toBe("<u>underline</u>");
  });

  // MUST convert [label](url) → <a> tag with target="_blank"
  it("converts links to anchor tags", () => {
    const result = markdownToHtml("[Click](https://example.com)");
    expect(result).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">Click</a>'
    );
  });

  it("escapes HTML special characters in plain text", () => {
    expect(markdownToHtml('Hello <world> & "friends"')).toBe(
      "Hello &lt;world&gt; &amp; &quot;friends&quot;"
    );
  });

  // MUST sanitize link URLs — block javascript:
  it("blocks javascript: URLs in links", () => {
    const result = markdownToHtml("[Click](javascript:alert(1))");
    expect(result).not.toContain("javascript:");
    expect(result).not.toContain("<a");
    expect(result).toContain("Click");
  });

  // MUST join lines with <br>
  it("joins multiple lines with <br>", () => {
    const result = markdownToHtml("Line one\nLine two");
    expect(result).toBe("Line one<br>Line two");
  });

  // bare domain → prepend https://
  it("prepends https:// to bare domains in links", () => {
    const result = markdownToHtml("[Click](example.com)");
    expect(result).toContain('href="https://example.com"');
  });

  it("converts image placeholder to img tag with data-clipio-media", () => {
    const mediaId = "550e8400-e29b-41d4-a716-446655440000";
    const result = markdownToHtml(`{{image:${mediaId}}}`);
    expect(result).toContain(`data-clipio-media="${mediaId}"`);
    expect(result).toContain("<img");
    expect(result).toContain('alt="image"');
  });

  // {{gif:<id>}} → <img src="https://media.giphy.com/media/<id>/giphy.gif" ...>
  it("converts gif placeholder to img tag with giphy URL", () => {
    const result = markdownToHtml("{{gif:abc123XYZ}}");
    expect(result).toContain(
      'src="https://media.giphy.com/media/abc123XYZ/giphy.gif"'
    );
    expect(result).toContain("<img");
    expect(result).toContain('alt="GIF"');
  });
});

// ---------------------------------------------------------------------------
// markdownToPlainText
// ---------------------------------------------------------------------------

describe("markdownToPlainText", () => {
  // MUST return "" for empty/falsy input
  it("returns empty string for empty input", () => {
    expect(markdownToPlainText("")).toBe("");
  });

  // MUST strip **text** → text
  it("strips bold marks", () => {
    expect(markdownToPlainText("**bold**")).toBe("bold");
  });

  // MUST strip _text_ → text
  it("strips italic marks", () => {
    expect(markdownToPlainText("_italic_")).toBe("italic");
  });

  // MUST strip ~~text~~ → text
  it("strips strikethrough marks", () => {
    expect(markdownToPlainText("~~strike~~")).toBe("strike");
  });

  // MUST strip `text` → text
  it("strips code marks", () => {
    expect(markdownToPlainText("`code`")).toBe("code");
  });

  // MUST strip <u>text</u> → text
  it("strips underline tags", () => {
    expect(markdownToPlainText("<u>underlined</u>")).toBe("underlined");
  });

  // MUST convert [label](url) → url
  it("converts links to URL only", () => {
    expect(markdownToPlainText("[Click here](https://example.com)")).toBe(
      "https://example.com"
    );
  });

  // MUST pass {{placeholder}} through unchanged
  it("passes clipboard placeholder through", () => {
    expect(markdownToPlainText("{{clipboard}}")).toBe("{{clipboard}}");
  });

  it("passes date placeholder through", () => {
    expect(markdownToPlainText("{{date:iso}}")).toBe("{{date:iso}}");
  });

  it("passes cursor placeholder through", () => {
    expect(markdownToPlainText("{{cursor}}")).toBe("{{cursor}}");
  });

  // Mixed content
  it("strips all marks from mixed content", () => {
    const result = markdownToPlainText("Hello **world** and _everyone_!");
    expect(result).toBe("Hello world and everyone!");
  });

  // MUST convert {{image:<id>}} → [image]
  it("converts image placeholder to [image]", () => {
    const mediaId = "550e8400-e29b-41d4-a716-446655440000";
    expect(markdownToPlainText(`{{image:${mediaId}}}`)).toBe("[image]");
  });

  // MUST convert {{gif:<id>}} → [GIF]
  it("converts gif placeholder to [GIF]", () => {
    expect(markdownToPlainText("{{gif:abc123XYZ}}")).toBe("[GIF]");
  });
});

/**
 * htmlToMarkdown is the editor-side converter used by the TextBlaze and Power
 * Text importers. It is DOM-based, so it only runs in a page — the legacy
 * contentFormat migration deliberately uses a different, DOM-free converter so
 * it can also run in the MV3 service worker. See
 */
describe("htmlToMarkdown", () => {
  it("returns empty for empty input", () => {
    expect(htmlToMarkdown("")).toBe("");
  });

  it("returns empty for whitespace-only input", () => {
    expect(htmlToMarkdown("   ")).toBe("");
  });

  it("converts a strong tag to bold markdown", () => {
    expect(htmlToMarkdown("<strong>x</strong>")).toContain("**x**");
  });

  it("passes plain text through", () => {
    expect(htmlToMarkdown("hello")).toContain("hello");
  });

  it("does not execute script content — only text is extracted", () => {
    // DOMParser produces an inert document, so nothing runs; the script's text
    // is what survives, not its behaviour.
    const out = htmlToMarkdown("<script>alert(1)</script>");
    expect(out).not.toContain("<script");
  });
});
