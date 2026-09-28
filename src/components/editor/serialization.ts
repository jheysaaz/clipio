import type { TText, TElement, Descendant } from "platejs";
import { parseBlocks } from "./block-grammar";
import {
  formatImagePlaceholder,
  formatGifPlaceholder,
} from "@/lib/media-placeholders";
import {
  CLIPBOARD_PLACEHOLDER,
  DATE_PLACEHOLDER,
  CURSOR_PLACEHOLDER,
  DATEPICKER_PLACEHOLDER,
  IMAGE_PLACEHOLDER,
  GIF_PLACEHOLDER,
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
  // Width suffix (:NNN) is optional — matches both {{image:uuid}} and
  // {{image:uuid:200}}. Owned by specs/media-placeholders.spec.md.
  image: IMAGE_PLACEHOLDER_ANCHORED,
  gif: GIF_PLACEHOLDER_ANCHORED,
  link: /^\[([^\]]+)\]\(([^)]+)\)/,
  bold: /^\*\*([^*]+)\*\*/,
  italic: /^_([^_]+)_/,
  strikethrough: /^~~([^~]+)~~/,
  code: /^`([^`]+)`/,
  underline: /^<u>([^<]+)<\/u>/,
  nextSpecial:
    /\[(?=[^\]]+\]\([^)]+\))|\*\*|_(?!_)|~~|`|<u>|\{\{clipboard\}\}|\{\{date:|\{\{cursor\}\}|\{\{datepicker:|\{\{image:|\{\{gif:/,
  htmlTags: /<[a-z][\s\S]*>/i,
} as const;

// Serialize Plate value to Markdown
export function serializeToMarkdown(nodes: Descendant[]): string {
  // Top-level blocks are separated by a blank line. A single newline is enough
  // to start a new block in CommonMark, but a paragraph needs a blank line
  // before it — joining with "\n" meant every block boundary was ambiguous and
  // a document lost all its structure on the next parse.
  return nodes
    .map((node) => serializeNode(node))
    .filter((text) => text !== "")
    .join("\n\n");
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

  if (element.type === IMAGE_PLACEHOLDER) {
    const mediaId = (element as TElement & { mediaId?: string }).mediaId || "";
    // `formatImagePlaceholder` distinguishes `undefined` from `0`. The inline
    // `width ? ... : ...` this replaced treated a zero width as absent, so
    // `{{image:id:0}}` silently lost its width on every save.
    return formatImagePlaceholder(
      mediaId,
      (element as TElement & { width?: number }).width
    );
  }

  if (element.type === GIF_PLACEHOLDER) {
    const giphyId = (element as TElement & { giphyId?: string }).giphyId || "";
    return formatGifPlaceholder(
      giphyId,
      (element as TElement & { width?: number }).width
    );
  }

  if (element.type === LINK_ELEMENT) {
    const url = (element as TElement & { url?: string }).url || "";
    return `[${children}](${url})`;
  }

  // --- block elements ---------------------------------------------------
  //
  // These previously fell through to `return children`, which is what erased
  // every block marker on save. spec: specs/markdown-block-grammar.spec.md
  const heading = element.type.match(/^h([1-6])$/);
  if (heading) {
    // No trailing space for an empty heading, so `#` round-trips as `#`.
    return children
      ? `${"#".repeat(Number(heading[1]))} ${children}`
      : "#".repeat(Number(heading[1]));
  }

  if (element.type === "hr") {
    return "---";
  }

  if (element.type === "code") {
    const language =
      (element as TElement & { language?: string }).language ?? "";
    // ```` when the body itself contains a triple fence, so the fence cannot be
    // closed early by its own contents.
    const longestFence = (children.match(/`{3,}/g) ?? []).reduce(
      (max, run) => Math.max(max, run.length),
      0
    );
    const fence = "`".repeat(Math.max(3, longestFence + 1));
    return `${fence}${language}\n${children}\n${fence}`;
  }

  if (element.type === "blockquote") {
    return (element.children as Descendant[])
      .map((child) => serializeNode(child))
      .join("\n")
      .split("\n")
      .map((line) => `> ${line}`.trimEnd())
      .join("\n");
  }

  if (element.type === "ul" || element.type === "ol") {
    return serializeList(element, "");
  }

  if (element.type === "table") {
    return serializeTable(element);
  }

  return children;
}

/** Serialise a list, indenting nested lists by two spaces per level. */
function serializeList(element: TElement, indent: string): string {
  const ordered = element.type === "ol";
  const start = (element as TElement & { start?: number }).start ?? 1;
  const items = (element.children ?? []) as Descendant[];

  const lines: string[] = [];
  items.forEach((item, index) => {
    const li = item as TElement & { children?: Descendant[] };
    const blocks = (li.children ?? []) as Descendant[];

    let first = true;
    for (const block of blocks) {
      const text = serializeNode(block);
      if (text === "") continue;
      const marker = ordered ? `${start + index}. ` : "- ";
      for (const piece of text.split("\n")) {
        lines.push(
          first ? `${indent}${marker}${piece}` : `${indent}  ${piece}`
        );
        first = false;
      }
    }
  });

  return lines.join("\n");
}

/** Serialise a table, always emitting the delimiter row. */
function serializeTable(element: TElement): string {
  const sections = (element.children ?? []) as Descendant[];
  const headRows: Descendant[] = [];
  const bodyRows: Descendant[] = [];

  for (const section of sections) {
    const s = section as TElement;
    const rows = (s.children ?? []) as Descendant[];
    if (s.type === "thead") headRows.push(...rows);
    else if (s.type === "tbody") bodyRows.push(...rows);
  }

  const widths = Math.max(
    headRows.length > 0 ? cellsOf(headRows[0]).length : 0,
    ...bodyRows.map((r) => cellsOf(r).length),
    0
  );

  const renderRow = (row: Descendant) => {
    const cells = cellsOf(row);
    const padded = [...cells];
    while (padded.length < widths) padded.push("");
    return `| ${padded.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
  };

  const out: string[] = [];
  if (headRows.length > 0) out.push(renderRow(headRows[0]));

  // The delimiter row is what keeps two cells from becoming one string. It is
  // never optional.
  const alignments = headRows.length > 0 ? alignsOf(headRows[0]) : [];
  out.push(
    `| ${Array.from({ length: widths }, (_, c) => {
      switch (alignments[c]) {
        case "center":
          return ":---:";
        case "right":
          return "---:";
        case "left":
          return ":---";
        default:
          return "---";
      }
    }).join(" | ")} |`
  );

  const rest = headRows.slice(1).concat(bodyRows);
  for (const row of rest) out.push(renderRow(row));

  return out.join("\n");
}

function cellsOf(row: Descendant): string[] {
  const r = row as TElement;
  return ((r.children ?? []) as Descendant[]).map((c) => serializeNode(c));
}

function alignsOf(row: Descendant): (string | null)[] {
  const r = row as TElement;
  return ((r.children ?? []) as Descendant[]).map(
    (c) => ((c as TElement & { align?: string }).align ?? null) as string | null
  );
}

// Deserializer for markdown, which is the only format the editor writes.
export function deserializeContent(content: string): TElement[] {
  if (!content || content.trim() === "") {
    return [{ type: "p", children: [{ text: "" }] }];
  }
  return deserializeFromMarkdown(content);
}

/**
 * Convert an HTML snippet body to markdown.
 *
 * Reuses the pipeline the TextBlaze and Power Text importers run:
 * HTML -> Plate nodes -> markdown.
 *
 * This is the PAGE-side converter, and it needs a DOM. The legacy
 * contentFormat migration does NOT use it: an MV3 service worker has no
 * `DOMParser`, so a migration built on this function would convert in a popup
 * and silently fail in the background, leaving the result dependent on which
 * context read the snippet first. The migration uses the DOM-free converter in
 * src/lib/html-to-markdown.ts instead, in every context.
 *
 * spec: specs/content-format-migration.spec.md
 */
import {
  IMAGE_PLACEHOLDER_ANCHORED,
  GIF_PLACEHOLDER_ANCHORED,
} from "@/lib/media-placeholders";
export function htmlToMarkdown(html: string): string {
  if (!html || html.trim() === "") return "";
  return serializeToMarkdown(deserializeFromHtml(html));
}

/**
 * Deserialise HTML into Plate nodes.
 *
 * Exists so the HTML branch of deserializeContent is callable on its own; the
 * editor uses it for the "open an HTML snippet" path. Needs a DOM, like
 * htmlToMarkdown above.
 */
export function deserializeHtmlToNodes(html: string): TElement[] {
  if (!html || html.trim() === "") {
    return [{ type: "p", children: [{ text: "" }] }];
  }
  return deserializeFromHtml(html);
}

// Deserialize Markdown to Plate value
function deserializeFromMarkdown(markdown: string): TElement[] {
  if (!markdown || markdown.trim() === "") {
    return [{ type: "p", children: [{ text: "" }] }];
  }

  // Block structure is decided by the grammar, not by splitting on newlines.
  // The previous version wrapped every line in a paragraph, so headings lost
  // their `##`, lists became indistinguishable paragraphs, and a two-cell table
  // serialised to `"ab"` with no separator at all.
  //
  // spec: specs/markdown-block-grammar.spec.md
  const result = parseBlocks(markdown, (text) =>
    parseMarkdownInline(text)
  ) as TElement[];

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

    // Check for image placeholder {{image:<uuid>}} or {{image:<uuid>:<width>}}
    const imageMatch = remaining.match(REGEX_PATTERNS.image);
    if (imageMatch) {
      const width = imageMatch[2] ? parseInt(imageMatch[2], 10) : undefined;
      nodes.push({
        type: IMAGE_PLACEHOLDER,
        mediaId: imageMatch[1],
        ...(width === undefined ? {} : { width }),
        children: [{ text: "" }],
      } as TElement & { mediaId: string; width?: number });
      remaining = remaining.slice(imageMatch[0].length);
      continue;
    }

    // Check for gif placeholder {{gif:<giphyId>}} or {{gif:<giphyId>:<width>}}
    const gifMatch = remaining.match(REGEX_PATTERNS.gif);
    if (gifMatch) {
      const width = gifMatch[2] ? parseInt(gifMatch[2], 10) : undefined;
      nodes.push({
        type: GIF_PLACEHOLDER,
        giphyId: gifMatch[1],
        ...(width === undefined ? {} : { width }),
        children: [{ text: "" }],
      } as TElement & { giphyId: string; width?: number });
      remaining = remaining.slice(gifMatch[0].length);
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
      //
      // These are the constructs the TextBlaze and PowerText importers rely on,
      // and they previously had no case here, so `deserializeNodes` walked into
      // them and returned only their text. `<ul><li>a</li><li>b</li></ul>`
      // therefore became "ab" — the two items merged into one word with no
      // separator, which is silent data corruption on the import path.
      //
      // Producing the same element types the markdown grammar parses is what
      // makes `htmlToMarkdown` (which is just
      // `serializeToMarkdown(deserializeFromHtml(…))`) block-aware for free.
      //
      // spec: specs/markdown-block-grammar.spec.md
      const headingMatch = tagName.match(/^h([1-6])$/);
      if (headingMatch) {
        const children = deserializeNodes(el);
        nodes.push({
          type: `h${headingMatch[1]}`,
          children: children.length > 0 ? children : [{ text: "" }],
        } as TElement);
        return;
      }

      if (tagName === "hr") {
        nodes.push({ type: "hr", children: [{ text: "" }] } as TElement);
        return;
      }

      if (tagName === "blockquote") {
        nodes.push({
          type: "blockquote",
          children:
            deserializeNodes(el).length > 0
              ? deserializeNodes(el)
              : ([{ text: "" }] as Descendant[]),
        } as TElement);
        return;
      }

      if (tagName === "ul" || tagName === "ol") {
        const items = Array.from(el.children)
          .filter((child) => child.tagName.toLowerCase() === "li")
          .map((child) => {
            const liChildren = deserializeNodes(child);
            return {
              type: "li",
              children:
                liChildren.length > 0
                  ? liChildren
                  : ([{ text: "" }] as Descendant[]),
            } as TElement;
          });
        nodes.push({
          type: tagName,
          children:
            items.length > 0
              ? items
              : ([{ text: "" }] as unknown as TElement[]),
        } as unknown as TElement);
        return;
      }

      if (tagName === "table") {
        nodes.push(deserializeTable(el));
        return;
      }

      if (tagName === "img") {
        // A remote image cannot be stored: Clipio's media store holds uploaded
        // blobs, not URLs. Dropping the tag entirely — which is what happened
        // before — loses the alt text and the URL with no trace. Keeping the
        // markdown as literal text preserves both and stays visible.
        //
        // It does not survive as an *image*: `parseMarkdownInline` has no
        // `![alt](src)` rule, so on the next parse this comes back as text
        // followed by a link. Documented in the spec rather than papered over.
        const src = el.getAttribute("src") ?? "";
        const alt = el.getAttribute("alt") ?? "";
        if (src) {
          nodes.push({ text: `![${alt}](${src})` });
        } else if (alt) {
          nodes.push({ text: alt });
        }
        return;
      }

      if (tagName === "pre") {
        // The interior of a code block must survive verbatim — it is never
        // reinterpreted as markdown.
        const code = el.querySelector("code");
        const language =
          code?.className.match(/(?:language|lang)-([\w+-]+)/)?.[1] ?? "";
        nodes.push({
          type: "code",
          language: language || undefined,
          children: [{ text: (code ?? el).textContent ?? "" }],
        } as unknown as TElement);
        return;
      }

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
// Re-export from the shared markdown module for backward compatibility.
export {
  markdownToHtml,
  markdownToPlainText,
  escapeHtml,
  sanitizeUrl,
} from "@/lib/markdown";

/**
 * Build a `table` element from a DOM `<table>`.
 *
 * Row and cell roles are inferred from the tag where possible, because pasted
 * HTML frequently omits `<thead>`/`<tbody>` entirely. Column count is padded to
 * the widest row so a short row cannot silently drop cells.
 */
function deserializeTable(table: Element): TElement {
  const rows = Array.from(table.querySelectorAll("tr"));
  const parsed = rows.map((row) =>
    Array.from(row.children)
      .filter((c) => ["td", "th"].includes(c.tagName.toLowerCase()))
      .map((cell) => {
        const align = /text-(left|center|right)/.exec(
          cell.getAttribute("style") ?? ""
        )?.[1];
        return {
          type: cell.tagName.toLowerCase() === "th" ? "th" : "td",
          ...(align ? { align } : {}),
          children: [{ text: cell.textContent ?? "" }],
        } as unknown as TElement;
      })
  );

  const width = parsed.reduce((max, cells) => Math.max(max, cells.length), 0);
  const head =
    parsed.findIndex((cells) => cells.some((c) => c.type === "th")) === 0 &&
    parsed.length > 0
      ? parsed[0]
      : null;

  const headRow = (cells: TElement[]): TElement =>
    ({
      type: "tr",
      children: Array.from(
        { length: width },
        (_, i) => cells[i] ?? { type: "td", children: [{ text: "" }] }
      ),
    }) as unknown as TElement;

  const bodyRows = (head ? parsed.slice(1) : parsed).map(headRow);

  return {
    type: "table",
    children: [
      ...(head
        ? [{ type: "thead", children: [headRow(head)] } as unknown as TElement]
        : []),
      { type: "tbody", children: bodyRows } as unknown as TElement,
    ],
  } as unknown as TElement;
}
