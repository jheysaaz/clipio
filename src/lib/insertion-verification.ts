/**
 * Verifying that a snippet actually landed in the target field.
 *
 * ── Why this is a module and not three lines in the content script ─────────
 *
 * A content script is excluded from coverage (`vitest.config.ts`), so anything
 * living there is only checked by e2e — and the e2e used a single-line snippet,
 * which is the one case this gets right. The bug it hides: confetti fired in
 * textareas and never in rich editors, for every multi-line snippet.
 *
 * Extracting the comparison makes it testable, and the test is the point.
 */

/**
 * The plain text a browser would render for an HTML string.
 *
 * Must mirror what `innerText` yields, because that is what it is compared
 * against. `textContent` does not: it concatenates with no separator, so
 * `"a<br>b"` becomes `"ab"` while `innerText` gives `"a\nb"`. Comparing the two
 * made every multi-line insertion look like a failure.
 *
 * Rules, matching what `innerText` does for the constructs a snippet can
 * contain:
 *
 *  - `<br>` is a line break
 *  - a block boundary (`</p>`, `</li>`, `</h1>`, …) ends a line
 *  - a block *opening* tag starts a line, except at the very beginning
 *  - `<li>` is additionally prefixed with a bullet, because that is what
 *    `innerText` renders for a list
 *
 * Deliberately not a spec-complete HTML renderer: it handles the block and line
 * break elements Clipio can emit, and the comparison below is whitespace-
 * normalised so a construct it does not model cannot cause a false failure.
 */
const BLOCK_TAGS =
  "p|div|li|ul|ol|h[1-6]|blockquote|pre|table|thead|tbody|tfoot|tr|section|article|figure|hr|dl|dt|dd";

/** Elements whose rendered text starts on a new line. */
const OPEN_BLOCK = new RegExp(`<(?:${BLOCK_TAGS})\\b[^>]*>`, "gi");
/** Elements whose rendered text ends on a new line. */
const CLOSE_BLOCK = new RegExp(`</(?:${BLOCK_TAGS})>`, "gi");

/**
 * Strip markup, leaving the text a browser would show.
 *
 * Not an HTML parser on purpose — it runs on a snippet's own generated markup,
 * which is produced by `markdownToHtml` and is well-formed. A parser would be
 * heavier and would run in the content script on every insertion.
 */
export function plainTextFromHtml(html: string): string {
  let text = html;

  // `<br>` first: it is a line break, while the other void elements contribute
  // nothing. Handling it in the strip below consumed it as if it were an image.
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Remaining void elements carry no text, and leaving them in would let the tag
  // names survive into the output.
  text = text.replace(/<(img|hr|source|input)\b[^>]*>/gi, "");
  // A list bullet, matching what `innerText` puts before each item.
  text = text.replace(/<li\b[^>]*>/gi, "\n• ");
  text = text.replace(OPEN_BLOCK, "\n");
  text = text.replace(CLOSE_BLOCK, "\n");

  // Anything still angled is a tag we do not model; drop it rather than
  // letting it become visible text.
  text = text.replace(/<[^>]*>/g, "");

  text = decodeEntities(text);

  // The caret marker is a zero-width placeholder, and a stray bullet from a
  // leading list marker would leave the comparison off by one character.
  // Adjacent block tags each contributed a newline, so `</p><p>` produced a blank
  // line that was never in the source. Collapsing keeps the output honest;
  // correctness does not depend on it, because the comparison normalises
  // whitespace anyway.
  text = text.replace(/\n{2,}/g, "\n");

  return text.trim();
}

/** Decode the five entities the markdown converter can emit, plus numerics. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * Collapse whitespace so the comparison cannot fail on incidental differences.
 *
 * This is the second half of the fix. `innerText` differs subtly between
 * browsers and across element types — a `<div>` may or may not contribute a
 * trailing break, `innerText` and `textContent` disagree on hidden nodes — and a
 * success check that is sensitive to any of that will silently stop firing the
 * moment a browser changes. Comparing on collapsed whitespace means the check
 * asks the only question that matters: is the snippet's *text* in there?
 */
export function normaliseForComparison(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Whether the inserted HTML's text is present in what the field now contains.
 *
 * Returns `false` for markup with no text at all — an image-only snippet, which
 * has to be verified by counting `<img>` elements instead.
 */
export function insertionTextMatches(
  insertedHtml: string,
  actualFieldText: string
): boolean {
  const expected = normaliseForComparison(plainTextFromHtml(insertedHtml));
  if (!expected) return false;
  return normaliseForComparison(actualFieldText).includes(expected);
}
