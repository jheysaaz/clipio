/**
 * Tests for src/components/editor/serialization.ts
 * spec: specs/serialization.spec.md
 */

import { describe, it, expect } from "vitest";
import {
  serializeToMarkdown,
  deserializeContent,
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

const datepickerNode = (date: string): TElement =>
  ({
    type: DATEPICKER_PLACEHOLDER,
    date,
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

// ---------------------------------------------------------------------------
// serializeToMarkdown
// ---------------------------------------------------------------------------

describe("serializeToMarkdown", () => {
  // spec: plain text node → text content
  it("serializes plain text", () => {
    expect(serializeToMarkdown([p([text("Hello world")])])).toBe("Hello world");
  });

  it("returns empty string for empty text node", () => {
    expect(serializeToMarkdown([p([text("")])])).toBe("");
  });

  // spec: bold mark → **text**
  it("serializes bold text", () => {
    expect(serializeToMarkdown([p([text("bold", { bold: true })])])).toBe(
      "**bold**"
    );
  });

  // spec: italic mark → _text_
  it("serializes italic text", () => {
    expect(serializeToMarkdown([p([text("italic", { italic: true })])])).toBe(
      "_italic_"
    );
  });

  // spec: underline mark → <u>text</u>
  it("serializes underline text", () => {
    expect(serializeToMarkdown([p([text("under", { underline: true })])])).toBe(
      "<u>under</u>"
    );
  });

  // spec: strikethrough mark → ~~text~~
  it("serializes strikethrough text", () => {
    expect(
      serializeToMarkdown([p([text("strike", { strikethrough: true })])])
    ).toBe("~~strike~~");
  });

  // spec: code mark → `text`
  it("serializes code text", () => {
    expect(serializeToMarkdown([p([text("code", { code: true })])])).toBe(
      "`code`"
    );
  });

  // spec: CLIPBOARD_PLACEHOLDER → {{clipboard}}
  it("serializes clipboard placeholder", () => {
    expect(serializeToMarkdown([p([clipboardNode()])])).toBe("{{clipboard}}");
  });

  // spec: DATE_PLACEHOLDER → {{date:format}}
  it("serializes date placeholder with format", () => {
    expect(serializeToMarkdown([p([dateNode("iso")])])).toBe("{{date:iso}}");
    expect(serializeToMarkdown([p([dateNode("us")])])).toBe("{{date:us}}");
    expect(serializeToMarkdown([p([dateNode("long")])])).toBe("{{date:long}}");
  });

  // spec: CURSOR_PLACEHOLDER → {{cursor}}
  it("serializes cursor placeholder", () => {
    expect(serializeToMarkdown([p([cursorNode()])])).toBe("{{cursor}}");
  });

  // spec: DATEPICKER_PLACEHOLDER → {{datepicker:date}}
  it("serializes datepicker placeholder", () => {
    expect(serializeToMarkdown([p([datepickerNode("2025-06-15")])])).toBe(
      "{{datepicker:2025-06-15}}"
    );
  });

  // spec: LINK_ELEMENT → [label](url)
  it("serializes link element", () => {
    expect(
      serializeToMarkdown([p([linkNode("https://example.com", "Click here")])])
    ).toBe("[Click here](https://example.com)");
  });

  // spec: IMAGE_PLACEHOLDER → {{image:<mediaId>}}
  it("serializes image placeholder", () => {
    const mediaId = "550e8400-e29b-41d4-a716-446655440000";
    expect(serializeToMarkdown([p([imageNode(mediaId)])])).toBe(
      `{{image:${mediaId}}}`
    );
  });

  // spec: GIF_PLACEHOLDER → {{gif:<giphyId>}}
  it("serializes gif placeholder", () => {
    expect(serializeToMarkdown([p([gifNode("abc123XYZ")])])).toBe(
      "{{gif:abc123XYZ}}"
    );
  });

  // spec: multiple paragraphs joined with \n
  it("joins multiple paragraphs with newline", () => {
    const result = serializeToMarkdown([
      p([text("First line")]),
      p([text("Second line")]),
    ]);
    expect(result).toBe("First line\nSecond line");
  });

  // spec: mixed content in same paragraph
  it("serializes mixed text and placeholders", () => {
    const result = serializeToMarkdown([
      p([text("Hello "), clipboardNode(), text(" world")]),
    ]);
    expect(result).toBe("Hello {{clipboard}} world");
  });
});

// ---------------------------------------------------------------------------
// deserializeContent
// ---------------------------------------------------------------------------

describe("deserializeContent", () => {
  // spec: empty input → single empty paragraph
  it("returns empty paragraph for empty string", () => {
    const result = deserializeContent("");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("p");
  });

  it("returns empty paragraph for whitespace-only string", () => {
    const result = deserializeContent("   ");
    expect(result).toHaveLength(1);
  });

  // spec: delegates to markdown deserializer for plain text
  it("deserializes plain markdown", () => {
    const result = deserializeContent("Hello world");
    expect(result[0].children[0]).toMatchObject({ text: "Hello world" });
  });

  // spec: delegates to HTML deserializer when content has HTML tags
  it("delegates to HTML deserializer for HTML content", () => {
    const result = deserializeContent("<p>Hello</p>");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("p");
  });

  // spec: HTML <a> tags → LINK_ELEMENT
  it("deserializes HTML <a> tags as link elements", () => {
    const result = deserializeContent(
      '<p><a href="https://example.com">Click</a></p>'
    );
    expect(result).toHaveLength(1);
    const link = result[0].children[0] as TElement & { url: string };
    expect(link.type).toBe(LINK_ELEMENT);
    expect(link.url).toBe("https://example.com");
  });

  // spec: HTML <a> with empty content → uses textContent fallback
  it("deserializes HTML <a> with no children", () => {
    const result = deserializeContent(
      '<p><a href="https://example.com"></a></p>'
    );
    expect(result).toHaveLength(1);
    const link = result[0].children[0] as TElement & { url: string };
    expect(link.type).toBe(LINK_ELEMENT);
  });

  // spec: HTML <br> → newline text node
  it("deserializes HTML <br> as newline text", () => {
    const result = deserializeContent("<p>Line one<br>Line two</p>");
    expect(result).toHaveLength(1);
    const texts = result[0].children.map((c) =>
      "text" in c ? (c as TText).text : ""
    );
    expect(texts).toContain("\n");
  });

  // spec: HTML <span> → recurse into children
  it("deserializes HTML <span> by recursing into children", () => {
    const result = deserializeContent("<p><span>wrapped text</span></p>");
    expect(result).toHaveLength(1);
    const text = result[0].children[0] as TText;
    expect(text.text).toBe("wrapped text");
  });

  // spec: HTML inline formatting elements: <strong>, <em>, <code>, etc.
  it("deserializes HTML <strong> as bold mark", () => {
    const result = deserializeContent("<p><strong>bold</strong></p>");
    expect(result[0].children[0]).toMatchObject({ text: "bold", bold: true });
  });

  it("deserializes HTML <em> as italic mark", () => {
    const result = deserializeContent("<p><em>italic</em></p>");
    expect(result[0].children[0]).toMatchObject({
      text: "italic",
      italic: true,
    });
  });

  it("deserializes HTML <code> as code mark", () => {
    const result = deserializeContent("<p><code>code</code></p>");
    expect(result[0].children[0]).toMatchObject({ text: "code", code: true });
  });

  it("deserializes HTML <s> as strikethrough mark", () => {
    const result = deserializeContent("<p><s>struck</s></p>");
    expect(result[0].children[0]).toMatchObject({
      text: "struck",
      strikethrough: true,
    });
  });

  // spec: HTML nested inline marks: <strong><em>text</em></strong>
  it("deserializes nested HTML inline marks", () => {
    const result = deserializeContent(
      "<p><strong><em>bold italic</em></strong></p>"
    );
    expect(result[0].children[0]).toMatchObject({
      text: "bold italic",
      bold: true,
      italic: true,
    });
  });

  // spec: HTML <del> as strikethrough
  it("deserializes HTML <del> as strikethrough mark", () => {
    const result = deserializeContent("<p><del>deleted</del></p>");
    expect(result[0].children[0]).toMatchObject({
      text: "deleted",
      strikethrough: true,
    });
  });

  // spec: HTML <b> as bold (alias for <strong>)
  it("deserializes HTML <b> as bold mark", () => {
    const result = deserializeContent("<p><b>bold</b></p>");
    expect(result[0].children[0]).toMatchObject({ text: "bold", bold: true });
  });

  // spec: HTML <i> as italic (alias for <em>)
  it("deserializes HTML <i> as italic mark", () => {
    const result = deserializeContent("<p><i>italic</i></p>");
    expect(result[0].children[0]).toMatchObject({
      text: "italic",
      italic: true,
    });
  });

  // spec: HTML <u> as underline
  it("deserializes HTML <u> inside a paragraph as underline mark", () => {
    const result = deserializeContent("<p><u>underlined</u></p>");
    expect(result[0].children[0]).toMatchObject({
      text: "underlined",
      underline: true,
    });
  });

  // spec: HTML unknown elements → recurse into children
  it("deserializes unknown HTML elements by recursing into children", () => {
    const result = deserializeContent("<p><section>content</section></p>");
    // The content should still appear
    const allText = result
      .flatMap((el) =>
        el.children.map((c) => ("text" in c ? (c as TText).text : ""))
      )
      .join("");
    expect(allText).toContain("content");
  });

  // spec: HTML <div> → paragraph
  it("deserializes HTML <div> as paragraph", () => {
    const result = deserializeContent("<div>div content</div>");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("p");
  });

  // spec: returns non-empty array always
  it("always returns at least one element", () => {
    expect(deserializeContent("")).toHaveLength(1);
    expect(deserializeContent("text")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// deserializeFromMarkdown (via deserializeContent)
// ---------------------------------------------------------------------------

describe("deserializeContent (markdown path)", () => {
  // spec: MUST create CLIPBOARD_PLACEHOLDER for {{clipboard}}
  it("deserializes {{clipboard}} placeholder", () => {
    const result = deserializeContent("{{clipboard}}");
    const firstChild = result[0].children[0] as TElement;
    expect(firstChild.type).toBe(CLIPBOARD_PLACEHOLDER);
  });

  // spec: MUST create DATE_PLACEHOLDER with format prop for {{date:X}}
  it("deserializes {{date:iso}} placeholder", () => {
    const result = deserializeContent("{{date:iso}}");
    const firstChild = result[0].children[0] as TElement & { format: string };
    expect(firstChild.type).toBe(DATE_PLACEHOLDER);
    expect(firstChild.format).toBe("iso");
  });

  it("deserializes {{date:long}} placeholder", () => {
    const result = deserializeContent("{{date:long}}");
    const firstChild = result[0].children[0] as TElement & { format: string };
    expect(firstChild.format).toBe("long");
  });

  // spec: MUST create CURSOR_PLACEHOLDER for {{cursor}}
  it("deserializes {{cursor}} placeholder", () => {
    const result = deserializeContent("{{cursor}}");
    const firstChild = result[0].children[0] as TElement;
    expect(firstChild.type).toBe(CURSOR_PLACEHOLDER);
  });

  // spec: MUST create DATEPICKER_PLACEHOLDER with date prop
  it("deserializes {{datepicker:YYYY-MM-DD}} placeholder", () => {
    const result = deserializeContent("{{datepicker:2025-06-15}}");
    const firstChild = result[0].children[0] as TElement & { date: string };
    expect(firstChild.type).toBe(DATEPICKER_PLACEHOLDER);
    expect(firstChild.date).toBe("2025-06-15");
  });

  // spec: MUST create IMAGE_PLACEHOLDER with mediaId prop
  it("deserializes {{image:<uuid>}} placeholder", () => {
    const mediaId = "550e8400-e29b-41d4-a716-446655440000";
    const result = deserializeContent(`{{image:${mediaId}}}`);
    const firstChild = result[0].children[0] as TElement & { mediaId: string };
    expect(firstChild.type).toBe(IMAGE_PLACEHOLDER);
    expect(firstChild.mediaId).toBe(mediaId);
  });

  // spec: MUST create GIF_PLACEHOLDER with giphyId prop
  it("deserializes {{gif:<giphyId>}} placeholder", () => {
    const result = deserializeContent("{{gif:abc123XYZ}}");
    const firstChild = result[0].children[0] as TElement & { giphyId: string };
    expect(firstChild.type).toBe(GIF_PLACEHOLDER);
    expect(firstChild.giphyId).toBe("abc123XYZ");
  });

  // spec: MUST create LINK_ELEMENT for [label](url)
  it("deserializes [label](url) as link element", () => {
    const result = deserializeContent("[Click here](https://example.com)");
    const firstChild = result[0].children[0] as TElement & { url: string };
    expect(firstChild.type).toBe(LINK_ELEMENT);
    expect(firstChild.url).toBe("https://example.com");
  });

  // spec: MUST create bold text node for **text**
  it("deserializes **bold** as bold text node", () => {
    const result = deserializeContent("**bold**");
    expect(result[0].children[0]).toMatchObject({ text: "bold", bold: true });
  });

  // spec: italic
  it("deserializes _italic_ as italic text node", () => {
    const result = deserializeContent("_italic_");
    expect(result[0].children[0]).toMatchObject({
      text: "italic",
      italic: true,
    });
  });

  // spec: strikethrough
  it("deserializes ~~strike~~ as strikethrough text node", () => {
    const result = deserializeContent("~~strike~~");
    expect(result[0].children[0]).toMatchObject({
      text: "strike",
      strikethrough: true,
    });
  });

  // spec: code
  it("deserializes `code` as code text node", () => {
    const result = deserializeContent("`code`");
    expect(result[0].children[0]).toMatchObject({ text: "code", code: true });
  });

  // spec: underline
  it("deserializes <u>text</u> as underline text node", () => {
    const result = deserializeContent("<u>underlined</u>");
    expect(result[0].children[0]).toMatchObject({
      text: "underlined",
      underline: true,
    });
  });

  // spec: multi-paragraph — one paragraph per \n line
  it("creates one paragraph per line", () => {
    const result = deserializeContent("Line one\nLine two");
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
    const node = result[0].children[0] as TElement & {
      mediaId: string;
      width?: number;
    };
    expect(node.type).toBe(IMAGE_PLACEHOLDER);
    expect(node.mediaId).toBe(mediaId);
    expect(node.width).toBeUndefined();
  });

  it("deserializes {{image:<id>:200}} with width prop = 200", () => {
    const result = deserializeContent(`{{image:${mediaId}:200}}`);
    const node = result[0].children[0] as TElement & {
      mediaId: string;
      width?: number;
    };
    expect(node.type).toBe(IMAGE_PLACEHOLDER);
    expect(node.mediaId).toBe(mediaId);
    expect(node.width).toBe(200);
  });

  it("deserializes {{gif:<id>}} without width — no width prop", () => {
    const result = deserializeContent("{{gif:abc123XYZ}}");
    const node = result[0].children[0] as TElement & {
      giphyId: string;
      width?: number;
    };
    expect(node.type).toBe(GIF_PLACEHOLDER);
    expect(node.giphyId).toBe("abc123XYZ");
    expect(node.width).toBeUndefined();
  });

  it("deserializes {{gif:<id>:350}} with width prop = 350", () => {
    const result = deserializeContent("{{gif:abc123XYZ:350}}");
    const node = result[0].children[0] as TElement & {
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
  // spec: MUST return "" for empty/falsy input
  it("returns empty string for empty input", () => {
    expect(markdownToHtml("")).toBe("");
  });

  it("returns empty string for falsy input", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(markdownToHtml(null as any)).toBe("");
  });

  // spec: MUST convert **text** → <strong>text</strong>
  it("converts bold markdown to strong tag", () => {
    expect(markdownToHtml("**bold**")).toBe("<strong>bold</strong>");
  });

  // spec: MUST convert _text_ → <em>text</em>
  it("converts italic markdown to em tag", () => {
    expect(markdownToHtml("_italic_")).toBe("<em>italic</em>");
  });

  // spec: MUST convert ~~text~~ → <s>text</s>
  it("converts strikethrough to s tag", () => {
    expect(markdownToHtml("~~strike~~")).toBe("<s>strike</s>");
  });

  // spec: MUST convert `text` → <code>text</code>
  it("converts code to code tag", () => {
    expect(markdownToHtml("`code`")).toBe("<code>code</code>");
  });

  // spec: MUST convert <u>text</u> → <u>text</u>
  it("passes through underline tag", () => {
    expect(markdownToHtml("<u>underline</u>")).toBe("<u>underline</u>");
  });

  // spec: MUST convert [label](url) → <a> tag with target="_blank"
  it("converts links to anchor tags", () => {
    const result = markdownToHtml("[Click](https://example.com)");
    expect(result).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">Click</a>'
    );
  });

  // spec: MUST escape HTML special characters in plain text
  it("escapes HTML special characters in plain text", () => {
    expect(markdownToHtml('Hello <world> & "friends"')).toBe(
      "Hello &lt;world&gt; &amp; &quot;friends&quot;"
    );
  });

  // spec: MUST sanitize link URLs — block javascript:
  it("blocks javascript: URLs in links", () => {
    const result = markdownToHtml("[Click](javascript:alert(1))");
    expect(result).not.toContain("javascript:");
    expect(result).not.toContain("<a");
    expect(result).toContain("Click");
  });

  // spec: MUST join lines with <br>
  it("joins multiple lines with <br>", () => {
    const result = markdownToHtml("Line one\nLine two");
    expect(result).toBe("Line one<br>Line two");
  });

  // spec: bare domain → prepend https://
  it("prepends https:// to bare domains in links", () => {
    const result = markdownToHtml("[Click](example.com)");
    expect(result).toContain('href="https://example.com"');
  });

  // spec: {{image:<id>}} → <img data-clipio-media="<id>" ...>
  it("converts image placeholder to img tag with data-clipio-media", () => {
    const mediaId = "550e8400-e29b-41d4-a716-446655440000";
    const result = markdownToHtml(`{{image:${mediaId}}}`);
    expect(result).toContain(`data-clipio-media="${mediaId}"`);
    expect(result).toContain("<img");
    expect(result).toContain('alt="image"');
  });

  // spec: {{gif:<id>}} → <img src="https://media.giphy.com/media/<id>/giphy.gif" ...>
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
  // spec: MUST return "" for empty/falsy input
  it("returns empty string for empty input", () => {
    expect(markdownToPlainText("")).toBe("");
  });

  // spec: MUST strip **text** → text
  it("strips bold marks", () => {
    expect(markdownToPlainText("**bold**")).toBe("bold");
  });

  // spec: MUST strip _text_ → text
  it("strips italic marks", () => {
    expect(markdownToPlainText("_italic_")).toBe("italic");
  });

  // spec: MUST strip ~~text~~ → text
  it("strips strikethrough marks", () => {
    expect(markdownToPlainText("~~strike~~")).toBe("strike");
  });

  // spec: MUST strip `text` → text
  it("strips code marks", () => {
    expect(markdownToPlainText("`code`")).toBe("code");
  });

  // spec: MUST strip <u>text</u> → text
  it("strips underline tags", () => {
    expect(markdownToPlainText("<u>underlined</u>")).toBe("underlined");
  });

  // spec: MUST convert [label](url) → url
  it("converts links to URL only", () => {
    expect(markdownToPlainText("[Click here](https://example.com)")).toBe(
      "https://example.com"
    );
  });

  // spec: MUST pass {{placeholder}} through unchanged
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

  // spec: MUST convert {{image:<id>}} → [image]
  it("converts image placeholder to [image]", () => {
    const mediaId = "550e8400-e29b-41d4-a716-446655440000";
    expect(markdownToPlainText(`{{image:${mediaId}}}`)).toBe("[image]");
  });

  // spec: MUST convert {{gif:<id>}} → [GIF]
  it("converts gif placeholder to [GIF]", () => {
    expect(markdownToPlainText("{{gif:abc123XYZ}}")).toBe("[GIF]");
  });
});
