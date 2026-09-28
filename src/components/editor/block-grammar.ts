/**
 * Markdown block grammar.
 *
 * spec: specs/markdown-block-grammar.spec.md
 *
 * `serialization.ts` used to split on `/\n/` and wrap every line in a paragraph,
 * so any block structure in a snippet was destroyed on the first open/save cycle:
 * headings lost their `##`, lists flattened into indistinguishable paragraphs, and
 * a two-cell table serialised to `"ab"` with no separator at all.
 *
 * This is a line-oriented block scanner. It is deliberately *not* a CommonMark
 * implementation — it is a snippet editor, and the goal is that the common
 * constructs survive a round trip, not that edge cases match a spec. The
 * divergences are listed in the spec under Edge Cases.
 */

import type { TElement } from "platejs";

/** Longest list nesting we will recurse into. Deeper input is flattened here. */
export const MAX_LIST_DEPTH = 8;

// ---------------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------------

const RE_ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const RE_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*(\S*)[ \t]*$/;
const RE_HR = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const RE_QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const RE_BULLET = /^([ \t]*)([-*+])[ \t]+(.*)$/;
const RE_ORDERED = /^([ \t]*)((\d{1,9})[.)])[ \t]+(.*)$/;
const RE_SETEXT_H1 = /^ {0,3}=+[ \t]*$/;
const RE_SETEXT_H2 = /^ {0,3}-+[ \t]*$/;
const RE_DELIMITER_CELL = /^:?-+:?$/;

function isDelimiterRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("-") || !trimmed.includes("|")) return false;
  return trimmed
    .replace(/^\||\|$/g, "")
    .split("|")
    .every((cell) => RE_DELIMITER_CELL.test(cell.trim()));
}

/**
 * Split a table row into cells, honouring `\|` as a literal pipe.
 *
 * A bare `|` in snippet prose is common enough that treating every one as a
 * separator would shred ordinary text.
 */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      current += "|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  // A leading/trailing pipe produces an empty first/last cell; drop them.
  if (cells.length > 1 && cells[0].trim() === "") cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parse markdown into block-level elements.
 *
 * @param parseInline turns a line's text into inline children. Injected so this
 *   module stays independent of `serialization.ts` and its placeholder handling,
 *   and so a fence interior is never passed to it at all.
 */
export function parseBlocks(
  markdown: string,
  parseInline: (text: string) => unknown[]
): TElement[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: TElement[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank — skip. Block separation is implied by the element sequence.
    if (line.trim() === "") {
      i++;
      continue;
    }

    const fence = line.match(RE_FENCE);
    if (fence) {
      out.push(readFence(lines, i, fence[1], fence[2]));
      i = fenceEnd(lines, i, fence[1]) + 1;
      continue;
    }

    if (RE_HR.test(line)) {
      out.push({ type: "hr", children: [{ text: "" }] } as unknown as TElement);
      i++;
      continue;
    }

    const heading = line.match(RE_ATX);
    if (heading) {
      const level = heading[1].length;
      const children = parseInline(heading[2] ?? "");
      out.push({
        type: `h${level}`,
        children: children.length > 0 ? children : [{ text: "" }],
      } as unknown as TElement);
      i++;
      continue;
    }

    const quote = line.match(RE_QUOTE);
    if (quote) {
      const collected: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(RE_QUOTE);
        if (m) {
          collected.push(m[1]);
          i++;
          continue;
        }
        // Lazy continuation: a plain line directly under a quote stays in it.
        if (lines[i].trim() !== "" && !isBlockStart(lines[i])) {
          collected.push(lines[i]);
          i++;
          continue;
        }
        break;
      }
      out.push({
        type: "blockquote",
        children: parseBlocks(collected.join("\n"), parseInline),
      } as unknown as TElement);
      continue;
    }

    // Table: a header row followed by a delimiter row.
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isDelimiterRow(lines[i + 1])
    ) {
      const consumed = readTable(lines, i, parseInline);
      out.push(consumed.element);
      i = consumed.next;
      continue;
    }

    if (RE_BULLET.test(line) || RE_ORDERED.test(line)) {
      const consumed = readList(lines, i, parseInline);
      out.push(consumed.element);
      i = consumed.next;
      continue;
    }

    // Paragraph, possibly closed by a setext underline.
    const collected: string[] = [];
    while (i < lines.length) {
      const current = lines[i];
      if (current.trim() === "") break;
      if (collected.length > 0) {
        if (RE_SETEXT_H1.test(current)) {
          out.push(paragraph(collected, "h1", parseInline));
          collected.length = 0;
          i++;
          break;
        }
        if (RE_SETEXT_H2.test(current)) {
          out.push(paragraph(collected, "h2", parseInline));
          collected.length = 0;
          i++;
          break;
        }
        if (isBlockStart(current)) break;
      }
      collected.push(current);
      i++;
    }
    if (collected.length > 0) {
      out.push(paragraph(collected, "p", parseInline));
    } else if (i < lines.length && lines[i].trim() === "") {
      i++;
    }
  }

  return out;
}

function paragraph(
  lines: string[],
  type: string,
  parseInline: (text: string) => unknown[]
): TElement {
  const children = parseInline(lines.join("\n"));
  return {
    type,
    children: children.length > 0 ? children : [{ text: "" }],
  } as unknown as TElement;
}

/** Would this line start a new block, ending the current paragraph? */
function isBlockStart(line: string): boolean {
  return (
    RE_FENCE.test(line) ||
    RE_HR.test(line) ||
    RE_ATX.test(line) ||
    RE_QUOTE.test(line) ||
    RE_BULLET.test(line) ||
    RE_ORDERED.test(line)
  );
}

// ---------------------------------------------------------------------------
// Fenced code
// ---------------------------------------------------------------------------

function fenceEnd(lines: string[], start: number, marker: string): number {
  const char = marker[0];
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(RE_FENCE);
    // Only a run of the *same* character, at least as long, with no info
    // string, closes the fence.
    if (m && m[1][0] === char && m[1].length >= marker.length && m[2] === "") {
      return i;
    }
  }
  return lines.length;
}

function readFence(
  lines: string[],
  start: number,
  marker: string,
  language: string
): TElement {
  const end = fenceEnd(lines, start, marker);
  const body = lines.slice(start + 1, end).join("\n");
  return {
    type: "code",
    language: language || undefined,
    // The interior is stored as a single text node and is NEVER passed to
    // `parseInline`. That is the whole point: a code block containing
    // `**x**` or `{{date:iso}}` must come back as written.
    children: [{ text: body }],
  } as unknown as TElement;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function readTable(
  lines: string[],
  start: number,
  parseInline: (text: string) => unknown[]
): { element: TElement; next: number } {
  const headerCells = splitRow(lines[start]);
  const alignCells = splitRow(lines[start + 1]);
  const alignments = alignCells.map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });

  const rows: TElement[] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) {
    // Pad rather than drop: a short row must not lose cells relative to the
    // header, which is how a table silently loses data.
    const cells = splitRow(lines[i]);
    while (cells.length < headerCells.length) cells.push("");
    rows.push({
      type: "tr",
      children: headerCells.map((_, c) => cell(cells[c] ?? "")),
    } as unknown as TElement);
    i++;
  }

  return {
    element: {
      type: "table",
      children: [
        {
          type: "thead",
          children: [
            {
              type: "tr",
              children: headerCells.map((text, c) =>
                cell(text, "th", alignments[c])
              ),
            },
          ],
        },
        { type: "tbody", children: rows },
      ],
    } as unknown as TElement,
    next: i,
  };

  function cell(text: string, tag = "td", align?: string | null): TElement {
    const children = parseInline(text);
    return {
      type: tag,
      ...(align ? { align } : {}),
      children: children.length > 0 ? children : [{ text: "" }],
    } as unknown as TElement;
  }
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

interface ListRead {
  element: TElement;
  next: number;
}

function readList(
  lines: string[],
  start: number,
  parseInline: (text: string) => unknown[]
): ListRead {
  const ordered =
    !RE_BULLET.test(lines[start]) && RE_ORDERED.test(lines[start]);
  const startNumber = ordered
    ? Number((lines[start].match(RE_ORDERED) as RegExpMatchArray)[2])
    : 1;

  const items: { indent: number; lines: string[] }[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      // A blank line ends the list unless the next line continues it (a loose
      // list, or a nested block inside an item).
      const next = lines[i + 1];
      if (next === undefined) break;
      const isContinuation =
        RE_BULLET.test(next) ||
        RE_ORDERED.test(next) ||
        /^[ \t]{2,}\S/.test(next);
      if (!isContinuation) break;
      // Keep the blank inside the current item so paragraph structure inside a
      // list item survives; the trailing blank is handled by the outer loop.
      if (items.length > 0) items[items.length - 1].lines.push("");
      i++;
      continue;
    }

    const bullet = line.match(RE_BULLET);
    const orderedMatch = line.match(RE_ORDERED);
    if (bullet || orderedMatch) {
      const indent = (bullet ?? orderedMatch)![1].replace(/\t/g, "  ").length;
      const content = (bullet ?? orderedMatch)![bullet ? 3 : 4];
      if (items.length === 0 || indent <= items[items.length - 1].indent) {
        items.push({ indent, lines: [content] });
      } else {
        // Deeper than the previous item: belongs to it, dedented by the gap.
        const parent = items[items.length - 1];
        const strip = Math.min(indent - parent.indent, 2);
        parent.lines.push(line.slice(strip));
      }
      i++;
      continue;
    }

    // An indented, non-marker line continues the current item.
    if (items.length > 0 && /^[ \t]+\S/.test(line)) {
      items[items.length - 1].lines.push(line.replace(/^[ \t]{1,2}/, ""));
      i++;
      continue;
    }

    // Anything else at this level ends the list.
    break;
  }

  const element: TElement = {
    type: ordered ? "ol" : "ul",
    ...(ordered && startNumber !== 1 ? { start: startNumber } : {}),
    children: items.map((item) => listItem(item.lines, parseInline)),
  } as unknown as TElement;

  return { element, next: i };
}

function listItem(
  lines: string[],
  parseInline: (text: string) => unknown[]
): TElement {
  const children = parseBlocks(lines.join("\n"), parseInline);
  return { type: "li", children } as unknown as TElement;
}
