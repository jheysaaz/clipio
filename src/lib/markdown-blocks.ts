/**
 * Block-level markdown → HTML.
 *
 * Written as its own file rather than folded into `markdown.ts`, because it is a
 * different algorithm: that module converts one line of inline markdown, and
 * this one has to recognise structure that spans lines (fenced code, list runs,
 * blockquote runs) before it can convert anything inside them.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `markdownToHtml` was a line-by-line inline converter joined with `<br>`, so
 * `**bold**` rendered and `# Heading` did not — the `#`, the `- `, and the `> `
 * were inserted as literal characters. Inline formatting has always worked;
 * block structure has never been implemented, and nothing failed loudly because
 * the output was still valid, escaped HTML.
 *
 * The gap only became visible once a snippet with a heading, a list and a
 * blockquote existed. See `samples/clipio-export.json`, whose "Markdown kitchen
 * sink" snippet is what surfaced it.
 */

import { markdownInlineToHtml } from "./markdown";

/** ATX heading: one to six `#` then a space then the text. */
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
/** Unordered list item: `-`, `*` or `+`, then whitespace. */
const UL_ITEM_RE = /^([-*+])\s+(.*)$/;
/** Ordered list item: digits, then `.` or `)`, then whitespace. */
const OL_ITEM_RE = /^(\d+)[.)]\s+(.*)$/;
/** Blockquote: one or more `>` then optional whitespace. */
const QUOTE_RE = /^>\s?(.*)$/;
/** Opening or standalone fence delimiter: ``` or ~~~, plus an optional info string. */
const FENCE_RE = /^(`{3,}|~{3,})\s*([\w-]*)\s*$/;
/**
 * Closing fence: the marker and nothing else.
 *
 * CommonMark does not allow an info string on the closing fence, and accepting
 * one here broke it — a code block whose *body* contained a line starting with
 * ```js closed early, and the rest of the code leaked out as live markdown.
 */
const CLOSING_FENCE_RE = /^(`{3,}|~{3,})\s*$/;

/**
 * Convert markdown, including block structure, to an HTML string.
 *
 * Lines that are not part of any block construct are converted inline and joined
 * with `<br>`, exactly as before. That is deliberate: a snippet written as
 * `first\nsecond` is two lines of one paragraph and should stay two lines, and
 * switching to paragraph semantics would reflow every existing snippet.
 */
export function markdownToHtmlWithBlocks(content: string): string {
  if (!content) return "";

  // ── Normalise line endings ────────────────────────────────────────────────
  //
  // Done first, and not optionally. Every pattern below ends in `$`, and JS `.`
  // does not match `\r`, so a CRLF line did not match *anything*: `# H\r\n` was
  // not a heading, `- a\r\n` was not a list item. The failure was silent and
  // destructive rather than merely wrong — `"# H\r\n\r\nbody"` rendered as the
  // literal text `# H` plus two stray carriage returns, and `"- a\r\n- b"`
  // demoted the *first* item out of the list, so the user's own bullet became
  // visible text. Nothing failed; every test was green because every fixture
  // used `\n`.
  //
  // A Windows user, or any importer or HTML export that yields CRLF, hits this on
  // their first pasted snippet. The spec requires the normalisation too.
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced code block ────────────────────────────────────────────────
    // The body is emitted verbatim: inline markdown inside a code fence is
    // literal text, and converting it would be wrong.
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1];
      const language = fence[2];
      const body: string[] = [];
      i++;
      while (i < lines.length && !closesFence(lines[i], marker)) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume the closing fence
      const cls = language ? ` class="language-${language}"` : "";
      out.push(`<pre><code${cls}>${escapeText(body.join("\n"))}</code></pre>`);
      continue;
    }

    // ── ATX heading ──────────────────────────────────────────────────────
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${markdownInlineToHtml(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // ── Blockquote ───────────────────────────────────────────────────────
    if (QUOTE_RE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        quoted.push(QUOTE_RE.exec(lines[i])![1]);
        i++;
      }
      // Inner content is still inline markdown, and the run keeps its own
      // `<br>`s so a two-line quote does not collapse onto one.
      out.push(
        `<blockquote>${quoted
          .map((q) => markdownInlineToHtml(q))
          .join("<br>")}</blockquote>`
      );
      continue;
    }

    // ── Lists ────────────────────────────────────────────────────────────
    // Ordered and unordered are matched separately so a run cannot silently
    // change kind partway through: a list that starts `- ` and continues `1. `
    // is two lists, and rendering it as one would reorder the user's content.
    const ul = UL_ITEM_RE.exec(line);
    if (ul) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = UL_ITEM_RE.exec(lines[i]);
        if (!m) break;
        items.push(`<li>${markdownInlineToHtml(m[2])}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    const ol = OL_ITEM_RE.exec(line);
    if (ol) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = OL_ITEM_RE.exec(lines[i]);
        if (!m) break;
        items.push(`<li>${markdownInlineToHtml(m[2])}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    out.push(markdownInlineToHtml(line));
    i++;
  }

  // Ordinary lines joined by `<br>`; block elements by nothing. Rebuilding the
  // whole string here is simpler and less error-prone than deciding separators
  // while scanning, and the list is short.
  return joinWithBreaks(out);
}

/**
 * Whether a line closes the fence opened with `marker`.
 *
 * The same character and at least as many of them, per CommonMark, and nothing
 * after it. `startsWith(marker)` was wrong on both counts: it closed on a body
 * line that merely began with backticks followed by an info string, which
 * truncated the block and let the remainder render as live markdown.
 *
 * ── The trade this makes ────────────────────────────────────────────────────
 *
 * Requiring a bare marker means a snippet that *annotates* its closing fence —
 *
 *     ```js
 *     code
 *     ``` // done
 *
 *     # Notes
 *
 * — no longer closes there. Everything after it is absorbed into the `<pre>` and
 * renders as literal code, where before it rendered as a heading. That is a real
 * removal, not a free win, and it is the CommonMark behaviour: GitHub and every
 * other renderer treat a trailing info string as body text too.
 *
 * The alternative is worse in the common case. Inside a code block, a line that
 * begins with backticks is far more likely to be the code itself than a fence
 * with a comment on it — ``` ```js… ``` ``` is ordinary JavaScript. Closing
 * eagerly on it truncates the block and re-renders the remainder as live
 * markdown, which mangles the user's snippet instead of merely reflowing it.
 *
 * `markdown-blocks.test.ts` pins both directions, so this is a recorded choice
 * rather than an accident waiting to be "fixed" the other way.
 */
function closesFence(line: string, marker: string): boolean {
  const m = CLOSING_FENCE_RE.exec(line.trim());
  if (!m) return false;
  const char = marker[0];
  return m[1][0] === char && m[1].length >= marker.length;
}

function joinWithBreaks(parts: string[]): string {
  // A whitespace-only line is dropped at a block boundary or at the edge of the
  // document, and kept between two plain lines.
  //
  // Adjacent to a block it is not content. `</h1>` already ends the line, so
  // keeping it puts a `<br>` — which renders as a visible blank line — after the
  // heading, plus a stray whitespace text node in the user's document. Away from
  // a block it *is* content: `one`, blank, `two` is a paragraph break the user
  // typed, and dropping it collapsed their spacing. The earlier version skipped
  // every empty part unconditionally, which fixed the first case and broke the
  // second. Nor is a blank part *exactly* empty in general — a line holding a
  // space, a tab or a stray `\r` is blank too, and the earlier fix tested
  // `part === ""`, so the defect it removed was still reachable by the most
  // likely whitespace a user will actually have.
  // When the snippet is *entirely* whitespace, keep it. Dropping blank parts is a
  // rule about spacing between real content; applied to a document with no
  // content it would silently turn `"   "` into `""`, and the parity suite
  // against `markdownToHtml` — which preserves it — is what caught that.
  const hasContent = parts.some((part) => part.trim() !== "");
  const kept = hasContent
    ? parts.filter((part, index) => {
        if (part.trim() !== "") return true;
        const before = nearestNonBlank(parts, index, -1);
        const after = nearestNonBlank(parts, index, +1);
        // An empty `nearestNonBlank` means there is nothing but blank on that
        // side, so this is document padding rather than a paragraph break.
        if (before === "" || after === "") return false;
        return !(isBlockElement(before) || isBlockElement(after));
      })
    : parts;

  let result = "";
  // The *previous part*, not the accumulated string. Testing the accumulated
  // string looks right for a document that starts with a block and is wrong for
  // one that does not: in `intro\n# H\noutro` the accumulator begins with
  // "intro", so the heading that just closed was never seen as a block and a
  // `<br>` landed after `</h1>`.
  let previous = "";
  for (const part of kept) {
    if (result === "") {
      result = part;
      previous = part;
      continue;
    }
    if (isBlockElement(previous) || isBlockElement(part)) {
      result += part;
    } else {
      result += `<br>${part}`;
    }
    previous = part;
  }
  return result;
}

/** The closest part with something on it, scanning outward from `index`. */
function nearestNonBlank(parts: string[], index: number, step: number): string {
  for (let i = index + step; i >= 0 && i < parts.length; i += step) {
    if (parts[i].trim() !== "") return parts[i];
  }
  return "";
}

function isBlockElement(html: string): boolean {
  return /^<(h[1-6]|ul|ol|blockquote|pre)\b/.test(html);
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
