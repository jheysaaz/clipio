/**
 * Tests for the sidebar width helpers.
 *
 * The clamp is the part that matters: an unclamped width read back from
 * storage would let a stale or hand-edited value collapse the rail or squeeze
 * the content pane off-screen.
 *
 * spec: specs/options-redesign.spec.md
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
