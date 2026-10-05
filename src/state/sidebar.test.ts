import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  clampSidebarWidth,
  nudgeSidebarWidth,
  setSidebarWidth,
  setSidebarWidthToMax,
  setSidebarWidthToMin,
  sidebarStore,
  useSidebarWidth,
} from "./sidebar";

import {
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/config/constants";

/**
 * The reason this module exists.
 *
 * The width was `useState` in `Dashboard.tsx`, so it reset every time the popup
 * closed — and a popup closes on every blur. Dragging the divider and clicking
 * back into the page lost the size.
 *
 * The clamp lives here rather than in the component because the popup and the
 * options page are different documents reading the same key: nothing stopped a
 * stale stored value from exceeding the bounds the resizer enforces.
 */

const items = vi.hoisted(() => ({
  sidebarWidthItem: {
    getValue: vi.fn(async () => DEFAULT_SIDEBAR_WIDTH),
    setValue: vi.fn(async () => {}),
    watch: vi.fn((_cb: (v: number) => void) => () => {}),
  },
}));

vi.mock("@/storage/items", () => items);
vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }));

function width(): number {
  return sidebarStore.state.width;
}

/**
 * The callback the module registered at import.
 *
 * Read out of the mock rather than exported, so the test drives the real
 * subscription path — including the no-op guard — instead of calling the store
 * directly and proving nothing about it.
 */
function lastWatchCallback(): (value: number) => void {
  const calls = items.sidebarWidthItem.watch.mock.calls;
  const callback = calls[calls.length - 1]?.[0];
  if (!callback) throw new Error("the store never subscribed to the item");
  return callback;
}

beforeEach(() => {
  sidebarStore.setState(() => ({
    width: DEFAULT_SIDEBAR_WIDTH,
    isLoaded: true,
  }));
  items.sidebarWidthItem.getValue.mockResolvedValue(DEFAULT_SIDEBAR_WIDTH);
});

// ---------------------------------------------------------------------------

describe("clampSidebarWidth", () => {
  it("leaves a width inside the range alone", () => {
    expect(clampSidebarWidth(180)).toBe(180);
  });

  it("clamps to the minimum and the maximum", () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(5000)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("rounds a fractional width", () => {
    // `aria-valuenow` on a separator is a number, and a fractional one would make
    // the slider value ambiguous.
    expect(clampSidebarWidth(180.6)).toBe(181);
  });

  it("falls back to the default for a value that is not a number", () => {
    // A hand-edited key, a restored backup, or a build whose bounds were wider.
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("accepts the bounds themselves", () => {
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH)).toBe(SIDEBAR_MAX_WIDTH);
  });
});

describe("setting the width", () => {
  it("sets a width inside the range", () => {
    setSidebarWidth(180);
    expect(width()).toBe(180);
  });

  it("clamps on the way in", () => {
    // A drag cannot leave the divider somewhere the keyboard resize cannot reach.
    setSidebarWidth(9);
    expect(width()).toBe(SIDEBAR_MIN_WIDTH);

    setSidebarWidth(9000);
    expect(width()).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("nudges up and down, stopping at the bounds", () => {
    setSidebarWidth(180);

    nudgeSidebarWidth(20);
    expect(width()).toBe(200);

    nudgeSidebarWidth(-20);
    expect(width()).toBe(180);

    // And a nudge past the edge stops there rather than wrapping or going further.
    nudgeSidebarWidth(-1000);
    expect(width()).toBe(SIDEBAR_MIN_WIDTH);
    nudgeSidebarWidth(1000);
    expect(width()).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("goes to each bound", () => {
    setSidebarWidthToMin();
    expect(width()).toBe(SIDEBAR_MIN_WIDTH);

    setSidebarWidthToMax();
    expect(width()).toBe(SIDEBAR_MAX_WIDTH);
  });
});

describe("React bindings", () => {
  it("re-renders on a width change", () => {
    // Measured rather than merely present: a binding wired to the wrong store
    // fails silently, returning a valid undefined-shaped value.
    const { result } = renderHook(() => useSidebarWidth((s) => s.width));

    expect(result.current).toBe(DEFAULT_SIDEBAR_WIDTH);

    act(() => setSidebarWidth(180));

    expect(result.current).toBe(180);
  });
});

/**
 * The load, the self-heal and the cross-context watch.
 *
 * These run at module scope, so they are exercised by re-importing with a fresh
 * module registry and a fresh mock — the same pattern the storage tests use. Testing
 * them through the top-level import would assert against a mock installed after
 * the load had already run.
 */
async function importWithValue(stored: number) {
  vi.resetModules();
  items.sidebarWidthItem.getValue.mockResolvedValue(stored);
  items.sidebarWidthItem.setValue.mockClear();
  return import("./sidebar");
}

describe("loading", () => {
  it("applies the stored width", async () => {
    const mod = await importWithValue(180);
    expect(mod.sidebarStore.state.width).toBe(180);
    expect(mod.sidebarStore.state.isLoaded).toBe(true);
  });

  it("clamps a stored value from outside the range", async () => {
    // A hand-edited key, a restored backup, or a build whose bounds were wider.
    const mod = await importWithValue(9000);

    expect(mod.sidebarStore.state.width).toBe(SIDEBAR_MAX_WIDTH);
    // And writes the clamp back, so it stops being re-clamped on every load
    // instead of lingering forever.
    expect(items.sidebarWidthItem.setValue).toHaveBeenCalledWith(
      SIDEBAR_MAX_WIDTH
    );
  });

  it("does not write back a value that was already in range", async () => {
    await importWithValue(180);

    expect(items.sidebarWidthItem.setValue).not.toHaveBeenCalled();
  });

  it("keeps the default and still settles when the read fails", async () => {
    vi.resetModules();
    items.sidebarWidthItem.getValue.mockRejectedValue(new Error("no storage"));
    const mod = await import("./sidebar");

    // `isLoaded` matters: persistence runs off changes, so leaving it false would
    // keep the store inert and the width would silently stop being saved.
    expect(mod.sidebarStore.state.width).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(mod.sidebarStore.state.isLoaded).toBe(true);
  });
});

describe("a change made elsewhere", () => {
  it("applies a width written by another context", async () => {
    const mod = await importWithValue(180);

    // The store subscribed at import; this stands in for the watcher's callback.
    const watch = lastWatchCallback();
    act(() => watch(200));

    expect(mod.sidebarStore.state.width).toBe(200);
  });

  it("clamps an out-of-range value from another context", async () => {
    const mod = await importWithValue(180);
    const watch = lastWatchCallback();

    act(() => watch(50));

    expect(mod.sidebarStore.state.width).toBe(SIDEBAR_MIN_WIDTH);
  });

  it("ignores a write that changes nothing", async () => {
    const mod = await importWithValue(180);
    const watch = lastWatchCallback();

    act(() => watch(180));

    // Otherwise the popup re-renders its whole sidebar for a no-op write.
    expect(mod.sidebarStore.state.width).toBe(180);
  });
});
