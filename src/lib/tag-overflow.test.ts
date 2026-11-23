import { describe, expect, it } from "vitest";
import { visibleTagCount } from "./tag-overflow";

describe("visibleTagCount", () => {
  it("keeps every chip visible when they all fit", () => {
    expect(visibleTagCount([40, 50, 60], 30, 240)).toBe(3);
  });

  it("reserves room for the overflow chip and collapses the tail", () => {
    // Two chips plus +1 need 40 + 6 + 50 + 6 + 30 = 132px, so only one fits
    // in 120px; the remaining two belong in the popover.
    expect(visibleTagCount([40, 50, 60], 30, 120)).toBe(1);
  });

  it("shows only the overflow chip when no tag fits", () => {
    expect(visibleTagCount([40, 50, 60], 30, 30)).toBe(0);
  });

  it("does not report a negative count when even the overflow chip is too wide", () => {
    expect(visibleTagCount([40, 50], 30, 10)).toBe(0);
  });

  it("keeps every chip visible until the row has a measurable width", () => {
    expect(visibleTagCount([40, 50], 30, 0)).toBe(2);
  });

  it("handles an empty tag list", () => {
    expect(visibleTagCount([], 30, 120)).toBe(0);
  });
});
