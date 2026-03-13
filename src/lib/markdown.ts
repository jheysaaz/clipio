/**
 * Shared Markdown ↔ HTML / plain-text conversion utilities.
 *
 * This module is the canonical implementation of Clipio's Markdown inline
 * formatting functions. It is imported by:
 *   - src/components/editor/serialization.ts  (editor layer)
 *   - src/lib/content-helpers.ts              (content script layer)
 *
 * All functions are pure (no side effects, no DOM access, no imports).
 *
 * @see specs/markdown.spec.md for the behavioral specification.
 */

// ---------------------------------------------------------------------------
// Escaping & sanitization
// ---------------------------------------------------------------------------

/**
 * Escape HTML special characters to prevent XSS when embedding text in HTML.
 * Processes & first to avoid double-escaping.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Sanitize a URL to prevent XSS via dangerous schemes.
 * - Allows: http://, https://, mailto:
 * - Blocks: javascript:, data:, vbscript:, and any other non-http scheme
 * - Prepends https:// to bare domains/paths with no scheme
 */
export function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return ""; // block dangerous schemes
  return `https://${trimmed}`;
}

// ---------------------------------------------------------------------------
// Inline Markdown → HTML
// ---------------------------------------------------------------------------

/**
 * Convert a single line of Clipio Markdown inline formatting to HTML.
 *
 * Processes (in priority order to avoid conflicts):
 *   1. Links [label](url) — before italic to avoid URL underscore conflicts
 *   2. Bold **text**
 *   3. Italic _text_
 *   4. Strikethrough ~~text~~
 *   5. Code `text`
 *   6. Underline <u>text</u>
 *   7. Plain text (escaped)
 */
export function markdownInlineToHtml(text: string): string {
  let result = "";
  let remaining = text;

  while (remaining.length > 0) {
    // Image placeholder {{image:<uuid>}} or {{image:<uuid>:<width>}}
    const imageMatch = remaining.match(
      /^\{\{image:([a-f0-9-]+)(?::(\d+))?\}\}/
    );
    if (imageMatch) {
      const mediaId = escapeHtml(imageMatch[1]);
      const width = imageMatch[2];
      const style = width
        ? `width:${width}px;max-width:100%;height:auto;`
        : `max-width:100%;height:auto;`;
      result += `<img data-clipio-media="${mediaId}" alt="image" style="${style}" />`;
      remaining = remaining.slice(imageMatch[0].length);
      continue;
    }

    // GIF placeholder {{gif:<giphyId>}} or {{gif:<giphyId>:<width>}}
    const gifMatch = remaining.match(/^\{\{gif:([a-zA-Z0-9]+)(?::(\d+))?\}\}/);
    if (gifMatch) {
      const giphyId = escapeHtml(gifMatch[1]);
      const width = gifMatch[2];
      const style = width
        ? `width:${width}px;max-width:100%;height:auto;`
        : `max-width:100%;height:auto;`;
      result += `<img src="https://media.giphy.com/media/${giphyId}/giphy.gif" alt="GIF" style="${style}" />`;
      remaining = remaining.slice(gifMatch[0].length);
      continue;
    }

    // Link [label](url) — must be before italic
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      const label = markdownInlineToHtml(linkMatch[1]); // recurse for nested marks
      const url = sanitizeUrl(linkMatch[2]);
      if (url) {
        result += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      } else {
        result += escapeHtml(linkMatch[1]);
      }
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Bold **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      result += `<strong>${markdownInlineToHtml(boldMatch[1])}</strong>`;
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic _text_
    const italicMatch = remaining.match(/^_([^_]+)_/);
    if (italicMatch) {
      result += `<em>${markdownInlineToHtml(italicMatch[1])}</em>`;
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Strikethrough ~~text~~
    const strikeMatch = remaining.match(/^~~([^~]+)~~/);
    if (strikeMatch) {
      result += `<s>${markdownInlineToHtml(strikeMatch[1])}</s>`;
      remaining = remaining.slice(strikeMatch[0].length);
      continue;
    }

    // Code `text`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      result += `<code>${escapeHtml(codeMatch[1])}</code>`;
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Underline <u>text</u>
    const underlineMatch = remaining.match(/^<u>([^<]+)<\/u>/);
    if (underlineMatch) {
      result += `<u>${markdownInlineToHtml(underlineMatch[1])}</u>`;
      remaining = remaining.slice(underlineMatch[0].length);
      continue;
    }

    // Find next special character to avoid O(n²) char-by-char processing
    const nextSpecial = remaining.search(
      /\[(?=[^\]]+\]\([^)]+\))|\*\*|_(?!_)|~~|`|<u>|\{\{image:|\{\{gif:/
    );
    if (nextSpecial === -1) {
      result += escapeHtml(remaining);
      break;
    } else if (nextSpecial === 0) {
      // No match at position 0 — consume one char to avoid infinite loop
      result += escapeHtml(remaining[0]);
      remaining = remaining.slice(1);
    } else {
      result += escapeHtml(remaining.slice(0, nextSpecial));
      remaining = remaining.slice(nextSpecial);
    }
  }

  return result;
}

/**
 * Convert full multi-line Clipio Markdown content to an HTML string.
 * Splits on \n, converts each line with markdownInlineToHtml, joins with <br>.
 */
export function markdownToHtml(content: string): string {
  if (!content) return "";
  const paragraphs = content.split(/\n/);
  return paragraphs.map((p) => markdownInlineToHtml(p)).join("<br>");
}

// ---------------------------------------------------------------------------
// Markdown → plain text
// ---------------------------------------------------------------------------

/**
 * Convert Clipio Markdown content to plain text by stripping all inline
 * formatting marks. Links are converted to their URL only.
 *
 * {{placeholder}} syntax is passed through unchanged.
 */
export function markdownToPlainText(content: string): string {
  if (!content) return "";
  let text = content;
  // Image/GIF placeholders → descriptive text (optional :width suffix)
  text = text.replace(/\{\{image:[a-f0-9-]+(?::\d+)?\}\}/g, "[image]");
  text = text.replace(/\{\{gif:[a-zA-Z0-9]+(?::\d+)?\}\}/g, "[GIF]");
  // Links → URL only (must run before stripping marks to avoid URL underscores matching italic)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$2");
  // Strip formatting marks
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1"); // bold
  text = text.replace(/_([^_]+)_/g, "$1"); // italic
  text = text.replace(/~~([^~]+)~~/g, "$1"); // strikethrough
  text = text.replace(/`([^`]+)`/g, "$1"); // code
  text = text.replace(/<u>([^<]+)<\/u>/g, "$1"); // underline
  return text;
}
