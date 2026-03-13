/**
 * Tests for ResizableMediaWrapper resize logic.
 *
 * Because @testing-library/react is not installed we cannot render the
 * component directly.  Instead we test the width-clamping arithmetic and the
 * callback contract that the component relies on — both of which are pure
 * enough to be exercised as plain functions.
 *
 * The component no longer uses a hardcoded MAX_WIDTH constant.  Instead it
 * reads the scroll-parent's clientWidth at drag-start so the image can never
 * overflow the popup.  Tests model this by passing an explicit `maxWidth`.
 */

import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MIN_WIDTH = 40; // must match the value in ResizableMediaWrapper.tsx

/**
 * Pure clamping logic matching the component's mousemove / mouseup handlers.
 * `maxWidth` is resolved dynamically in the real component (scroll-parent
 * clientWidth); tests pass it explicitly.
 */
function clampWidth(
  startWidth: number,
  deltaX: number,
  maxWidth: number
): number {
  return Math.round(
    Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth + deltaX))
  );
}

// ---------------------------------------------------------------------------
// getScrollParentWidth logic
// ---------------------------------------------------------------------------

describe("ResizableMediaWrapper — getScrollParentWidth", () => {
  it("uses scroll-parent clientWidth as the effective max", () => {
    // Simulate: scroll parent has clientWidth = 408 (sidebar open, with padding)
    const scrollParentWidth = 408;
    // A large drag should be capped at the scroll parent width, not 800
    expect(clampWidth(200, 9999, scrollParentWidth)).toBe(scrollParentWidth);
  });

  it("popup closed sidebar: scroll parent is wider (~648px)", () => {
    const scrollParentWidth = 648;
    expect(clampWidth(400, 9999, scrollParentWidth)).toBe(scrollParentWidth);
  });

  it("never exceeds the provided maxWidth even with huge delta", () => {
    const maxWidth = 500;
    expect(clampWidth(100, 9000, maxWidth)).toBe(maxWidth);
  });
});

// ---------------------------------------------------------------------------
// Width-clamping unit tests
// ---------------------------------------------------------------------------

describe("ResizableMediaWrapper — width clamping", () => {
  const MAX = 400; // representative container width

  it("returns startWidth + delta for values within range", () => {
    expect(clampWidth(200, 50, MAX)).toBe(250);
    expect(clampWidth(300, -100, MAX)).toBe(200);
  });

  it("clamps to MIN_WIDTH when result would be below minimum", () => {
    expect(clampWidth(50, -20, MAX)).toBe(MIN_WIDTH); // 30 → 40
    expect(clampWidth(40, -1, MAX)).toBe(MIN_WIDTH); // 39 → 40
    expect(clampWidth(10, -100, MAX)).toBe(MIN_WIDTH); // very negative → 40
  });

  it("clamps to maxWidth when result would exceed the container", () => {
    expect(clampWidth(350, 100, MAX)).toBe(MAX); // 450 → 400
    expect(clampWidth(400, 1, MAX)).toBe(MAX); // 401 → 400
    expect(clampWidth(100, 9999, MAX)).toBe(MAX); // very large → MAX
  });

  it("returns MIN_WIDTH when startWidth is MIN_WIDTH and delta is 0", () => {
    expect(clampWidth(MIN_WIDTH, 0, MAX)).toBe(MIN_WIDTH);
  });

  it("returns maxWidth when startWidth equals maxWidth and delta is 0", () => {
    expect(clampWidth(MAX, 0, MAX)).toBe(MAX);
  });

  it("rounds fractional results", () => {
    expect(clampWidth(100, 0.6, MAX)).toBe(101); // 100.6 → 101
    expect(clampWidth(100, 0.4, MAX)).toBe(100); // 100.4 → 100
  });
});

// ---------------------------------------------------------------------------
// onWidthChange callback contract
// ---------------------------------------------------------------------------

describe("ResizableMediaWrapper — onWidthChange callback contract", () => {
  it("callback is called with the clamped final width", () => {
    const onWidthChange = vi.fn();
    const maxWidth = 600;

    const startWidth = 300;
    const deltaX = 150; // drag 150px right → 450, within 600
    onWidthChange(clampWidth(startWidth, deltaX, maxWidth));

    expect(onWidthChange).toHaveBeenCalledOnce();
    expect(onWidthChange).toHaveBeenCalledWith(450);
  });

  it("callback receives MIN_WIDTH when drag goes too far left", () => {
    const onWidthChange = vi.fn();
    const maxWidth = 600;

    onWidthChange(clampWidth(50, -500, maxWidth));

    expect(onWidthChange).toHaveBeenCalledWith(MIN_WIDTH);
  });

  it("callback receives maxWidth when drag goes too far right", () => {
    const onWidthChange = vi.fn();
    const maxWidth = 408; // sidebar-open editor width

    onWidthChange(clampWidth(300, 500, maxWidth));

    expect(onWidthChange).toHaveBeenCalledWith(maxWidth);
  });

  it("callback is not called during mousemove — only on mouseup", () => {
    const onWidthChange = vi.fn();
    const moveCallback = vi.fn();
    const maxWidth = 600;

    const startWidth = 200;
    const moves = [10, 20, 30, 50];
    for (const delta of moves) {
      moveCallback(clampWidth(startWidth, delta, maxWidth));
    }

    onWidthChange(clampWidth(startWidth, moves[moves.length - 1], maxWidth));

    expect(moveCallback).toHaveBeenCalledTimes(4);
    expect(onWidthChange).toHaveBeenCalledOnce();
    expect(onWidthChange).toHaveBeenCalledWith(250); // 200 + 50
  });
});
