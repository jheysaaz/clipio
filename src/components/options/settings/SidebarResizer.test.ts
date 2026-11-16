/**
 * Tests for the sidebar width helpers.
 *
 * The clamp is the part that matters: an unclamped width read back from
 * storage would let a stale or hand-edited value collapse the rail or squeeze
 * the content pane off-screen.
 *
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  clampSidebarWidth,
  readSidebarWidth,
  SIDEBAR_MIN_PX,
  SIDEBAR_MAX_PX,
  SIDEBAR_DEFAULT_PX,
} from "./SidebarResizer";

describe("clampSidebarWidth", () => {
  it("falls back to the default for a non-finite width", () => {
    // The defect: `Math.round(NaN)` is `NaN`, and `Math.min(max, Math.max(min, NaN))`
    // is `NaN` too — so a corrupt stored value or a stray `undefined` produced
    // `NaN`, and every comparison against it was false, which put the divider
    // off-screen rather than at an edge. `readSidebarWidth`'s own guard hid this
    // for the stored path; the resizer's `onWidthChange` callers had no guard.
    //
    // Note that `src/store/sidebar.ts` exports a function with this same name and
    // this same contract. The duplication is worth collapsing, and that is a
    // separate change with its own cost.
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_PX);
    // Infinities take the default too, not the nearest bound. A drag cannot produce
    // one — only a corrupt stored value could — and "we do not know" should answer
    // "here is a sensible width", not "give the user the maximum". It also matches
    // the popup's twin in `src/store/sidebar.ts`, which matters more than it looks:
    // two functions with one name should not have two contracts.
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(
      SIDEBAR_DEFAULT_PX
    );
    expect(clampSidebarWidth(Number.NEGATIVE_INFINITY)).toBe(
      SIDEBAR_DEFAULT_PX
    );
  });

  it("keeps a width already inside the range", () => {
    expect(clampSidebarWidth(300)).toBe(300);
  });

  it("clamps to the minimum so labels cannot collapse to nothing", () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN_PX);
    expect(clampSidebarWidth(-500)).toBe(SIDEBAR_MIN_PX);
  });

  it("clamps to the maximum so the content pane stays usable", () => {
    expect(clampSidebarWidth(2000)).toBe(SIDEBAR_MAX_PX);
  });

  it("rounds to whole pixels", () => {
    expect(clampSidebarWidth(255.6)).toBe(256);
  });

  it("is idempotent", () => {
    const once = clampSidebarWidth(9999);
    expect(clampSidebarWidth(once)).toBe(once);
  });
});

describe("readSidebarWidth", () => {
  const original = globalThis.localStorage;

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: original,
      configurable: true,
    });
  });

  const setStorage = (value: string | null) => {
    const store = {
      getItem: () => value,
      setItem: () => {},
    };
    Object.defineProperty(globalThis, "localStorage", {
      value: store,
      configurable: true,
    });
  };

  it("returns the default when nothing is stored", () => {
    setStorage(null);
    expect(readSidebarWidth()).toBe(SIDEBAR_DEFAULT_PX);
  });

  it("returns a stored width", () => {
    setStorage("300");
    expect(readSidebarWidth()).toBe(300);
  });

  it("clamps a stored width that is now out of range", () => {
    // A user who had a very wide rail before the maximum changed.
    setStorage("5000");
    expect(readSidebarWidth()).toBe(SIDEBAR_MAX_PX);
  });

  it("falls back to the default on unparseable storage", () => {
    setStorage("not-a-number");
    expect(readSidebarWidth()).toBe(SIDEBAR_DEFAULT_PX);
  });

  // Negative: storage can throw in a restricted context, and a throw here
  // would take the whole options page down before it renders.
  it("falls back to the default when storage throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      get() {
        throw new Error("blocked");
      },
      configurable: true,
    });
    expect(readSidebarWidth()).toBe(SIDEBAR_DEFAULT_PX);
  });
});
