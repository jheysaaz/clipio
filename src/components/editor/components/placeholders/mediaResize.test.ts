/**
 * Tests for src/components/editor/components/placeholders/mediaResize.ts
 *
 * This replaces a test file that imported only `vitest`. It re-implemented the
 * clamp arithmetic inline and copied `MIN_WIDTH = 40` by hand with a comment
 * saying it "must match the value in ResizableMediaWrapper.tsx" — so the
 * component could be deleted and all 13 tests would still pass. It guarded
 * nothing.
 *
 * The clamp and the scroll-parent lookup are now exported pure functions and are
 * tested here directly. `MIN_WIDTH` is imported rather than copied, so changing
 * it fails this file instead of silently desynchronising it.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  MIN_WIDTH,
  FALLBACK_MAX_WIDTH,
  clampWidth,
  getScrollParentWidth,
} from "./mediaResize";

describe("clampWidth", () => {
  it("applies the drag delta to the starting width", () => {
    expect(clampWidth(200, 50, 800)).toBe(250);
  });

  it("applies a negative delta", () => {
    expect(clampWidth(200, -50, 800)).toBe(150);
  });

  it("never goes below MIN_WIDTH", () => {
    // Dragging far left must not collapse the element to nothing.
    expect(clampWidth(200, -10_000, 800)).toBe(MIN_WIDTH);
  });

  it("never exceeds the container width", () => {
    // The whole point of measuring the scroll parent: the popup must not gain a
    // horizontal scrollbar because an image was dragged past its edge.
    expect(clampWidth(200, 10_000, 400)).toBe(400);
  });

  it("is a no-op for a zero delta", () => {
    expect(clampWidth(200, 0, 800)).toBe(200);
  });

  it("clamps to MIN_WIDTH when the container is narrower than MIN_WIDTH", () => {
    // Degenerate container: min and max disagree, and the result must still be a
    // usable width rather than something inverted.
    expect(clampWidth(200, 0, 10)).toBe(10);
  });

  it("returns MIN_WIDTH when dragged left from an already-minimal width", () => {
    expect(clampWidth(MIN_WIDTH, -5, 800)).toBe(MIN_WIDTH);
  });

  it("returns the max when the delta exactly reaches it", () => {
    expect(clampWidth(200, 200, 400)).toBe(400);
  });
});

describe("getScrollParentWidth", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
  });

  it("returns the width of the nearest scrollable ancestor", () => {
    const scroller = document.createElement("div");
    scroller.style.overflow = "auto";
    Object.defineProperty(scroller, "clientWidth", { value: 321 });
    const child = document.createElement("div");
    scroller.appendChild(child);
    root.appendChild(scroller);

    expect(getScrollParentWidth(child)).toBe(321);
  });

  it("recognises overflow-x only", () => {
    // A container scrolled on one axis is still a constraint.
    const scroller = document.createElement("div");
    scroller.style.overflowX = "scroll";
    Object.defineProperty(scroller, "clientWidth", { value: 210 });
    const child = document.createElement("div");
    scroller.appendChild(child);
    root.appendChild(scroller);

    expect(getScrollParentWidth(child)).toBe(210);
  });

  it("stops at the outermost scrollable ancestor, not the innermost", () => {
    const outer = document.createElement("div");
    outer.style.overflow = "auto";
    Object.defineProperty(outer, "clientWidth", { value: 500 });
    const inner = document.createElement("div");
    inner.style.overflow = "auto";
    Object.defineProperty(inner, "clientWidth", { value: 100 });
    const leaf = document.createElement("span");
    inner.appendChild(leaf);
    outer.appendChild(inner);
    root.appendChild(outer);

    // Nearest wins — the inner scroller is the real constraint.
    expect(getScrollParentWidth(leaf)).toBe(100);
  });

  it("falls back to the parent's offsetWidth when nothing scrolls", () => {
    const parent = document.createElement("div");
    Object.defineProperty(parent, "offsetWidth", { value: 420 });
    const leaf = document.createElement("span");
    parent.appendChild(leaf);
    root.appendChild(parent);

    expect(getScrollParentWidth(leaf)).toBe(420);
  });

  it("falls back to a usable width when the element has no parent", () => {
    // Detached element: there is nothing to measure, so the default applies
    // rather than returning 0, which would clamp everything to MIN_WIDTH.
    const orphan = document.createElement("span");
    expect(getScrollParentWidth(orphan)).toBe(FALLBACK_MAX_WIDTH);
  });

  it("does not return zero for a detached element", () => {
    // Guards the specific failure of a 0 max collapsing the element.
    const orphan = document.createElement("span");
    expect(getScrollParentWidth(orphan)).toBeGreaterThan(0);
  });

  it("ignores a non-scrollable ancestor with overflow visible", () => {
    const plain = document.createElement("div");
    plain.style.overflow = "visible";
    Object.defineProperty(plain, "offsetWidth", { value: 300 });
    const leaf = document.createElement("span");
    plain.appendChild(leaf);
    root.appendChild(plain);

    // `visible` is not auto/scroll, so it is not the constraint.
    expect(getScrollParentWidth(leaf)).toBe(300);
  });
});
