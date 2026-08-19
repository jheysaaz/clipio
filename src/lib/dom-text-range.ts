/**
 * DOM helpers for mapping character offsets within a contenteditable
 * element's `textContent` to concrete text nodes / range offsets.
 *
 * Used by the content script's preview insertion path ("insertSnippetInContentEditable")
 * in src/entrypoints/content.ts to replace the typed trigger range with an
 * HTML fragment without destroying the target field's existing formatting.
 */

export interface LocatedTextRange {
  startNode: Text;
  startOffset: number;
  endNode: Text;
  endOffset: number;
}

/**
 * Maps `[startPos, endPos)` offsets into `element.textContent` (which is the
 * depth-first concatenation of all descendent text nodes) to concrete text
 * nodes and local offsets within them.
 *
 * Returns `null` when the element contains no text nodes, or the offsets are
 * out of range for the given text.
 */
export function locateTextRange(
  element: HTMLElement,
  startPos: number,
  endPos: number
): LocatedTextRange | null {
  if (!Number.isFinite(startPos) || !Number.isFinite(endPos)) return null;
  if (startPos < 0 || endPos < startPos) return null;

  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  if (textNodes.length === 0) return null;

  const totalLength = textNodes.reduce(
    (acc, textNode) => acc + (textNode.textContent?.length ?? 0),
    0
  );
  if (endPos > totalLength) return null;

  let startNode = textNodes[0];
  let startOffset = 0;
  let endNode = textNodes[textNodes.length - 1];
  let endOffset = 0;
  let acc = 0;

  for (const textNode of textNodes) {
    const len = textNode.textContent?.length ?? 0;
    if (startPos >= acc && startPos <= acc + len) {
      startNode = textNode;
      startOffset = startPos - acc;
    }
    if (endPos >= acc && endPos <= acc + len) {
      endNode = textNode;
      endOffset = endPos - acc;
    }
    acc += len;
  }

  return { startNode, startOffset, endNode, endOffset };
}

/**
 * Returns the caret position as an offset into `element.textContent`, i.e.
 * the number of text characters that precede the caret across the whole
 * element (not just the focused text node).
 *
 * `Selection.focusOffset` is relative to the focus node only, so it cannot be
 * used to index into `element.textContent` when the field contains multiple
 * text nodes (e.g. after a rich-text insertion). This function clones the
 * element's contents up to the caret and measures the resulting text length,
 * which is robust regardless of the focus node type.
 */
export function getCaretTextOffset(element: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;
  const focusNode = selection.focusNode;
  const focusOffset = selection.focusOffset;
  if (!focusNode || !element.contains(focusNode)) return 0;

  try {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(focusNode, focusOffset);
    const clone = range.cloneContents();
    return clone.textContent?.length ?? 0;
  } catch {
    return element.textContent?.length ?? 0;
  }
}