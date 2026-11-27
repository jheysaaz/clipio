/**
 * User-selectable syntax palettes, one per UI theme.
 *
 * The presets are data in TypeScript and CSS custom properties in `app.css`:
 * the editor renders Prism token classes, and `data-code-theme` on the document
 * decides what those classes mean. Storing a light and a dark preset separately
 * is what lets a snippet look like GitHub Light in the light UI and One Dark Pro
 * in the dark UI without the user changing anything on every theme switch.
 */

import type { CodeTokenClass, CodeTokenRange } from "./editor-code-highlight";

/** Light-mode presets, in the order shown in the Appearance picker. */
export const LIGHT_CODE_THEMES = [
  "github-light",
  "solarized-light",
  "prism-light",
  "coy",
  "xcode",
] as const;

/** Dark-mode presets, in the order shown in the Appearance picker. */
export const DARK_CODE_THEMES = [
  "one-dark-pro",
  "okaidia",
  "twilight",
  "tomorrow-night",
  "dracula",
  "nord",
  "vsc-dark-plus",
] as const;

export type LightCodeTheme = (typeof LIGHT_CODE_THEMES)[number];
export type DarkCodeTheme = (typeof DARK_CODE_THEMES)[number];
export type CodeTheme = LightCodeTheme | DarkCodeTheme;
export type ResolvedUiTheme = "light" | "dark";

export const DEFAULT_LIGHT_CODE_THEME: LightCodeTheme = "github-light";
export const DEFAULT_DARK_CODE_THEME: DarkCodeTheme = "one-dark-pro";

/** Attribute painted on `<html>` and on local preview samples. */
export const CODE_THEME_ATTRIBUTE = "data-code-theme";

/**
 * Storage is writable from every extension context and restorable from a
 * backup, so a saved value is not guaranteed to be one of ours. An unknown
 * preset falls back to the shipped default instead of leaving tokens unstyled.
 */
export function normalizeLightCodeTheme(value: unknown): LightCodeTheme {
  return (
    LIGHT_CODE_THEMES.find((theme) => theme === value) ??
    DEFAULT_LIGHT_CODE_THEME
  );
}

export function normalizeDarkCodeTheme(value: unknown): DarkCodeTheme {
  return (
    DARK_CODE_THEMES.find((theme) => theme === value) ?? DEFAULT_DARK_CODE_THEME
  );
}

/** The preset actually painted for the UI theme currently in effect. */
export function activeCodeTheme(
  resolvedTheme: ResolvedUiTheme,
  light: LightCodeTheme,
  dark: DarkCodeTheme
): CodeTheme {
  return resolvedTheme === "dark" ? dark : light;
}

/** A contiguous run of text sharing one Prism token class. */
export type CodeSegment = { text: string; token?: CodeTokenClass };

/**
 * Turn Prism's character ranges into renderable runs. Later ranges win where
 * tokens overlap, matching the parent-first order `highlightCodeRanges` emits
 * so a nested interpolation overrides its surrounding string.
 */
export function codeThemeSegments(
  text: string,
  ranges: readonly CodeTokenRange[]
): CodeSegment[] {
  const tokens = Array<CodeTokenClass | undefined>(text.length);
  for (const range of ranges) {
    const start = Math.max(0, range.start);
    const end = Math.min(text.length, range.end);
    for (let index = start; index < end; index += 1) {
      tokens[index] = range.token;
    }
  }

  const segments: CodeSegment[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const token = tokens[index];
    const previous = segments[segments.length - 1];
    if (previous && previous.token === token) {
      previous.text += text[index];
    } else {
      segments.push({ text: text[index], token });
    }
  }
  return segments;
}

/** Stable CSS classes for every token class Prism ranges can produce. */
export const CODE_TOKEN_CLASS_NAMES: Record<CodeTokenClass, string> = {
  comment: "code-token code-token-comment",
  string: "code-token code-token-string",
  keyword: "code-token code-token-keyword",
  number: "code-token code-token-number",
  function: "code-token code-token-function",
  operator: "code-token code-token-operator",
  punctuation: "code-token code-token-punctuation",
  regex: "code-token code-token-regex",
  tag: "code-token code-token-tag",
  property: "code-token code-token-property",
  variable: "code-token code-token-variable",
  class: "code-token code-token-class",
};
