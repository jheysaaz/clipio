import { describe, expect, it } from "vitest";

import { scrollTopForRow, virtualRange } from "./virtual-list";

describe("virtualRange", () => {
  it("renders the first screen plus overscan at the top of the list", () => {
    // 10px rows, 30px viewport, 1 row of overscan: rows 0..4 cover the screen
    // and one extra row below it.
    expect(virtualRange(100, 0, 30, 10, 1)).toEqual({
      start: 0,
      end: 5,
      paddingTop: 0,
      paddingBottom: 950,
    });
  });

  it("moves the window with scrollTop and pads both sides", () => {
    expect(virtualRange(100, 50, 30, 10, 1)).toEqual({
      start: 4,
      end: 9,
      paddingTop: 40,
      paddingBottom: 910,
    });
  });

  it("never asks for a row past the end of a short list", () => {
    const range = virtualRange(3, 0, 1000, 10, 4);
    expect(range).toEqual({
      start: 0,
      end: 3,
      paddingTop: 0,
      paddingBottom: 0,
    });
  });

  it("returns an empty slice for an empty list", () => {
    expect(virtualRange(0, 120, 400, 52)).toEqual({
      start: 0,
      end: 0,
      paddingTop: 0,
      paddingBottom: 0,
    });
  });

  it("clamps a negative scrollTop and a non-positive row height", () => {
    expect(virtualRange(10, -80, 30, 10, 1).start).toBe(0);
    expect(virtualRange(10, 0, 30, 0).end).toBe(0);
    expect(virtualRange(10, 0, 0, 10).end).toBe(0);
  });
});

describe("scrollTopForRow", () => {
  it("does not scroll when the row is already visible", () => {
    expect(scrollTopForRow(2, 0, 100, 10)).toBeNull();
  });

  it("centres a row below the viewport, including the header height", () => {
    // Row 20 starts at 20*10 + 12 = 212. A 100px viewport centred there
    // starts at 212 - (100-10)/2 = 167.
    expect(scrollTopForRow(20, 0, 100, 10, 12)).toBe(167);
  });

  it("returns null for an invalid row or viewport", () => {
    expect(scrollTopForRow(-1, 0, 100, 10)).toBeNull();
    expect(scrollTopForRow(1, 0, 100, 0)).toBeNull();
    expect(scrollTopForRow(1, 0, 0, 10)).toBeNull();
  });
});
