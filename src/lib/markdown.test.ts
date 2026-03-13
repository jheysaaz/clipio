/**
 * Tests for src/lib/markdown.ts — shared Markdown utilities
 * spec: specs/markdown.spec.md
 */

import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  sanitizeUrl,
  markdownInlineToHtml,
  markdownToHtml,
  markdownToPlainText,
} from "./markdown";

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe("escapeHtml", () => {
  // spec: MUST replace & with &amp;
  it("escapes ampersand", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  // spec: MUST replace < with &lt;
  it("escapes less-than", () => {
    expect(escapeHtml("<tag>")).toBe("&lt;tag&gt;");
  });

  // spec: MUST replace > with &gt;
  it("escapes greater-than", () => {
    expect(escapeHtml("a > b")).toBe("a &gt; b");
  });

  // spec: MUST replace " with &quot;
  it("escapes double quotes", () => {
    expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;");
  });

  // spec: & processed first to avoid double-escaping
  it("does not double-escape (& comes first)", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });

  // spec: MUST return input unchanged if no special chars
  it("returns plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  // spec: MUST return empty string for empty input
  it("returns empty string for empty input", () => {
    expect(escapeHtml("")).toBe("");
  });

  // Combined XSS scenario
  it("escapes full XSS payload", () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
    );
  });
});

// ---------------------------------------------------------------------------
// sanitizeUrl
// ---------------------------------------------------------------------------

describe("sanitizeUrl", () => {
  // spec: MUST allow http://
  it("allows http:// URLs unchanged", () => {
    expect(sanitizeUrl("http://example.com")).toBe("http://example.com");
  });

  // spec: MUST allow https://
  it("allows https:// URLs unchanged", () => {
    expect(sanitizeUrl("https://example.com/path?q=1")).toBe(
      "https://example.com/path?q=1"
    );
  });

  // spec: MUST allow mailto:
  it("allows mailto: URLs unchanged", () => {
    expect(sanitizeUrl("mailto:user@example.com")).toBe(
      "mailto:user@example.com"
    );
  });

  // spec: MUST block javascript:
  it("blocks javascript: scheme", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBe("");
  });

  // spec: MUST block data:
  it("blocks data: scheme", () => {
    expect(sanitizeUrl("data:text/html,<b>hi</b>")).toBe("");
  });

  // spec: MUST block vbscript:
  it("blocks vbscript: scheme", () => {
    expect(sanitizeUrl("vbscript:msgbox(1)")).toBe("");
  });

  // spec: MUST block other non-http schemes
  it("blocks ftp: scheme", () => {
    expect(sanitizeUrl("ftp://example.com")).toBe("");
  });

  it("blocks blob: scheme", () => {
    expect(sanitizeUrl("blob:https://example.com/uuid")).toBe("");
  });

  // spec: MUST prepend https:// to bare domains
  it("prepends https:// to bare domain", () => {
    expect(sanitizeUrl("example.com")).toBe("https://example.com");
  });

  it("prepends https:// to bare path", () => {
    expect(sanitizeUrl("www.example.com/path")).toBe(
      "https://www.example.com/path"
    );
  });

  // spec: MUST trim leading/trailing whitespace
  it("trims whitespace before processing", () => {
    expect(sanitizeUrl("  https://example.com  ")).toBe("https://example.com");
  });

  it("trims whitespace from javascript: too", () => {
    expect(sanitizeUrl("  javascript:alert(1)  ")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// markdownInlineToHtml
// ---------------------------------------------------------------------------

describe("markdownInlineToHtml", () => {
  // spec: plain text is escaped
  it("returns plain text escaped", () => {
    expect(markdownInlineToHtml("Hello world")).toBe("Hello world");
  });

  it("escapes HTML in plain text", () => {
    expect(markdownInlineToHtml("Hello <world>")).toBe("Hello &lt;world&gt;");
  });

  // spec: links processed before italic
  it("converts [label](url) to anchor tag", () => {
    const result = markdownInlineToHtml("[Click](https://example.com)");
    expect(result).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">Click</a>'
    );
  });

  it("adds target and rel attributes to links", () => {
    const result = markdownInlineToHtml("[x](https://x.com)");
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  // spec: blocked URL → escaped plain label text
  it("renders blocked URL as plain escaped text", () => {
    const result = markdownInlineToHtml("[Click](javascript:alert(1))");
    expect(result).not.toContain("<a");
    expect(result).toContain("Click");
  });

  // spec: **text** → <strong>
  it("converts bold to strong", () => {
    expect(markdownInlineToHtml("**bold**")).toBe("<strong>bold</strong>");
  });

  // spec: _text_ → <em>
  it("converts italic to em", () => {
    expect(markdownInlineToHtml("_italic_")).toBe("<em>italic</em>");
  });

  // spec: ~~text~~ → <s>
  it("converts strikethrough to s", () => {
    expect(markdownInlineToHtml("~~strike~~")).toBe("<s>strike</s>");
  });

  // spec: `text` → <code>
  it("converts code to code tag (content escaped)", () => {
    expect(markdownInlineToHtml("`code`")).toBe("<code>code</code>");
  });

  it("escapes code content", () => {
    expect(markdownInlineToHtml("`<div>`")).toBe("<code>&lt;div&gt;</code>");
  });

  // spec: <u>text</u> → <u>text</u>
  it("passes underline through", () => {
    expect(markdownInlineToHtml("<u>underline</u>")).toBe("<u>underline</u>");
  });

  // spec: nested marks — bold inside link label
  it("processes nested marks inside link labels", () => {
    const result = markdownInlineToHtml("[**bold**](https://example.com)");
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain("<a ");
  });

  // spec: MUST NOT infinite-loop on edge cases
  it("handles empty string without throwing", () => {
    expect(() => markdownInlineToHtml("")).not.toThrow();
    expect(markdownInlineToHtml("")).toBe("");
  });

  // spec: bare domain in link → prepend https://
  it("prepends https:// to bare domain links", () => {
    const result = markdownInlineToHtml("[Click](example.com)");
    expect(result).toContain('href="https://example.com"');
  });

  // spec: {{image:<uuid>}} → img with data-clipio-media and default style
  it("converts image placeholder to img tag with data-clipio-media", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const result = markdownInlineToHtml(`{{image:${uuid}}}`);
    expect(result).toContain(`data-clipio-media="${uuid}"`);
    expect(result).toContain('alt="image"');
    expect(result).toContain("max-width:100%");
    expect(result).not.toMatch(/style="[^"]*\bwidth:\d+px/);
  });

  // spec: {{image:<uuid>:<width>}} → img includes width style
  it("converts image placeholder with width to img with width style", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const result = markdownInlineToHtml(`{{image:${uuid}:200}}`);
    expect(result).toContain(`data-clipio-media="${uuid}"`);
    expect(result).toContain("width:200px");
    expect(result).toContain("max-width:100%");
  });

  // spec: {{gif:<id>}} → img with giphy CDN src and default style
  it("converts gif placeholder to img tag with giphy src", () => {
    const result = markdownInlineToHtml("{{gif:xT9IgG50Lgn6WDJyBW}}");
    expect(result).toContain(
      'src="https://media.giphy.com/media/xT9IgG50Lgn6WDJyBW/giphy.gif"'
    );
    expect(result).toContain('alt="GIF"');
    expect(result).not.toMatch(/style="[^"]*\bwidth:\d+px/);
  });

  // spec: {{gif:<id>:<width>}} → img includes width style
  it("converts gif placeholder with width to img with width style", () => {
    const result = markdownInlineToHtml("{{gif:xT9IgG50Lgn6WDJyBW:350}}");
    expect(result).toContain(
      'src="https://media.giphy.com/media/xT9IgG50Lgn6WDJyBW/giphy.gif"'
    );
    expect(result).toContain("width:350px");
    expect(result).toContain("max-width:100%");
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

  // spec: single line — no <br>
  it("returns single line without br", () => {
    expect(markdownToHtml("Hello world")).toBe("Hello world");
  });

  // spec: MUST join lines with <br>
  it("joins multiple lines with <br>", () => {
    expect(markdownToHtml("Line 1\nLine 2")).toBe("Line 1<br>Line 2");
  });

  it("handles three lines", () => {
    expect(markdownToHtml("A\nB\nC")).toBe("A<br>B<br>C");
  });

  // spec: br count === newline count
  it("produces correct number of <br> separators", () => {
    const input = "a\nb\nc\nd";
    const result = markdownToHtml(input);
    const brCount = (result.match(/<br>/g) || []).length;
    expect(brCount).toBe(3);
  });

  // Applies inline formatting per line
  it("applies inline markdown formatting per line", () => {
    expect(markdownToHtml("**bold**\n_italic_")).toBe(
      "<strong>bold</strong><br><em>italic</em>"
    );
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

  // spec: strips **bold**
  it("strips bold marks", () => {
    expect(markdownToPlainText("**bold**")).toBe("bold");
  });

  // spec: strips _italic_
  it("strips italic marks", () => {
    expect(markdownToPlainText("_italic_")).toBe("italic");
  });

  // spec: strips ~~strike~~
  it("strips strikethrough marks", () => {
    expect(markdownToPlainText("~~strike~~")).toBe("strike");
  });

  // spec: strips `code`
  it("strips code marks", () => {
    expect(markdownToPlainText("`code`")).toBe("code");
  });

  // spec: strips <u>text</u>
  it("strips underline tags", () => {
    expect(markdownToPlainText("<u>underline</u>")).toBe("underline");
  });

  // spec: [label](url) → url
  it("converts links to URL", () => {
    expect(markdownToPlainText("[Click](https://example.com)")).toBe(
      "https://example.com"
    );
  });

  // spec: passes {{placeholder}} through unchanged
  it("passes clipboard placeholder through", () => {
    expect(markdownToPlainText("{{clipboard}}")).toBe("{{clipboard}}");
  });

  it("passes date placeholder through", () => {
    expect(markdownToPlainText("{{date:iso}}")).toBe("{{date:iso}}");
  });

  it("passes cursor placeholder through", () => {
    expect(markdownToPlainText("{{cursor}}")).toBe("{{cursor}}");
  });

  // spec: {{image:...}} → [image]
  it("converts image placeholder to [image]", () => {
    expect(
      markdownToPlainText("{{image:550e8400-e29b-41d4-a716-446655440000}}")
    ).toBe("[image]");
  });

  // spec: {{image:...:width}} → [image]
  it("converts image placeholder with width to [image]", () => {
    expect(
      markdownToPlainText("{{image:550e8400-e29b-41d4-a716-446655440000:200}}")
    ).toBe("[image]");
  });

  // spec: {{gif:...}} → [GIF]
  it("converts gif placeholder to [GIF]", () => {
    expect(markdownToPlainText("{{gif:xT9IgG50Lgn6WDJyBW}}")).toBe("[GIF]");
  });

  // spec: {{gif:...:width}} → [GIF]
  it("converts gif placeholder with width to [GIF]", () => {
    expect(markdownToPlainText("{{gif:xT9IgG50Lgn6WDJyBW:350}}")).toBe("[GIF]");
  });

  // Combined
  it("strips all marks in mixed content", () => {
    expect(markdownToPlainText("Hello **world** and _everyone_!")).toBe(
      "Hello world and everyone!"
    );
  });
});
