/**
 * Unit tests for locateTextRange — maps offsets into a contenteditable
 * element's textContent to concrete text nodes / range offsets.
 */

import { describe, it, expect } from "vitest";
import { locateTextRange, getCaretTextOffset } from "./dom-text-range";

describe("locateTextRange", () => {
  function makeElement(html: string): HTMLElement {
    const el = document.createElement("div");
    el.innerHTML = html;
    return el;
  }

  it("locates a range within a single text node", () => {
    const el = makeElement("hello world");
    const located = locateTextRange(el, 6, 11);

    expect(located).not.toBeNull();
    expect(located!.startNode).toBe(located!.endNode);
    expect(located!.startNode.textContent).toBe("hello world");
    expect(located!.startOffset).toBe(6);
    expect(located!.endOffset).toBe(11);
  });

  it("locates the full range of a single text node", () => {
    const el = makeElement("abcdef");
    const located = locateTextRange(el, 0, 6);
    expect(located).not.toBeNull();
    // Ends at the node boundary, not beyond it
    expect(located!.startNode.textContent).toBe("abcdef");
    expect(located!.startOffset).toBe(0);
    expect(located!.endNode.textContent).toBe("abcdef");
    expect(located!.endOffset).toBe(6);
  });

  it("locates ranges across sibling text nodes", () => {
    // three <i> wrappers produce three sibling text nodes below the root
    const el = makeElement("<i>ab</i><i>cd</i><i>ef</i>");
    // textContent = "abcdef"
    const located = locateTextRange(el, 1, 5);

    expect(located).not.toBeNull();
    expect(located!.startNode.textContent).toBe("ab");
    expect(located!.startOffset).toBe(1);
    expect(located!.endNode.textContent).toBe("ef");
    expect(located!.endOffset).toBe(1); // 5 - 4 (ab+cd) = 1
    expect(located!.startNode).not.toBe(located!.endNode);
  });

  it("prefers the following node when a boundary falls between nodes", () => {
    // textContent = "abcdef"; [2,4) = "cd"
    const el = makeElement("ab<b>cd</b>ef");
    const located = locateTextRange(el, 2, 4);

    expect(located).not.toBeNull();
    // start boundary (2) lands exactly on the "ab"→"cd" split → picks "cd"
    expect(located!.startNode.textContent).toBe("cd");
    expect(located!.startOffset).toBe(0);
    // end boundary (4) lands on the "cd"→"ef" split → picks "ef"
    expect(located!.endNode.textContent).toBe("ef");
    expect(located!.endOffset).toBe(0);
    expect(located!.startNode).not.toBe(located!.endNode);
  });

  it("locates a range contained within one nested text node", () => {
    // textContent = "abcdef"; [2,3) = "c" — single node after the boundary
    const el = makeElement("ab<b>cd</b>ef");
    const located = locateTextRange(el, 2, 3);

    expect(located).not.toBeNull();
    expect(located!.startNode.textContent).toBe("cd");
    expect(located!.startOffset).toBe(0);
    expect(located!.endNode).toBe(located!.startNode);
    expect(located!.endOffset).toBe(1);
  });

  it("handles a zero-length range at a node boundary", () => {
    const el = makeElement("ab<i>cd</i>");
    const located = locateTextRange(el, 2, 2);
    expect(located).not.toBeNull();
    expect(located!.startNode.textContent).toBe("cd");
    expect(located!.startOffset).toBe(0);
    expect(located!.endOffset).toBe(0);
  });

  it("returns null when the element has no text nodes", () => {
    const el = makeElement("");
    expect(locateTextRange(el, 0, 0)).toBeNull();
  });

  it("returns null when endPos exceeds the text length", () => {
    const el = makeElement("abc");
    expect(locateTextRange(el, 0, 10)).toBeNull();
  });

  it("returns null for invalid offsets", () => {
    const el = makeElement("abc");
    expect(locateTextRange(el, -1, 2)).toBeNull();
    expect(locateTextRange(el, 3, 1)).toBeNull();
    expect(locateTextRange(el, Number.NaN, 2)).toBeNull();
    expect(locateTextRange(el, Infinity, 2)).toBeNull();
  });

  it("replaces a trigger range with an HTML fragment preserving line breaks", () => {
    // Simulate the content-script insertion algorithm: the trigger "/bar" is
    // fully contained in one text node, so it is split around and an HTML
    // fragment (with a <br>) is inserted in between.
    const el = makeElement("foo /bar baz");

    const located = locateTextRange(el, 4, 8);
    expect(located).not.toBeNull();
    const { startNode, startOffset, endNode, endOffset } = located!;
    expect(startNode).toBe(endNode);

    const temp = document.createElement("div");
    temp.innerHTML = "Line1<br>Line2";
    const fragment = document.createDocumentFragment();
    while (temp.firstChild) fragment.appendChild(temp.firstChild);

    const fullText = startNode.textContent || "";
    startNode.textContent = fullText.substring(0, startOffset);
    const afterText = fullText.substring(endOffset);
    if (afterText) {
      const afterNode = document.createTextNode(afterText);
      startNode.parentNode!.insertBefore(afterNode, startNode.nextSibling);
      startNode.parentNode!.insertBefore(fragment, afterNode);
    } else {
      startNode.parentNode!.insertBefore(fragment, startNode.nextSibling);
    }

    // Trigger text is gone, surrounding text is preserved
    expect(el.textContent).toBe("foo Line1Line2 baz");
    expect(el.textContent).not.toContain("/bar");
    // The <br> survives as a real element node (old code wiped it via textContent)
    expect(el.querySelector("br")).not.toBeNull();
    // Text order: before / Line1 / <br> / Line2 / after
    const nodes = Array.from(el.childNodes);
    expect(nodes).toHaveLength(5);
    expect((nodes[0] as Text).textContent).toBe("foo ");
    expect((nodes[1] as Text).textContent).toBe("Line1");
    expect(nodes[2].nodeName).toBe("BR");
    expect((nodes[3] as Text).textContent).toBe("Line2");
    expect((nodes[4] as Text).textContent).toBe(" baz");
  });

  it("replaces a range spanning multiple text nodes via deleteContents", () => {
    const el = makeElement("pre<i>xx</i>mid<i>yy</i>post");
    // textContent = "prexxmidyypost"; trigger = "xxmidyy" → [3, 10)
    const located = locateTextRange(el, 3, 10);
    expect(located).not.toBeNull();
    const { startNode, startOffset, endNode, endOffset } = located!;
    expect(startNode.textContent).toBe("xx");
    expect(startOffset).toBe(0);
    expect(endNode.textContent).toBe("post");
    expect(endOffset).toBe(0);
    expect(startNode).not.toBe(endNode);

    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    range.deleteContents();
    range.insertNode(document.createTextNode("N"));

    expect(el.textContent).toBe("preNpost");
  });

  describe("getCaretTextOffset", () => {
  function placeCaret(element: HTMLElement, atEnd = true) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(!atEnd);
    selection!.removeAllRanges();
    selection!.addRange(range);
  }

  function placeCaretAt(element: HTMLElement, node: Node, offset: number) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    selection!.removeAllRanges();
    selection!.addRange(range);
  }

  it("returns the full text length when the caret is at the end (flat)", () => {
    const el = document.createElement("div");
    el.textContent = "Hello World";
    placeCaret(el, true);
    expect(getCaretTextOffset(el)).toBe(11);
  });

  it("returns 0 when the caret is at the start", () => {
    const el = document.createElement("div");
    el.textContent = "Hello World";
    placeCaret(el, false);
    expect(getCaretTextOffset(el)).toBe(0);
  });

  it("returns the global offset inside a nested element structure", () => {
    const el = document.createElement("div");
    el.innerHTML = "<div>Hello </div><div>World<br></div>";
    // textContent = "Hello World"
    placeCaret(el, true);
    expect(getCaretTextOffset(el)).toBe(11);
  });

  it("returns the offset into a middle text node", () => {
    const el = document.createElement("div");
    el.innerHTML = "<div>Hello </div><div>World<br></div>";
    // textContent = "Hello World"; caret after "World" is at global offset 11
    const lastText = el.querySelector("div:nth-child(2)")!.firstChild as Text;
    placeCaretAt(el, lastText, 5);
    expect(getCaretTextOffset(el)).toBe(11);
  });

  it("respects the offset within the focused node, not just node boundaries", () => {
    const el = document.createElement("div");
    el.innerHTML = "<div>Hello </div><div>World<br></div>";
    // caret after "Wo" in "World" → global offset 6 ("Hello "=6) + 2 = 8
    const lastText = el.querySelector("div:nth-child(2)")!.firstChild as Text;
    placeCaretAt(el, lastText, 2);
    expect(getCaretTextOffset(el)).toBe(8);
  });

  it("returns 0 when there is no selection", () => {
    const el = document.createElement("div");
    el.textContent = "Hello World";
    const original = window.getSelection;
    (window as any).getSelection = () => null;
    try {
      expect(getCaretTextOffset(el)).toBe(0);
    } finally {
      (window as any).getSelection = original;
    }
  });

  it("returns 0 when the caret is outside the element", () => {
    const el = document.createElement("div");
    el.textContent = "Hello World";
    const other = document.createElement("div");
    other.textContent = "outside";
    document.body.appendChild(other);
    placeCaretAt(el, other.firstChild as Text, 3);
    expect(getCaretTextOffset(el)).toBe(0);
    other.remove();
  });
});
});