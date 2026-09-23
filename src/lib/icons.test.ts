import { describe, it, expect } from "vitest";
import { ICON_SIZE, ICON_STROKE } from "./icons";

describe("ICON_SIZE", () => {
  it("exposes the full token scale in ascending pixel order", () => {
    expect(Object.keys(ICON_SIZE)).toEqual([
      "xs",
      "sm",
      "md",
      "lg",
      "xl",
      "2xl",
      "3xl",
    ]);
  });

  it("maps each token to its Tailwind size class", () => {
    expect(ICON_SIZE).toEqual({
      xs: "size-2.5", // 10px
      sm: "size-3", // 12px
      md: "size-3.5", // 14px
      lg: "size-4", // 16px
      xl: "size-5", // 20px
      "2xl": "size-6", // 24px
      "3xl": "size-8", // 32px
    });
  });

  it("emits size-* classes so the shadcn fallback guard skips wrapper icons", () => {
    for (const cls of Object.values(ICON_SIZE)) {
      expect(cls).toMatch(/^size-/);
    }
  });
});

describe("ICON_STROKE", () => {
  it("collapses to the two-value scheme plus the micro exception", () => {
    expect(ICON_STROKE.default).toBe(1.5);
    expect(ICON_STROKE.emphasis).toBe(2);
    expect(ICON_STROKE.micro).toBe(2.5);
  });

  it("contains exactly three named values", () => {
    expect(Object.keys(ICON_STROKE).sort()).toEqual([
      "default",
      "emphasis",
      "micro",
    ]);
  });
});
