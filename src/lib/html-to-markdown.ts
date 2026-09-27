// spec: specs/content-format-migration.spec.md
//
// Converts a legacy HTML snippet body to markdown WITHOUT a DOM.
//
// Why not reuse the editor's `deserializeFromHtml`? Because that path uses
// `DOMParser`, and an MV3 service worker has no DOM at all — `DOMParser` is a
// ReferenceError there. The background worker is the only context that outlives
// a page, so it is the one that must be able to migrate; if conversion were
// DOM-dependent, the outcome would depend on which context happened to read
// first, and the background's cache refresh would undo a conversion the popup
// had already performed.
//
// So the migration uses ONE DOM-free converter, and it is used in every
// context. Behaviour is therefore identical everywhere, which is the property
// that matters; a context-dependent second converter would be strictly worse
// even if it were more faithful.
//
// SCANNING IS MANUAL, NOT REGEX-BASED, AND THAT IS LOAD-BEARING. A
// `/<tag[^>]*>/` style pattern is quadratic here: `[^>]*` is greedy and must be
// followed by `>`, so at every `<` with no later `>` the engine consumes to
// end-of-input and backtracks. A 32 KB body of `<b` (exactly what a truncated
// or copy-pasted HTML snippet looks like) took 738 ms, and it runs on every
// getSnippets() inside the service worker. `findTagEnd` below is a single
// forward pass instead, so the whole conversion is O(n).

/** Matches an ASCII letter — the first char of a tag name. */
function isTagNameStart(ch: string | undefined): boolean {
  return ch !== undefined && /[a-z]/i.test(ch);
}

function isTagNameChar(ch: string | undefined): boolean {
  return ch !== undefined && /[a-z0-9]/i.test(ch);
}

/**
 * Index just past the tag that starts at `start`.
 *
 * Honours quoted attribute values, so a `>` inside `title="a > b"` does not end
 * the tag early. Single forward pass, so it is linear in the tag's length.
 * Returns -1 for an unterminated tag. The HTML parser discards a tag that never
 * closes, so the caller drops it — the same outcome as the DOM path, where an
 * unclosed tag yields no node.
 */
function findTagEnd(html: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < html.length; i++) {
    const ch = html[i]!;
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return i + 1;
  }
  return -1;
}

/**
 * Index to resume scanning from, given a tag that starts at `lt`.
 *
 * `findTagEnd` returns -1 for an unterminated tag, and that value must never
 * reach the scan cursor: `indexOf("<", -1)` coerces -1 to 0, so the scanner
 * would jump back to the start, re-enter the same branch, and spin forever with
 * no allocation and no await — pinning the service worker at 100% CPU. An
 * unterminated tag therefore consumes the rest of the input.
 */
function resumeAfterTag(html: string, lt: number): number {
  const end = findTagEnd(html, lt);
  return end === -1 ? html.length : end;
}

/**
 * Index just past the `<!--` comment that starts at `start`, or -1.
 *
 * A browser ends a comment at the first `-->`, and the DOM path drops comments
 * entirely (they are nodeType 8, and it only walks text and element nodes), so
 * their contents must not be converted either.
 */
function findCommentEnd(html: string, start: number): number {
  const end = html.indexOf("-->", start + 4);
  return end === -1 ? html.length : end + 3;
}

/**
 * Read an attribute value out of a tag's attribute text.
 *
 * `name` is matched case-insensitively at the start of `attrs`, then `=` and
 * either a quoted or an unquoted value. Returns null when absent or unquoted
 * with no value.
 */
function readAttr(attrs: string, name: string): string | null {
  let i = 0;
  const len = attrs.length;
  while (i < len) {
    // Skip whitespace and any stray solidus from a self-closing tag.
    while (i < len && (/\s/.test(attrs[i]!) || attrs[i] === "/")) i++;
    if (i >= len) return null;

    const start = i;
    while (i < len && !/[\s=/]/.test(attrs[i]!)) i++;
    const attrName = attrs.slice(start, i).toLowerCase();
    if (attrName === "") return null;

    while (i < len && /\s/.test(attrs[i]!)) i++;
    if (attrs[i] !== "=") {
      // A valueless attribute such as `disabled`; keep scanning for ours.
      continue;
    }
    i++; // consume '='
    while (i < len && /\s/.test(attrs[i]!)) i++;

    if (attrName !== name) {
      // Skip this value so a quoted `=` inside it cannot be mistaken for the
      // next attribute's separator.
      if (attrs[i] === '"' || attrs[i] === "'") {
        const q = attrs[i]!;
        const close = attrs.indexOf(q, i + 1);
        i = close === -1 ? len : close + 1;
      } else {
        while (i < len && !/\s/.test(attrs[i]!)) i++;
      }
      continue;
    }

    if (attrs[i] === '"' || attrs[i] === "'") {
      const q = attrs[i]!;
      const close = attrs.indexOf(q, i + 1);
      return close === -1 ? attrs.slice(i + 1) : attrs.slice(i + 1, close);
    }
    const vStart = i;
    while (i < len && !/\s/.test(attrs[i]!)) i++;
    return attrs.slice(vStart, i);
  }
  return null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

/** U+FFFD, the replacement character HTML5 mandates for a bad code point. */
const REPLACEMENT = "�";

/**
 * Resolve a numeric character reference.
 *
 * NUL and the surrogate range are not valid scalar values: HTML5 requires
 * U+FFFD for `&#0;`, and a lone surrogate in a JS string is a latent encoding
 * bug, so both become U+FFFD rather than being passed through.
 */
function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  if (code === 0) return REPLACEMENT;
  if (code >= 0xd800 && code <= 0xdfff) return REPLACEMENT;
  try {
    return String.fromCodePoint(code);
  } catch {
    return REPLACEMENT;
  }
}

/** Decode the entity forms a legacy snippet can plausibly contain. */
export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      safeFromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      safeFromCodePoint(parseInt(dec, 10))
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => {
      const key = name.toLowerCase();
      return key in NAMED_ENTITIES ? NAMED_ENTITIES[key]! : match;
    });
}

/**
 * An inline mark that has been opened and still needs closing.
 *
 * `tag` is the HTML element that closes it, so a mismatched nesting can be
 * unwound rather than swallowing the rest of the document. `close` is the
 * literal text to emit, which for a link also carries its URL.
 */
interface OpenMark {
  tag: string;
  close: string;
}

/**
 * Convert an HTML fragment to markdown, without a DOM.
 *
 * Handles the constructs a legacy snippet body realistically contains: block
 * separation, `<br>`, inline emphasis/strong/strike/code, links, list items,
 * and headings. An unknown element is stripped and its text kept, which is what
 * the DOM path does for an element it does not recognise. Comments, doctypes,
 * CDATA and processing instructions are dropped outright, again matching the DOM
 * path: none of them are user-visible content.
 *
 * A `<script>` or `<style>` body is dropped rather than emitted as text, for the
 * same reason — emitting it would put code where the user wrote none.
 */
export function htmlToMarkdownPortable(html: string): string {
  if (!html || html.trim() === "") return "";

  let out = "";
  const marks: OpenMark[] = [];
  /** Enclosing list types, so <li> knows its marker. */
  const listStack: ("ul" | "ol")[] = [];
  let skipTag: string | null = null;

  /** Pop and emit every mark open at or inside `tag`, including the match. */
  const closeMarksThrough = (tag: string) => {
    while (marks.length > 0) {
      const top = marks.pop()!;
      out += top.close;
      if (top.tag === tag) return;
    }
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      if (skipTag === null) out += html.slice(i);
      break;
    }
    if (skipTag === null) out += html.slice(i, lt);

    // Comment: dropped, contents and all.
    if (html.startsWith("<!--", lt)) {
      i = findCommentEnd(html, lt);
      continue;
    }

    // Doctype, CDATA and processing instructions: dropped, like the DOM path.
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      i = resumeAfterTag(html, lt);
      continue;
    }

    // script and style are raw-text elements: the browser ends them at the
    // FIRST matching close tag, so a nested opening tag inside is just text
    // and must not extend the skip.
    if (skipTag !== null) {
      if (
        html[lt + 1] === "/" &&
        html.slice(lt + 2, lt + 2 + skipTag.length).toLowerCase() === skipTag
      ) {
        const after = html[lt + 2 + skipTag.length];
        if (after === ">" || after === undefined || /\s/.test(after ?? "")) {
          skipTag = null;
        }
      }
      i = resumeAfterTag(html, lt);
      continue;
    }

    if (!isTagNameStart(html[lt + 1]) && html[lt + 1] !== "/") {
      // A bare `<` that does not start a tag is literal text.
      out += "<";
      i = lt + 1;
      continue;
    }

    const tagEnd = findTagEnd(html, lt);
    if (tagEnd === -1) {
      // A tag that never closes is discarded, taking nothing with it: an
      // unterminated `<b` is not a bold run, it is just a dropped tag.
      i = html.length;
      continue;
    }
    const raw = html.slice(lt, tagEnd);
    const closing = raw.startsWith("</");

    let p = 1;
    if (closing) p = 2;
    const nameStart = p;
    while (p < raw.length && isTagNameChar(raw[p])) p++;
    const tag = raw.slice(nameStart, p).toLowerCase();
    const selfClosing = /\/\s*>$/.test(raw) || tag === "br" ? true : false;
    const attrs = raw.slice(p, Math.max(p, raw.length - 1));

    i = tagEnd;

    if (skipTag !== null) {
      if (tag === skipTag && !closing && !selfClosing) {
        // A nested opening tag inside raw text is inert, per the raw-text rule.
      }
      continue;
    }

    if (tag === "script" || tag === "style") {
      if (!closing && !selfClosing) skipTag = tag;
      continue;
    }

    if (closing) {
      if (tag === "b" || tag === "strong") {
        closeMarksThrough("b");
        closeMarksThrough("strong");
      } else if (tag === "i" || tag === "em") {
        closeMarksThrough("i");
        closeMarksThrough("em");
      } else if (tag === "s" || tag === "strike" || tag === "del") {
        closeMarksThrough("s");
        closeMarksThrough("strike");
        closeMarksThrough("del");
      } else if (tag === "code") {
        closeMarksThrough("code");
      } else if (tag === "a") {
        closeMarksThrough("a");
      } else if (tag === "br") {
        out += "\n";
      } else if (
        tag === "p" ||
        tag === "div" ||
        tag === "section" ||
        tag === "article" ||
        tag === "header" ||
        tag === "footer" ||
        tag === "main" ||
        tag === "blockquote" ||
        tag === "h1" ||
        tag === "h2" ||
        tag === "h3" ||
        tag === "h4" ||
        tag === "h5" ||
        tag === "h6" ||
        tag === "pre"
      ) {
        out += "\n\n";
      } else if (tag === "li") {
        out += "\n";
      } else if (tag === "ul" || tag === "ol") {
        out += "\n";
        listStack.pop();
      }
      continue;
    }

    if (selfClosing) {
      // <br/> is the only self-closing tag with meaning here.
      if (tag === "br") out += "\n";
      continue;
    }

    switch (tag) {
      case "br":
        out += "\n";
        break;
      case "b":
      case "strong":
        out += "**";
        marks.push({ tag, close: "**" });
        break;
      case "i":
      case "em":
        out += "_";
        marks.push({ tag, close: "_" });
        break;
      case "s":
      case "strike":
      case "del":
        out += "~~";
        marks.push({ tag, close: "~~" });
        break;
      case "code":
        out += "`";
        marks.push({ tag, close: "`" });
        break;
      case "a": {
        // The URL is captured now because the closing tag only says the text
        // has ended; it is emitted as part of the mark's closer.
        const href = readAttr(attrs, "href");
        if (href !== null) {
          out += "[";
          marks.push({ tag, close: `](${href})` });
        }
        break;
      }
      case "p":
      case "div":
      case "section":
      case "article":
      case "header":
      case "footer":
      case "main":
      case "blockquote":
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
      case "pre":
        out += "\n\n";
        break;
      case "ul":
        out += "\n";
        listStack.push("ul");
        break;
      case "ol":
        out += "\n";
        listStack.push("ol");
        break;
      case "li": {
        out += "\n";
        // The marker depends on the enclosing list type. A nested list uses
        // the innermost one, which is what a reader expects.
        out += listStack[listStack.length - 1] === "ol" ? "1. " : "- ";
        break;
      }
      case "td":
      case "th":
      case "dt":
      case "dd":
        // A space, not concatenation. The DOM path emitted the two cells as
        // "ab" with no separator at all, which is genuine data loss; a space
        // at least keeps the values apart.
        out += " ";
        break;
      default:
        // Unknown element: keep its text, drop the tag. Same outcome as the
        // editor's HTML deserialiser for an unrecognised element.
        break;
    }
  }

  // Close any marks the document left open.
  while (marks.length > 0) {
    out += marks.pop()!.close;
  }

  return tidy(decodeEntities(out));
}

/** Collapse the whitespace an HTML-to-text conversion inevitably leaves. */
function tidy(markdown: string): string {
  return markdown
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[ \t]+/gm, "")
    .trim();
}
