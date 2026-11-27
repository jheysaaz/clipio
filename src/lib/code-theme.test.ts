import { describe, expect, it } from "vitest";

import type { CodeTokenClass } from "./editor-code-highlight";
import {
  CODE_TOKEN_CLASS_NAMES,
  DARK_CODE_THEMES,
  DEFAULT_DARK_CODE_THEME,
  DEFAULT_LIGHT_CODE_THEME,
  LIGHT_CODE_THEMES,
  activeCodeTheme,
  codeThemeSegments,
  normalizeDarkCodeTheme,
  normalizeLightCodeTheme,
} from "./code-theme";

describe("code theme normalization", () => {
  it("accepts every preset in its own mode", () => {
    for (const theme of LIGHT_CODE_THEMES) {
      expect(normalizeLightCodeTheme(theme)).toBe(theme);
    }
    for (const theme of DARK_CODE_THEMES) {
      expect(normalizeDarkCodeTheme(theme)).toBe(theme);
    }
  });

  it("falls back to the matching mode's default for invalid values", () => {
    // Storage can be edited by hand or restored from an older backup; a
    // preset from the wrong mode must not leave tokens unstyled.
    expect(normalizeLightCodeTheme("one-dark-pro")).toBe(
      DEFAULT_LIGHT_CODE_THEME
    );
    expect(normalizeDarkCodeTheme("github-light")).toBe(
      DEFAULT_DARK_CODE_THEME
    );
    expect(normalizeLightCodeTheme(undefined)).toBe(DEFAULT_LIGHT_CODE_THEME);
    expect(normalizeDarkCodeTheme(null)).toBe(DEFAULT_DARK_CODE_THEME);
    expect(normalizeLightCodeTheme(42)).toBe(DEFAULT_LIGHT_CODE_THEME);
  });

  it("never mixes the two mode vocabularies", () => {
    expect(
      LIGHT_CODE_THEMES.some((theme) =>
        DARK_CODE_THEMES.includes(theme as never)
      )
    ).toBe(false);
  });
});

describe("activeCodeTheme", () => {
  it("uses the light preset in light mode and the dark preset in dark mode", () => {
    expect(activeCodeTheme("light", "github-light", "okaidia")).toBe(
      "github-light"
    );
    expect(activeCodeTheme("dark", "github-light", "okaidia")).toBe("okaidia");
  });
});

describe("CODE_TOKEN_CLASS_NAMES", () => {
  it("gives every Prism token class a distinct, non-empty CSS class", () => {
    const tokenClasses: CodeTokenClass[] = [
      "comment",
      "string",
      "keyword",
      "number",
      "function",
      "operator",
      "punctuation",
      "regex",
      "tag",
      "property",
      "variable",
      "class",
    ];
    const classes = tokenClasses.map((token) => CODE_TOKEN_CLASS_NAMES[token]);

    expect(classes.every((value) => typeof value === "string" && value)).toBe(
      true
    );
    expect(new Set(classes).size).toBe(tokenClasses.length);
  });
});

describe("codeThemeSegments", () => {
  it("keeps untagged text and merges neighbouring characters by token", () => {
    expect(
      codeThemeSegments("a = 1", [
        { start: 0, end: 1, token: "variable" },
        { start: 2, end: 3, token: "operator" },
        { start: 4, end: 5, token: "number" },
      ])
    ).toEqual([
      { text: "a", token: "variable" },
      { text: " ", token: undefined },
      { text: "=", token: "operator" },
      { text: " ", token: undefined },
      { text: "1", token: "number" },
    ]);
  });

  it("lets the later, more specific range win and clamps stray offsets", () => {
    // A nested token is emitted after its parent by highlightCodeRanges; the
    // sample renderer must show the nested colour rather than the parent's.
    expect(
      codeThemeSegments("abc", [
        { start: -4, end: 9, token: "string" },
        { start: 1, end: 2, token: "keyword" },
      ])
    ).toEqual([
      { text: "a", token: "string" },
      { text: "b", token: "keyword" },
      { text: "c", token: "string" },
    ]);
  });
});
