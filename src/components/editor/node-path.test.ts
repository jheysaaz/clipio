import { describe, expect, it } from "vitest";
import type { Descendant, TElement } from "platejs";

import { findNodePath } from "./node-path";

const paragraph = (children: Descendant[]): TElement =>
  ({ type: "p", children }) as TElement;

describe("findNodePath", () => {
  it("finds an inserted void by its Plate id", () => {
    const target = {
      id: "inserted",
      type: "image_placeholder",
      children: [{ text: "" }],
    } as TElement;
    const nodes: Descendant[] = [
      paragraph([{ text: "" }, target, { text: "" }]),
    ];

    expect(findNodePath(nodes, target)).toEqual([0, 1]);
  });

  it("finds a nested node when Plate reassigned no id", () => {
    const target = {
      type: "gif_placeholder",
      children: [{ text: "" }],
    } as TElement;
    const nodes: Descendant[] = [
      paragraph([{ text: "" }]),
      {
        type: "blockquote",
        children: [paragraph([{ text: "before" }, target])],
      } as TElement,
    ];

    expect(findNodePath(nodes, target)).toEqual([1, 0, 1]);
  });

  it("returns null when the node is not in the tree", () => {
    const nodes: Descendant[] = [paragraph([{ text: "plain" }])];

    expect(
      findNodePath(nodes, {
        type: "image_placeholder",
        children: [{ text: "" }],
      } as TElement)
    ).toBeNull();
  });

  it("does not match a text leaf as an element", () => {
    const target = { type: "p", children: [{ text: "" }] } as TElement;

    expect(findNodePath([{ text: "p" }], target)).toBeNull();
  });
});
