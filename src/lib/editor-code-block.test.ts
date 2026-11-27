import { describe, expect, it } from "vitest";
import { codeBlockText } from "./editor-code-block";

describe("codeBlockText", () => {
  it("flattens nested Slate leaves in document order", () => {
    expect(
      codeBlockText([
        { text: "const " },
        { type: "code_block", children: [{ text: "answer" }] },
        { text: " = 42;" },
      ])
    ).toBe("const answer = 42;");
  });

  it("does not copy UI chrome or non-text descendants", () => {
    expect(codeBlockText({ children: [{ text: "body" }, null, 7] })).toBe(
      "body"
    );
  });

  it("returns an empty string for a block with no text", () => {
    expect(codeBlockText(undefined)).toBe("");
    expect(codeBlockText({ children: [] })).toBe("");
  });
});
