/**
 * Text extraction primitives shared by the surfaces that turn generated HTML
 * back into readable text.
 *
 * Both helpers exist because a single `.replace()` is not a sanitizer. A regex
 * that removes `<…>` once can be tricked into rebuilding a tag from the pieces
 * it just removed, and a chain of entity decodes decodes the output of an
 * earlier step a second time. They are pure string functions — no DOM, no
 * browser APIs — so both behaviours are testable directly.
 */

/**
 * Remove HTML tags, repeating until a pass changes nothing.
 *
 * A `>` inside a quoted attribute defeats one pass: `<a title=">">text</a>`
 * leaves `">text</a>` behind, and the closing tag is only removed on the next
 * pass. Repeating is the fix CodeQL recommends for the single-pass version
 * flagged as `js/incomplete-multi-character-sanitization`.
 *
 * Termination: every iteration that changes the string removes at least one
 * character, so the loop ends when there is nothing left to remove.
 */
export function stripHtmlTags(html: string): string {
  let text = html;
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, "");
  } while (text !== previous);
  return text;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// One pass over the whole string, so each entity is decoded exactly once.
const ENTITY = /&(?:(#\d+)|(#x[0-9a-f]+)|([a-z]+));/gi;

/**
 * Decode HTML entities in a single pass.
 *
 * A chain of `.replace(/&amp;/g, "&").replace(/&lt;/g, "<")` decodes twice:
 * `&amp;lt;` becomes `&lt;` on the first step and `<` on the second. Matching
 * every entity in one regex means the decoder never reads its own output —
 * `&amp;lt;` decodes to the literal text `&lt;`, as intended.
 *
 * Unknown names and out-of-range numeric references are left alone rather
 * than throwing: this runs on stored content and on text produced by the
 * markdown converter, neither of which should be able to break insertion.
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(
    ENTITY,
    (
      match: string,
      decimal: string | undefined,
      hex: string | undefined,
      name: string | undefined
    ) => {
      if (decimal) return fromCodePoint(Number(decimal.slice(1)), match);
      if (hex) return fromCodePoint(parseInt(hex.slice(2), 16), match);
      return NAMED_ENTITIES[(name ?? "").toLowerCase()] ?? match;
    }
  );
}

function fromCodePoint(code: number, original: string): string {
  if (
    !Number.isFinite(code) ||
    code < 0 ||
    code > 0x10ffff ||
    (code >= 0xd800 && code <= 0xdfff)
  ) {
    return original;
  }
  return String.fromCodePoint(code);
}
