import { describe, expect, it } from "vitest";
import type { Descendant, TElement } from "platejs";

import {
  CLIPBOARD_PLACEHOLDER,
  DATEPICKER_PLACEHOLDER,
  GIF_PLACEHOLDER,
  IMAGE_PLACEHOLDER,
} from "./types";
import { withCaretAnchors } from "./caret-anchors";

const voidNode = (type: string, id: string): TElement =>
  ({ type, mediaId: id, children: [{ text: "" }] }) as TElement;

const types = (nodes: Descendant[]): string[] =>
  nodes.map((node) => ("text" in node ? "text" : String(node.type)));

describe("withCaretAnchors", () => {
  it("puts the caret on both sides of a void that is alone in its block", () => {
    const nodes: Descendant[] = [
      {
        type: "p",
        children: [voidNode(IMAGE_PLACEHOLDER, "media-1")],
      } as TElement,
    ];

    const anchored = withCaretAnchors(nodes);

    expect(types(anchored[0].children as Descendant[])).toEqual([
      "text",
      IMAGE_PLACEHOLDER,
      "text",
    ]);
  });

  it("keeps existing text beside a trailing GIF", () => {
    const nodes: Descendant[] = [
      {
        type: "p",
        children: [{ text: "before " }, voidNode(GIF_PLACEHOLDER, "gif-1")],
      } as TElement,
    ];

    const anchored = withCaretAnchors(nodes);
    const children = anchored[0].children as Descendant[];

    expect(types(children)).toEqual(["text", GIF_PLACEHOLDER, "text"]);
    expect(children[0]).toEqual({ text: "before " });
  });

  it("shares one caret leaf between consecutive voids", () => {
    const nodes: Descendant[] = [
      {
        type: "p",
        children: [
          voidNode(CLIPBOARD_PLACEHOLDER, ""),
          voidNode(DATEPICKER_PLACEHOLDER, ""),
        ],
      } as TElement,
    ];

    const children = withCaretAnchors(nodes)[0].children as Descendant[];

    expect(types(children)).toEqual([
      "text",
      CLIPBOARD_PLACEHOLDER,
      "text",
      DATEPICKER_PLACEHOLDER,
      "text",
    ]);
  });

  it("leaves blocks without inline voids untouched", () => {
    const nodes: Descendant[] = [
      { type: "p", children: [{ text: "plain" }] } as TElement,
    ];

    expect(withCaretAnchors(nodes)).toEqual(nodes);
  });

  it("walks nested block structures", () => {
    const nodes: Descendant[] = [
      {
        type: "blockquote",
        children: [
          {
            type: "p",
            children: [voidNode(GIF_PLACEHOLDER, "nested")],
          } as TElement,
        ],
      } as TElement,
    ];

    const paragraph = (withCaretAnchors(nodes)[0] as TElement)
      .children[0] as TElement;

    expect(types(paragraph.children as Descendant[])).toEqual([
      "text",
      GIF_PLACEHOLDER,
      "text",
    ]);
  });
});
