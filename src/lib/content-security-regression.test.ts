/**
 * Security Regression Tests for Content Expansion
 *
 * spec: specs/content-expansion.spec.md + specs/markdown.spec.md
 *
 * Exercises the real production sanitizers:
 *   - sanitizeUrl / escapeHtml / markdownInlineToHtml / markdownToHtml
 *     (src/lib/markdown.ts)
 *   - escapeHtmlAttr (src/lib/content-helpers.ts)
 *
 * Verifies that dangerous content cannot be injected or executed through:
 * 1. Malicious link schemes (javascript:, data:, vbscript:, mixed-case, //)
 * 2. HTML-like snippet content
 * 3. Attribute injection via image alt text
 * 4. GIF placeholder IDs
 * 5. Markdown → HTML conversion
 */

import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  sanitizeUrl,
  markdownInlineToHtml,
  markdownToHtml,
} from "./markdown";
import { escapeHtmlAttr } from "./content-helpers";

describe("Content Expansion Security", () => {
  // ──────────────────────────────────────────────────────────────────
  // 1: Dangerous Link Schemes → sanitizeUrl
  // ──────────────────────────────────────────────────────────────────

  // Unit-level scheme blocking for javascript:, data:, vbscript: and bare
  // domain prepending lives in markdown.test.ts (the authority for markdown.ts
  // primitives). This suite keeps only the expansion-pipeline-specific cases.
  describe("Dangerous Link Scheme Prevention (sanitizeUrl)", () => {
    it("rejects mixed-case JaVaScRiPt: URLs", () => {
      expect(sanitizeUrl("JaVaScRiPt:alert('XSS')")).toBe("");
    });

    it("rejects protocol-relative //evil.com URLs by treating them as bare hosts", () => {
      // No scheme → never passed through as protocol-relative
      expect(sanitizeUrl("//evil.com")).not.toMatch(/^\/\//);
    });

    it("rejects unknown schemes (about:, file:, jar:)", () => {
      for (const url of [
        "about:blank",
        "file:///etc/passwd",
        "jar:http://example.com!/path",
      ]) {
        expect(sanitizeUrl(url)).toBe("");
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 2: HTML-Like Snippet Content → escapeHtml / markdownToHtml
  // ──────────────────────────────────────────────────────────────────

  describe("HTML Content Safety (escapeHtml / markdownToHtml)", () => {
    it("escapes script tags in plain snippet content", () => {
      const result = escapeHtml(
        "This is a snippet with <script>alert('xss')</script>"
      );
      expect(result).toContain("&lt;script&gt;");
      expect(result).not.toContain("<script>");
    });

    it("escapes script tags when converting markdown to HTML", () => {
      const result = markdownToHtml(
        "Snippet with <script>alert('xss')</script>"
      );
      expect(result).not.toContain("<script>");
      expect(result).toContain("&lt;script&gt;");
    });

    it("does not emit raw HTML tags from plain markdown text", () => {
      const result = markdownToHtml("Hello <img src=x onerror=alert(1)> world");
      // Angle brackets are escaped, so the img tag cannot open/execute;
      // the onerror= text remains only as inert escaped character data.
      expect(result).not.toContain("<img");
      expect(result).toContain("&lt;img");
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 3: Image Alt Text → escapeHtmlAttr
  // ──────────────────────────────────────────────────────────────────

  describe("Image Alt Text Security (escapeHtmlAttr)", () => {
    it("escapes double quotes to prevent attribute breakout", () => {
      expect(escapeHtmlAttr('A quote" in alt')).toBe("A quote&quot; in alt");
    });

    it("escapes single quotes to prevent attribute breakout", () => {
      expect(escapeHtmlAttr("It's alt")).toBe("It&#39;s alt");
    });

    it("escapes angle brackets", () => {
      expect(escapeHtmlAttr("<img>")).toBe("&lt;img&gt;");
    });

    it("neutralizes an onerror payload when embedded as an attribute value", () => {
      const payload = '"><img src=x onerror="alert(1)">';
      const escaped = escapeHtmlAttr(payload);
      expect(escaped).not.toContain('"><img');
      expect(escaped).toContain("&quot;");
      expect(escaped).not.toMatch(/=["'].*onerror/);
    });

    it("escapes ampersands first to avoid double-escape reordering issues", () => {
      expect(escapeHtmlAttr("&quot;")).toBe("&amp;quot;");
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 4: GIF ID Validation (markdown placeholder regex)
  // ──────────────────────────────────────────────────────────────────

  // Asserts through the production renderer (markdownInlineToHtml) rather
  // than re-implementing the placeholder regex in the test.
  describe("GIF ID Safety", () => {
    it("emits only a safe giphy CDN src for a valid ID", () => {
      const html = markdownInlineToHtml("{{gif:xT9IgG50Lgn6WDJyBW}}");
      expect(html).toContain(
        'src="https://media.giphy.com/media/xT9IgG50Lgn6WDJyBW/giphy.gif"'
      );
      expect(html).not.toContain("<script");
    });

    it("does not emit an img for path-traversal GIF IDs", () => {
      expect(markdownInlineToHtml("{{gif:../../../etc/passwd}}")).not.toContain(
        "<img"
      );
    });

    it("does not emit an img or live script for HTML in GIF IDs", () => {
      const html = markdownInlineToHtml("{{gif:<script>alert(1)</script>}}");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("<script");
    });

    it("does not emit an img for SQL-injection-looking GIF IDs", () => {
      expect(markdownInlineToHtml("{{gif:'; DROP TABLE--}}")).not.toContain(
        "<img"
      );
    });

    it("does not emit an img for percent-encoded script GIF IDs", () => {
      expect(markdownInlineToHtml("{{gif:%3Cscript%3E}}")).not.toContain(
        "<img"
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // 5: Markdown link / code conversion safety
  // ──────────────────────────────────────────────────────────────────

  // Unit-level link rendering (blocked javascript: URLs, rel/noopener,
  // inline code escaping) lives in markdown.test.ts. This suite keeps the
  // expansion-pipeline-specific conversions.
  describe("Markdown Conversion Security", () => {
    it("renders data: markdown links as escaped plain text (no <a>)", () => {
      const result = markdownInlineToHtml(
        "[x](data:text/html,<script>alert(1)</script>)"
      );
      expect(result).not.toContain("<a");
      expect(result).not.toContain("data:");
    });

    it("renders mixed-case javascript: markdown links as escaped plain text", () => {
      const result = markdownInlineToHtml("[x](JaVaScRiPt:alert(1))");
      expect(result).not.toContain("<a");
      expect(result).toContain("x");
    });

    it("does not execute or emit raw HTML from code-block-style input", () => {
      const result = markdownToHtml("```javascript\nalert('xss');\n```");
      expect(result).not.toContain("<script");
      // Fence backticks pass through as escaped text — never as live HTML
      expect(result).toContain("```");
    });
  });
});
