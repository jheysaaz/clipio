/**
 * Text folding for search.
 *
 * Search compares user input against stored copy, and the two rarely agree on
 * case or accents. Both problems have to be solved at once or neither works:
 * folding only case leaves a Spanish user typing "tematica" unable to reach a
 * keyword written "temática", and folding only accents leaves them needing the
 * Shift key they did not ask for.
 */

/**
 * Fold a string for comparison: lowercase, diacritics removed.
 *
 * Decompose with NFD so every accented letter becomes its base letter followed
 * by a combining mark, then drop the marks. That handles the precomposed form
 * ("é") and the decomposed form ("e" + U+0301) identically, which
 * `replace(/[̀-ͯ]/g, "")` on the raw NFC string does not.
 *
 * German sharp s is deliberately left alone. `toLowerCase()` maps "ẞ" to "ß",
 * and folding it to "ss" would make a query for either match both — arguably
 * desirable, but it is a language-specific rule that does not belong in a
 * generic comparator, and no copy in this extension contains it.
 */
export function foldText(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** One token in a field, with its range in the *original* string. */
export type FoldedWord = {
  /** Folded text, for comparison. */
  text: string;
  /** Offset of this word within the original, unfolded string. */
  start: number;
  /** End offset (exclusive) within the original string. */
  end: number;
};

/**
 * Sub-words of a camel-cased run, with offsets into the original.
 *
 * `"OpenDyslexic"` is one word to a tokenizer, so a user who types the brand
 * name the way people write it — `open dyslexic` — matches nothing, while
 * `opendyslexic` matches. Both spellings are real queries, so both are indexed.
 *
 * The whole run is emitted *as well as* its parts. Dropping it would break
 * `opendyslexic`, which is the spelling most likely to be pasted straight out
 * of the control it came from.
 *
 * A split happens at an uppercase letter whose predecessor is lowercase or a
 * digit. That deliberately leaves an acronym run alone: `PDFExport` yields
 * `pdfexport` by itself rather than a misleading `p` + `dfexport`, because
 * there is no reliable way to know where "PDF" ends and "Export" begins.
 */
function camelParts(original: string, base: number): FoldedWord[] {
  const parts: FoldedWord[] = [];
  let segmentStart = 0;

  const push = (from: number, to: number) => {
    const text = foldText(original.slice(from, to));
    if (text) parts.push({ text, start: base + from, end: base + to });
  };

  for (let i = 1; i < original.length; i++) {
    if (/[A-Z]/.test(original[i]) && /[a-z0-9]/.test(original[i - 1])) {
      push(segmentStart, i);
      segmentStart = i;
    }
  }
  push(segmentStart, original.length);

  // One segment means the run was not actually camel-cased, so the parts would
  // just duplicate the whole word.
  return parts.length > 1 ? parts : [];
}

/**
 * Split a string into folded words, keeping each word's offset in the original.
 *
 * Keeping offsets is what lets search highlight the real characters. Folding
 * changes string length — NFD plus mark-stripping turns a 2-character "é" into
 * 1 character — so a folded index cannot be used to slice the original without
 * the highlight landing one character off whenever an accent is involved.
 * Recording offsets at tokenisation time sidesteps the mapping entirely: a
 * match is always a range in a real word, never a translated index.
 *
 * Words are runs of letters and digits, so `font-family` yields "font" and
 * "family" and can match a query of "family" without matching "fontfamily".
 * Camel-cased runs additionally yield their parts — see `camelParts`.
 */
export function foldWords(value: string): FoldedWord[] {
  const words: FoldedWord[] = [];
  // Iterate the ORIGINAL string so offsets are original-string offsets, and
  // fold each character independently. Folding per character rather than over
  // the whole string means a combining mark encountered on its own folds to
  // "" and simply never starts a word, which is the desired behaviour for
  // decomposed input.
  let start = -1;
  for (let i = 0; i < value.length; i++) {
    const folded = foldText(value[i]);
    const isWordChar = folded.length > 0 && /[\p{L}\p{N}]/u.test(folded);
    if (isWordChar && start === -1) {
      start = i;
    } else if (!isWordChar && start !== -1) {
      const original = value.slice(start, i);
      const text = foldText(original);
      if (text) {
        words.push({ text, start, end: i });
        words.push(...camelParts(original, start));
      }
      start = -1;
    }
  }
  if (start !== -1) {
    const original = value.slice(start);
    const text = foldText(original);
    if (text) {
      words.push({ text, start, end: value.length });
      words.push(...camelParts(original, start));
    }
  }
  return words;
}

/**
 * Split a query into comparable tokens.
 *
 * Punctuation is dropped rather than treated as a separator-and-kept token, so
 * "api-key" and "api key" produce the same query. A query of only punctuation
 * yields no tokens, which callers read as "match nothing" rather than
 * "match everything" — see `searchSettingIndex`.
 */
export function tokenizeQuery(query: string): string[] {
  return foldWords(query).map((w) => w.text);
}
