/**
 * The shortcut field's input grammar.
 *
 * The popup stores a shortcut as one string, including its trigger prefix (for
 * example `/addr`). The prefix is configuration, not something a person typing
 * a shortcut means to change, so the editor re-applies it after every edit.
 * These functions are pure so the two rules — "the prefix survives" and "only
 * supported body characters are accepted" — can be tested without rendering
 * the editor.
 */

/** Letters, digits, dot, dash and underscore. Whitespace is rejected first so
 * it gets its more specific error message. */
const SUPPORTED_BODY_CHARACTER = /[\p{L}\p{N}._-]/u;

/** The editable part of a stored shortcut, with the configured prefix removed. */
export function shortcutBody(value: string, prefix: string): string {
  return prefix && value.startsWith(prefix)
    ? value.slice(prefix.length)
    : value;
}

/**
 * Turn spaces into dashes as they are typed. Shortcuts are single tokens, so a
 * space is never useful; rewriting it keeps the edit valid without a visible
 * error. Other unsupported characters stay untouched for validation to report.
 */
export function shortcutSpacesToDashes(value: string): string {
  return value.replace(/\s/gu, "-");
}

/**
 * Normalise what the user typed back into a full stored shortcut.
 *
 * Leading whitespace is ignored and a different leading symbol is replaced by
 * the configured prefix. A symbol *inside* the body is left alone so validation
 * can name it: silently deleting it would make an invalid edit look accepted.
 */
export function withProtectedPrefix(value: string, prefix: string): string {
  if (!prefix) return value;
  const trimmed = value.replace(/^\s+/, "");
  // Clear restores the prefix, so typing it again must not double it. Collapse
  // every repeated leading prefix before applying the supported-character rule.
  let body = trimmed;
  while (body.startsWith(prefix)) body = body.slice(prefix.length);
  if (!trimmed.startsWith(prefix)) {
    body = body.replace(/^[^\p{L}\p{N}._-]+/u, "");
  }
  return `${prefix}${body}`;
}

/** Unsupported characters in the editable body, in the order first seen. */
export function unsupportedShortcutCharacters(
  value: string,
  prefix: string
): string[] {
  const seen = new Set<string>();
  for (const character of shortcutBody(value, prefix)) {
    if (!SUPPORTED_BODY_CHARACTER.test(character)) seen.add(character);
  }
  return [...seen];
}

export type ShortcutInputProblem = "spaces" | "characters" | null;

/** The first input problem worth telling the user about. */
export function shortcutInputProblem(
  value: string,
  prefix: string
): ShortcutInputProblem {
  const body = shortcutBody(value, prefix);
  if (/\s/u.test(body)) return "spaces";
  return unsupportedShortcutCharacters(value, prefix).length > 0
    ? "characters"
    : null;
}
