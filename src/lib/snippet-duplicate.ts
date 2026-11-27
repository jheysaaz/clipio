/**
 * Pure field derivation for "Duplicate snippet".
 *
 * A duplicate must not inherit its source's shortcut: Clipio rejects both exact
 * and prefix-overlapping shortcuts, and `/addr-copy` starts with `/addr`, so
 * appending a suffix would produce a copy that can never be saved. The copy
 * prefix goes before the body instead, and a numbered fallback handles an
 * existing copy.
 */

import type { Snippet } from "@/types";
import type { EditorFields } from "./snippet-draft";
import { detectShortcutConflict } from "./snippet-utils";

/** Split a stored shortcut into its configured symbol and editable body. */
export function shortcutPrefixAndBody(shortcut: string): {
  prefix: string;
  body: string;
} {
  const match = shortcut.match(/^([^\p{L}\p{N}])([\s\S]*)$/u);
  return match
    ? { prefix: match[1], body: match[2] }
    : { prefix: "", body: shortcut };
}

function candidateShortcut(
  prefix: string,
  body: string,
  suffix: string
): string {
  const base = body ? `${suffix}${body}` : suffix;
  return `${prefix}${base}`;
}

/**
 * Build the fields of a new snippet copied from `source`.
 *
 * `label` is supplied by the caller so this module stays free of i18n; content
 * and tags are copied verbatim. Every candidate is checked against the whole
 * library, including the source, because prefix conflicts matter here.
 */
export function duplicateSnippetFields(
  source: EditorFields,
  existing: readonly Snippet[],
  label: string
): EditorFields {
  const { prefix, body } = shortcutPrefixAndBody(source.shortcut);
  let shortcut = candidateShortcut(prefix, body, "copy-");
  for (
    let attempt = 2;
    existing.some((s) => detectShortcutConflict(shortcut, [s]));
    attempt += 1
  ) {
    shortcut = candidateShortcut(prefix, body, `copy-${attempt}-`);
  }
  return {
    label,
    shortcut,
    content: source.content,
    tags: [...(source.tags ?? [])],
  };
}
