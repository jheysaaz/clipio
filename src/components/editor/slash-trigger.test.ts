import { describe, expect, it } from "vitest";

import type { EditorRange } from "@/store/editor-selection";
import { slashDeletionRange } from "./slash-trigger";

const range = (offset: number, focusOffset = offset): EditorRange => ({
  anchor: { path: [0, 0], offset },
  focus: { path: [0, 0], offset: focusOffset },
});

describe("slashDeletionRange", () => {
  it("covers the slash and everything typed after it", () => {
    expect(slashDeletionRange(range(6), "img")).toEqual({
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 6 },
    });
  });

  it("rejects a missing query, because there is no slash text to remove", () => {
    expect(slashDeletionRange(range(6), "")).toBeNull();
  });

  it("rejects a range that does not start after a whole trigger", () => {
    expect(slashDeletionRange(range(2), "img")).toBeNull();
  });

  it("rejects a non-collapsed selection instead of deleting user text", () => {
    expect(slashDeletionRange(range(6, 9), "img")).toBeNull();
  });

  it("rejects a selection spanning multiple text leaves", () => {
    const spanning: EditorRange = {
      anchor: { path: [0, 0], offset: 6 },
      focus: { path: [0, 1], offset: 6 },
    };
    expect(slashDeletionRange(spanning, "img")).toBeNull();
  });

  it("rejects a missing range", () => {
    expect(slashDeletionRange(null, "img")).toBeNull();
  });
});
