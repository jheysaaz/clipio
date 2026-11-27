/**
 * The range to delete when a slash command inserts a placeholder.
 *
 * The live caret is the only range that covers the query typed after `/`; the
 * slash menu's saved range stops at the moment `/` was pressed. Computing the
 * deletion from that live range keeps the decision in plain data, so both the
 * happy path and the rejected ones are testable without a DOM.
 *
 * An empty query is a trigger in its own right: the menu opens on a bare `/`,
 * so choosing a command must remove that one character just as it removes
 * `/tod`.
 */

import type { EditorRange } from "@/store/editor-selection";

/** A slash trigger is a single `/` plus the query typed after it. */
export function slashDeletionRange(
  range: EditorRange | null,
  query: string
): EditorRange | null {
  if (!range) return null;
  if (range.anchor.offset !== range.focus.offset) return null;
  if (
    range.anchor.path.length !== range.focus.path.length ||
    range.anchor.path.some((part, i) => part !== range.focus.path[i])
  ) {
    return null;
  }

  const length = query.length + 1;
  if (range.anchor.offset < length) return null;

  return {
    anchor: {
      path: [...range.anchor.path],
      offset: range.anchor.offset - length,
    },
    // Keep the focus where the caret was: `delete()` needs an expanded range
    // from before the slash to the end of the query, not a collapsed point.
    focus: {
      path: [...range.focus.path],
      offset: range.focus.offset,
    },
  };
}
