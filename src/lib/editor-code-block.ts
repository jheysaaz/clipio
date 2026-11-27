/**
 * Plain-text extraction for the editor's code-block UI.
 *
 * Plate children are a tree of text leaves and nested inline elements. Reading
 * the DOM's `innerText` would include the copy button's label and depend on a
 * browser having laid the block out, so the copy action reads the Slate tree
 * instead. This is pure so the copy contract is testable without a renderer.
 */

type TreeNode = {
  text?: unknown;
  children?: unknown;
};

/** Flatten a Slate descendant tree into the text a code block contains. */
export function codeBlockText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(codeBlockText).join("");

  if (node && typeof node === "object") {
    const { text, children } = node as TreeNode;
    if (typeof text === "string") return text;
    if (children !== undefined) return codeBlockText(children);
  }

  return "";
}
