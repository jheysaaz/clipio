import type { Grammar } from "prismjs";
// Same core instance the helper uses: mutating the default `prismjs` entry
// would create a second Prism object and test the wrong grammar registry.
import Prism from "prismjs/components/prism-core.min.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  CODE_LANGUAGES,
  codeGrammar,
  codeLanguageId,
  highlightCodeRanges,
} from "./editor-code-highlight";

describe("codeLanguageId", () => {
  it("keeps ids offered by the picker and discards unknown fence info", () => {
    expect(codeLanguageId("tsx")).toBe("tsx");
    expect(codeLanguageId(" made-up ")).toBe("");
    expect(codeLanguageId(undefined)).toBe("");
  });
});

describe("codeGrammar", () => {
  it("resolves aliases to loaded Prism grammars", () => {
    expect(codeGrammar("js")).toBe("javascript");
    expect(codeGrammar("HTML")).toBe("markup");
    expect(codeGrammar("py")).toBe("python");
  });

  it("returns null for plain text, a text fence, and unknown languages", () => {
    expect(codeGrammar(undefined)).toBeNull();
    expect(codeGrammar("")).toBeNull();
    expect(codeGrammar("text")).toBeNull();
    expect(codeGrammar("not-a-language")).toBeNull();
  });
});

describe("highlightCodeRanges", () => {
  const originalJavascript = Prism.languages.javascript;
  const originalSql = Prism.languages.sql;

  // These tests replace a loaded grammar to exercise alias and nested-token
  // paths the default grammars do not produce. Restoring it keeps the suite
  // order-independent.
  afterEach(() => {
    Prism.languages.javascript = originalJavascript;
    if (originalSql) Prism.languages.sql = originalSql;
    else delete Prism.languages.sql;
  });

  it("returns offset ranges that cover a highlighted token", () => {
    const code = "const answer = 42;";
    const ranges = highlightCodeRanges(code, "javascript");
    const keyword = ranges.find(
      (range) =>
        code.slice(range.start, range.end) === "const" &&
        range.token === "keyword"
    );
    expect(keyword).toBeDefined();
  });

  it("lets nested tokens override their parent class", () => {
    const code = 'const name = "Ada";';
    const ranges = highlightCodeRanges(code, "javascript");
    const string = ranges.find(
      (range) => code.slice(range.start, range.end) === '"Ada"'
    );
    expect(string?.token).toBe("string");
  });

  it("leaves plain text and unknown languages unstyled", () => {
    expect(highlightCodeRanges("const x = 1;", "")).toEqual([]);
    expect(highlightCodeRanges("const x = 1;", "not-a-language")).toEqual([]);
    expect(highlightCodeRanges("", "javascript")).toEqual([]);
  });

  it("resolves aliases, walks nested content, and skips unknown or empty tokens", () => {
    Prism.languages.javascript = {
      outer: {
        pattern: /<[^>]*>/,
        alias: ["tag", "markup"],
        inside: { inner: { pattern: /NAME/, alias: "property" } },
      },
      unknown: /TODO/,
      empty: { pattern: /(?=X)/, alias: "keyword" },
    } as Grammar;

    const code = "<NAME> TODO X";
    const ranges = highlightCodeRanges(code, "javascript");
    // The parent is emitted first so a nested token can override it; the
    // unknown type and zero-length token produce no decoration at all.
    expect(
      ranges.map(({ start, end, token }) => [code.slice(start, end), token])
    ).toEqual([
      ["<NAME>", "tag"],
      ["NAME", "property"],
    ]);
  });

  it("returns no ranges when the mapped grammar is not loaded", () => {
    delete Prism.languages.sql;
    expect(highlightCodeRanges("select 1", "sql")).toEqual([]);
  });

  it("offers plain text plus every grammar it can highlight", () => {
    for (const language of CODE_LANGUAGES) {
      if (!language.id) continue;
      expect(codeGrammar(language.id)).not.toBeNull();
    }
  });
});
