import { describe, it, expect } from "vitest";

import { foldText, foldWords, tokenizeQuery } from "./text-fold";

const texts = (value: string) => foldWords(value).map((w) => w.text);

describe("foldText", () => {
  it("lowercases", () => {
    expect(foldText("CoNFeTTi")).toBe("confetti");
  });

  it("strips diacritics from the precomposed form", () => {
    // "é" as a single code point. NFD splits it into "e" + U+0301, and the
    // combining mark is what gets dropped.
    expect(foldText("temática")).toBe("tematica");
  });

  it("strips diacritics from the already-decomposed form", () => {
    // Same glyph, two code points. Folding has to give the same answer for
    // both or a query matches depending on how the copy was stored.
    expect(foldText("tema\u0301tica")).toBe("tematica");
  });

  it("folds the accented characters that actually appear in the locales", () => {
    for (const [input, expected] of [
      ["á", "a"],
      ["é", "e"],
      ["í", "i"],
      ["ó", "o"],
      ["ú", "u"],
      ["ñ", "n"],
      ["ü", "u"],
    ] as const) {
      expect(foldText(input), input).toBe(expected);
    }
  });

  it("leaves a string with no accents untouched beyond case", () => {
    expect(foldText("  Where snippets are stored ")).toBe(
      "  where snippets are stored "
    );
  });

  it("returns an empty string unchanged", () => {
    expect(foldText("")).toBe("");
  });
});

describe("foldWords", () => {
  it("splits on punctuation", () => {
    expect(texts("font-family")).toEqual(["font", "family"]);
  });

  it("keeps digits inside a word", () => {
    expect(texts("base64 encoding")).toEqual(["base64", "encoding"]);
  });

  it("drops leading and trailing punctuation", () => {
    expect(texts('"Segoe UI", sans-serif')).toEqual([
      "segoe",
      "ui",
      "sans",
      "serif",
    ]);
  });

  it("returns nothing for a string with no word characters", () => {
    // The caller reads an empty word list as "no tokens", which must not be
    // confused with "match everything".
    expect(foldWords("() - .")).toEqual([]);
    expect(foldWords("")).toEqual([]);
  });

  it("records offsets that slice the original text back out", () => {
    const source = "Show a filterable menu as you type.";
    for (const word of foldWords(source)) {
      expect(source.slice(word.start, word.end).toLowerCase()).toBe(word.text);
    }
  });

  it("records correct offsets around an accented word", () => {
    // The invariant the whole highlight feature rests on: folding changes
    // string length, so a range must come from tokenising the ORIGINAL, not
    // from indexing the folded text.
    const source = "Temática y técnicas";
    const words = foldWords(source);
    expect(words.map((w) => source.slice(w.start, w.end))).toEqual([
      "Temática",
      "y",
      "técnicas",
    ]);
    expect(words.map((w) => w.text)).toEqual(["tematica", "y", "tecnicas"]);
  });
});

describe("foldWords — camel case", () => {
  it("emits the whole run and its parts", () => {
    // Both spellings are real queries: `opendyslexic` is what you get pasting
    // out of the control, `open dyslexic` is how a person writes it.
    expect(texts("OpenDyslexic")).toEqual(["opendyslexic", "open", "dyslexic"]);
  });

  it("splits a run of more than two parts", () => {
    expect(texts("SaveAsPdf")).toEqual(["saveaspdf", "save", "as", "pdf"]);
  });

  it("stops splitting at the start of an acronym run", () => {
    // "Giphy" splits, then "APIKey" is left whole because "API" is an
    // acronym — splitting there would index a meaningless "a".
    expect(texts("GiphyAPIKey")).toEqual(["giphyapikey", "giphy", "apikey"]);
  });

  it("splits after a digit", () => {
    expect(texts("Base64Encoding")).toEqual([
      "base64encoding",
      "base64",
      "encoding",
    ]);
  });

  it("does not split an acronym run", () => {
    // "PDFExport" has no unambiguous boundary, so guessing one would index a
    // nonsense fragment. Leaving it whole is the honest outcome.
    expect(texts("PDFExport")).toEqual(["pdfexport"]);
  });

  it("does not emit duplicate parts for a word that is not camel-cased", () => {
    expect(texts("Appearance")).toEqual(["appearance"]);
  });

  it("splits a run already in the middle of a sentence, keeping offsets true", () => {
    const source = "Try OpenDyslexic today";
    const words = foldWords(source);
    for (const word of words) {
      expect(foldText(source.slice(word.start, word.end))).toBe(word.text);
    }
    expect(words.find((w) => w.text === "open")?.start).toBe(4);
    expect(words.find((w) => w.text === "dyslexic")?.start).toBe(8);
  });
});

describe("tokenizeQuery", () => {
  it("lowercases and splits on whitespace and punctuation", () => {
    expect(tokenizeQuery("Open Dyslexic, please")).toEqual([
      "open",
      "dyslexic",
      "please",
    ]);
  });

  it("treats a hyphenated query the same as its spaced form", () => {
    expect(tokenizeQuery("api-key")).toEqual(tokenizeQuery("api key"));
  });

  it("folds accents so an unaccented query reaches accented copy", () => {
    expect(tokenizeQuery("tematica")).toEqual(["tematica"]);
    expect(tokenizeQuery("TEMÁTICA")).toEqual(["tematica"]);
  });

  it("returns nothing for an empty or punctuation-only query", () => {
    expect(tokenizeQuery("")).toEqual([]);
    expect(tokenizeQuery("   ")).toEqual([]);
    expect(tokenizeQuery("()")).toEqual([]);
  });
});
