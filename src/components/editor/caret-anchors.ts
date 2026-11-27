/**
 * Keep inline voids editable by giving the caret somewhere to stand.
 *
 * Slate needs a text node on each side of an inline void. When a void is the
 * first or last child of a block — which is exactly what `{{image:id}}` alone,
 * or a phrase ending in a GIF, deserialises to — there is no text leaf to hold
 * a selection. Clicking beside it then either puts the caret on the wrong side
 * or refuses to place it at all.
 *
 * This is structural, not a click handler: the same nodes are used by the
 * editor, by undo, and by anything that reopens a stored snippet. Empty text
 * leaves serialise back to nothing, so the saved markdown is unchanged.
 */

import type { Descendant, TElement, TText } from "platejs";
import {
  CLIPBOARD_PLACEHOLDER,
  CURSOR_PLACEHOLDER,
  DATE_PLACEHOLDER,
  DATEPICKER_PLACEHOLDER,
  GIF_PLACEHOLDER,
  IMAGE_PLACEHOLDER,
} from "./types";

const INLINE_VOID_TYPES = new Set<string>([
  CLIPBOARD_PLACEHOLDER,
  CURSOR_PLACEHOLDER,
  DATE_PLACEHOLDER,
  DATEPICKER_PLACEHOLDER,
  GIF_PLACEHOLDER,
  IMAGE_PLACEHOLDER,
]);

const isText = (node: Descendant): node is TText => "text" in node;

const isInlineVoid = (node: Descendant): boolean =>
  !isText(node) &&
  typeof node.type === "string" &&
  INLINE_VOID_TYPES.has(node.type);

/**
 * Return a copy of `nodes` with a text leaf before and after every inline void.
 *
 * Existing text leaves are reused; only missing neighbours are added. Two voids
 * in a row therefore share the single empty leaf inserted between them, which
 * is enough for Slate to put the caret either side of either one.
 */
export function withCaretAnchors(nodes: Descendant[]): Descendant[] {
  return nodes.map((node) => {
    if (isText(node)) return node;

    const element = node as TElement;
    const children = withCaretAnchors(element.children as Descendant[]);
    if (!children.some(isInlineVoid)) return { ...element, children };

    const anchored: Descendant[] = [];
    for (const child of children) {
      const previous = anchored[anchored.length - 1];
      if (isInlineVoid(child) && (!previous || !isText(previous))) {
        anchored.push({ text: "" });
      }
      anchored.push(child);
    }
    if (isInlineVoid(children[children.length - 1]!)) {
      anchored.push({ text: "" });
    }

    return { ...element, children: anchored };
  });
}
