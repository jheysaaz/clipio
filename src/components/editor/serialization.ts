import type { TText, TElement, Descendant } from "platejs";
import {
  CLIPBOARD_PLACEHOLDER,
  DATE_PLACEHOLDER,
  CURSOR_PLACEHOLDER,
  DATEPICKER_PLACEHOLDER,
  LINK_ELEMENT,
} from "./types";

// Type for parsed text nodes with marks
type TextWithMarks = { text: string } & { [key: string]: boolean | string };

// Pre-compiled regex patterns for better performance
const REGEX_PATTERNS = {
  clipboard: /^\{\{clipboard\}\}/,
  date: /^\{\{date:(iso|us|eu|long|short)\}\}/,
  cursor: /^\{\{cursor\}\}/,
  datepicker: /^\{\{datepicker:(\d{4}-\d{2}-\d{2})\}\}/,
  link: /^\[([^\]]+)\]\(([^)]+)\)/,
  bold: /^\*\*([^*]+)\*\*/,
  italic: /^_([^_]+)_/,
  strikethrough: /^~~([^~]+)~~/,
  code: /^`([^`]+)`/,
  underline: /^<u>([^<]+)<\/u>/,
  nextSpecial:
    /\[(?=[^\]]+\]\([^)]+\))|\*\*|_(?!_)|~~|`|<u>|\{\{clipboard\}\}|\{\{date:|\{\{cursor\}\}|\{\{datepicker:/,
  htmlTags: /<[a-z][\s\S]*>/i,
} as const;

// Serialize Plate value to Markdown
export function serializeToMarkdown(nodes: Descendant[]): string {
  return nodes.map((node) => serializeNode(node)).join("\n");
}

function serializeNode(node: Descendant): string {
  if ("text" in node) {
    let text = (node as TText).text;
    if (!text) return "";

    // Apply marks in order (code first to avoid escaping issues)
    if ((node as TText & { code?: boolean }).code) {
      text = `\`${text}\``;
    }
    if ((node as TText & { bold?: boolean }).bold) {
      text = `**${text}**`;
    }
    if ((node as TText & { italic?: boolean }).italic) {
      text = `_${text}_`;
    }
    if ((node as TText & { underline?: boolean }).underline) {
      text = `<u>${text}</u>`;
    }
    if ((node as TText & { strikethrough?: boolean }).strikethrough) {
      text = `~~${text}~~`;
    }
    return text;
  }

  const element = node as TElement;
  const children = element.children
    .map((child: Descendant) => serializeNode(child))
    .join("");

  if (element.type === CLIPBOARD_PLACEHOLDER) {
    return "{{clipboard}}";
  }

  if (element.type === DATE_PLACEHOLDER) {
    const format = (element as TElement & { format?: string }).format || "iso";
    return `{{date:${format}}}`;
  }

  if (element.type === CURSOR_PLACEHOLDER) {
    return "{{cursor}}";
  }

  if (element.type === DATEPICKER_PLACEHOLDER) {
    const date = (element as TElement & { date?: string }).date || "";
    return `{{datepicker:${date}}}`;
  }

  if (element.type === LINK_ELEMENT) {
    const url = (element as TElement & { url?: string }).url || "";
    return `[${children}](${url})`;
  }

  return children;
}

// Smart deserializer that handles both old HTML and new Markdown formats
export function deserializeContent(content: string): TElement[] {
  if (!content || content.trim() === "") {
    return [{ type: "p", children: [{ text: "" }] }];
  }

  if (REGEX_PATTERNS.htmlTags.test(content)) {
    return deserializeFromHtml(content);
  } else {
    return deserializeFromMarkdown(content);
  }
}

// Deserialize Markdown to Plate value
function deserializeFromMarkdown(markdown: string): TElement[] {
  if (!markdown || markdown.trim() === "") {
    return [{ type: "p", children: [{ text: "" }] }];
  }

  const paragraphs = markdown.split(/\n/);
  const result: TElement[] = [];

  for (const para of paragraphs) {
    const children = parseMarkdownInline(para);
    if (children.length > 0) {
      result.push({ type: "p", children });
    }
  }

  return result.length > 0 ? result : [{ type: "p", children: [{ text: "" }] }];
}

// Parse inline markdown formatting
function parseMarkdownInline(text: string): Descendant[] {
  const nodes: Descendant[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Check for clipboard placeholder
    const clipboardMatch = remaining.match(REGEX_PATTERNS.clipboard);
    if (clipboardMatch) {
      nodes.push({
        type: CLIPBOARD_PLACEHOLDER,
        children: [{ text: "" }],
      } as TElement);
      remaining = remaining.slice(clipboardMatch[0].length);
      continue;
    }

    // Check for date placeholder {{date:format}}
    const dateMatch = remaining.match(REGEX_PATTERNS.date);
    if (dateMatch) {
      nodes.push({
        type: DATE_PLACEHOLDER,
        format: dateMatch[1],
        children: [{ text: "" }],
      } as TElement & { format: string });
      remaining = remaining.slice(dateMatch[0].length);
      continue;
    }

    // Check for cursor placeholder {{cursor}}
    const cursorMatch = remaining.match(REGEX_PATTERNS.cursor);
    if (cursorMatch) {
      nodes.push({
        type: CURSOR_PLACEHOLDER,
        children: [{ text: "" }],
      } as TElement);
      remaining = remaining.slice(cursorMatch[0].length);
      continue;
    }

    // Check for datepicker placeholder {{datepicker:YYYY-MM-DD}}
    const datepickerMatch = remaining.match(REGEX_PATTERNS.datepicker);
    if (datepickerMatch) {
      nodes.push({
        type: DATEPICKER_PLACEHOLDER,
        date: datepickerMatch[1],
        children: [{ text: "" }],
      } as TElement & { date: string });
      remaining = remaining.slice(datepickerMatch[0].length);
      continue;
    }

    // Check for link [label](url) — must be before italic to avoid URL underscores triggering italic
    const linkMatch = remaining.match(REGEX_PATTERNS.link);
    if (linkMatch) {
      const linkChildren = parseMarkdownInline(linkMatch[1]);
      nodes.push({
        type: LINK_ELEMENT,
        url: linkMatch[2],
        children:
          linkChildren.length > 0 ? linkChildren : [{ text: linkMatch[1] }],
      } as TElement & { url: string });
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Check for bold **text**
    const boldMatch = remaining.match(REGEX_PATTERNS.bold);
    if (boldMatch) {
      nodes.push({ text: boldMatch[1], bold: true });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Check for italic _text_
    const italicMatch = remaining.match(REGEX_PATTERNS.italic);
    if (italicMatch) {
      nodes.push({ text: italicMatch[1], italic: true });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Check for strikethrough ~~text~~
    const strikeMatch = remaining.match(REGEX_PATTERNS.strikethrough);
    if (strikeMatch) {
      nodes.push({ text: strikeMatch[1], strikethrough: true });
      remaining = remaining.slice(strikeMatch[0].length);
      continue;
    }

    // Check for code `text`
    const codeMatch = remaining.match(REGEX_PATTERNS.code);
    if (codeMatch) {
      nodes.push({ text: codeMatch[1], code: true });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Check for underline <u>text</u>
    const underlineMatch = remaining.match(REGEX_PATTERNS.underline);
    if (underlineMatch) {
      nodes.push({ text: underlineMatch[1], underline: true });
      remaining = remaining.slice(underlineMatch[0].length);
      continue;
    }

    // Find next special character or take one char
    const nextSpecial = remaining.search(REGEX_PATTERNS.nextSpecial);
    if (nextSpecial === -1) {
      if (remaining) {
        nodes.push({ text: remaining });
      }
      break;
    } else if (nextSpecial === 0) {
      nodes.push({ text: remaining[0] });
      remaining = remaining.slice(1);
    } else {
      nodes.push({ text: remaining.slice(0, nextSpecial) });
      remaining = remaining.slice(nextSpecial);
    }
  }

  return nodes.length > 0 ? nodes : [{ text: "" }];
}

// Legacy HTML deserializer for backward compatibility
function deserializeFromHtml(html: string): TElement[] {
  if (!html || html.trim() === "") {
    return [{ type: "p", children: [{ text: "" }] }];
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const body = doc.body;

  const nodes = deserializeNodes(body);
  return nodes.length > 0
    ? wrapTextNodesInParagraphs(nodes)
    : [{ type: "p", children: [{ text: "" }] }];
}

function wrapTextNodesInParagraphs(nodes: Descendant[]): TElement[] {
  const result: TElement[] = [];
  let currentTextNodes: Descendant[] = [];

  const flushTextNodes = () => {
    if (currentTextNodes.length > 0) {
      result.push({ type: "p", children: currentTextNodes });
      currentTextNodes = [];
    }
  };

  nodes.forEach((node) => {
    if ("type" in node && (node as TElement).type) {
      flushTextNodes();
      result.push(node as TElement);
    } else {
      currentTextNodes.push(node);
    }
  });

  flushTextNodes();

  return result.length > 0 ? result : [{ type: "p", children: [{ text: "" }] }];
}

function deserializeNodes(element: Node): Descendant[] {
  const nodes: Descendant[] = [];

  element.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      if (text) {
        nodes.push({ text });
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const tagName = el.tagName.toLowerCase();

      // Check for clipboard placeholder
      if (
        el.classList.contains("clipboard-placeholder") ||
        el.classList.contains("bg-amber-100") ||
        el.textContent === "{{clipboard}}"
      ) {
        nodes.push({
          type: CLIPBOARD_PLACEHOLDER,
          children: [{ text: "" }],
        } as TElement);
        return;
      }

      // Handle block elements
      if (tagName === "p" || tagName === "div") {
        const children = deserializeNodes(el);
        nodes.push({
          type: "p",
          children: children.length > 0 ? children : [{ text: "" }],
        } as TElement);
        return;
      }

      // Handle inline marks
      const processInlineNode = (
        inlineEl: Element,
        inheritedMarks: Record<string, boolean>
      ): TextWithMarks[] => {
        const results: TextWithMarks[] = [];
        const tag = inlineEl.tagName.toLowerCase();
        const newMarks = { ...inheritedMarks };

        if (tag === "strong" || tag === "b") newMarks.bold = true;
        if (tag === "em" || tag === "i") newMarks.italic = true;
        if (tag === "u") newMarks.underline = true;
        if (tag === "s" || tag === "del" || tag === "strike")
          newMarks.strikethrough = true;
        if (tag === "code") newMarks.code = true;

        inlineEl.childNodes.forEach((child) => {
          if (child.nodeType === Node.TEXT_NODE) {
            const text = child.textContent || "";
            if (text) {
              results.push({ text, ...newMarks });
            }
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            results.push(...processInlineNode(child as Element, newMarks));
          }
        });

        return results;
      };

      // Handle link elements
      if (tagName === "a") {
        const url = el.getAttribute("href") || "";
        const linkChildren = deserializeNodes(el);
        nodes.push({
          type: LINK_ELEMENT,
          url,
          children:
            linkChildren.length > 0
              ? linkChildren
              : [{ text: el.textContent || "" }],
        } as TElement & { url: string });
        return;
      }

      if (
        ["strong", "b", "em", "i", "u", "s", "del", "strike", "code"].includes(
          tagName
        )
      ) {
        const inlineNodes = processInlineNode(el, {});
        nodes.push(...inlineNodes);
        return;
      }

      if (tagName === "br") {
        nodes.push({ text: "\n" });
        return;
      }

      if (tagName === "span") {
        const children = deserializeNodes(el);
        nodes.push(...children);
        return;
      }

      const children = deserializeNodes(el);
      nodes.push(...children);
    }
  });

  return nodes;
}

// ─── Markdown ↔ HTML / Plain-text converters (for copy & insertion) ────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return ""; // block javascript:, data:, etc.
  return `https://${trimmed}`;
}

function markdownInlineToHtml(text: string): string {
  let result = "";
  let remaining = text;

  while (remaining.length > 0) {
    // Link [label](url) — before italic
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      const label = markdownInlineToHtml(linkMatch[1]);
      const url = sanitizeUrl(linkMatch[2]);
      if (url) {
        result += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      } else {
        result += escapeHtml(linkMatch[1]);
      }
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      result += `<strong>${markdownInlineToHtml(boldMatch[1])}</strong>`;
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    const italicMatch = remaining.match(/^_([^_]+)_/);
    if (italicMatch) {
      result += `<em>${markdownInlineToHtml(italicMatch[1])}</em>`;
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    const strikeMatch = remaining.match(/^~~([^~]+)~~/);
    if (strikeMatch) {
      result += `<s>${markdownInlineToHtml(strikeMatch[1])}</s>`;
      remaining = remaining.slice(strikeMatch[0].length);
      continue;
    }

    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      result += `<code>${escapeHtml(codeMatch[1])}</code>`;
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    const underlineMatch = remaining.match(/^<u>([^<]+)<\/u>/);
    if (underlineMatch) {
      result += `<u>${markdownInlineToHtml(underlineMatch[1])}</u>`;
      remaining = remaining.slice(underlineMatch[0].length);
      continue;
    }

    const nextSpecial = remaining.search(
      /\[(?=[^\]]+\]\([^)]+\))|\*\*|_(?!_)|~~|`|<u>/
    );
    if (nextSpecial === -1) {
      result += escapeHtml(remaining);
      break;
    } else if (nextSpecial === 0) {
      result += escapeHtml(remaining[0]);
      remaining = remaining.slice(1);
    } else {
      result += escapeHtml(remaining.slice(0, nextSpecial));
      remaining = remaining.slice(nextSpecial);
    }
  }

  return result;
}

/** Convert markdown content to HTML string */
export function markdownToHtml(markdown: string): string {
  if (!markdown) return "";
  const paragraphs = markdown.split(/\n/);
  return paragraphs.map((p) => markdownInlineToHtml(p)).join("<br>");
}

/** Convert markdown content to plain text (strips all formatting, links → URL only) */
export function markdownToPlainText(markdown: string): string {
  if (!markdown) return "";
  let text = markdown;
  // Links → URL only
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$2");
  // Strip formatting marks
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/_([^_]+)_/g, "$1");
  text = text.replace(/~~([^~]+)~~/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/<u>([^<]+)<\/u>/g, "$1");
  return text;
}
