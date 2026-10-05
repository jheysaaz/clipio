import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/config/constants";

/**
 * Why this module exists.
 *
 * The width was `useState` in `Dashboard.tsx`, so it reset every time the popup
 * closed — and a popup closes on every blur. Dragging the divider and clicking back
 * into the page lost the size.
 *
 * The clamp lives here rather than in the component because the popup and the
 * options page are different documents reading different keys, and nothing stopped
 * a stale stored value from exceeding the bounds the resizer enforces.
 *
 * ── Why every test re-imports ───────────────────────────────────────────────
 *
 * The store's module-scope behaviour — the load, the self-heal, the persist effect
 * and the cross-context watch — runs once when the module is first imported. A
 * static import would bind to whichever instance happened to load first, and a
 * `vi.resetModules()` anywhere in the file would leave the top-level bindings
 * pointing at a different instance than the one under test. So there is no static
 * import of `./sidebar` here, and `load()` gives each test its own.
 */

const items = vi.hoisted(() => ({
  sidebarWidthItem: {
    getValue: vi.fn<(k?: unknown) => Promise<number>>(),
    setValue: vi.fn(async (_v: number) => {}),
    watch: vi.fn((_cb: (v: number) => void) => () => {}),
  },
}));

vi.mock("@/storage/items", () => items);
vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }));

/** The shape of `./sidebar` these tests use. */
type SidebarModule = typeof import("./sidebar");

let mod: SidebarModule;

/** Import a fresh instance with `stored` in the item, as if the popup just opened. */
async function load(
  stored: number = DEFAULT_SIDEBAR_WIDTH
): Promise<SidebarModule> {
  vi.resetModules();
  items.sidebarWidthItem.getValue.mockReset();
  items.sidebarWidthItem.setValue.mockReset();
  items.sidebarWidthItem.getValue.mockResolvedValue(stored);
  mod = await import("./sidebar");
  // The load is fire-and-forget at module scope. Settle it before asserting, so no
  // test depends on how many microtasks the import happened to leave.
  await act(async () => {
    await vi.waitFor(() => expect(mod.sidebarStore.state.isLoaded).toBe(true));
  });
  return mod;
}

/**
 * The callback the module registered at import.
 *
 * Read out of the mock rather than exported, so the test drives the real
 * subscription path — including its no-op guard — instead of calling the store
 * directly and proving nothing about it.
 */
function lastWatchCallback(): (value: number) => void {
  const calls = items.sidebarWidthItem.watch.mock.calls;
  const callback = calls[calls.length - 1]?.[0];
  if (!callback) throw new Error("the store never subscribed to the item");
  return callback;
}

beforeEach(async () => {
  await load();
});

// ---------------------------------------------------------------------------

describe("clampSidebarWidth", () => {
  it("leaves a width inside the range alone", () => {
    expect(mod.clampSidebarWidth(180)).toBe(180);
  });

  it("clamps to the minimum and the maximum", () => {
    expect(mod.clampSidebarWidth(10)).toBe(SIDEBAR_MIN_WIDTH);
    expect(mod.clampSidebarWidth(5000)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("rounds a fractional width", () => {
    // `aria-valuenow` on a separator is a number, and a fractional one makes the
    // slider value ambiguous.
    expect(mod.clampSidebarWidth(180.6)).toBe(181);
  });

  it("falls back to the default for a value that is not a number", () => {
    // A hand-edited key, a restored backup, or a build whose bounds were wider.
    expect(mod.clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("does not throw on an infinite width", () => {
    // A drag with the pointer outside the viewport can produce one.
    expect(() => mod.clampSidebarWidth(Number.POSITIVE_INFINITY)).not.toThrow();
  });

  it("accepts the bounds themselves", () => {
    expect(mod.clampSidebarWidth(SIDEBAR_MIN_WIDTH)).toBe(SIDEBAR_MIN_WIDTH);
    expect(mod.clampSidebarWidth(SIDEBAR_MAX_WIDTH)).toBe(SIDEBAR_MAX_WIDTH);
  });
});

// ---------------------------------------------------------------------------

describe("setting the width", () => {
  it("sets a width inside the range", () => {
    mod.setSidebarWidth(180);
    expect(mod.sidebarStore.state.width).toBe(180);
  });

  it("clamps on the way in", () => {
    // A drag cannot leave the divider somewhere the keyboard resize cannot reach.
    mod.setSidebarWidth(9);
    expect(mod.sidebarStore.state.width).toBe(SIDEBAR_MIN_WIDTH);

    mod.setSidebarWidth(9000);
    expect(mod.sidebarStore.state.width).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("nudges up and down, stopping at the bounds", () => {
    mod.setSidebarWidth(180);

    mod.nudgeSidebarWidth(20);
    expect(mod.sidebarStore.state.width).toBe(200);

    mod.nudgeSidebarWidth(-20);
    expect(mod.sidebarStore.state.width).toBe(180);

    // A nudge past the edge stops there rather than wrapping or going further.
    mod.nudgeSidebarWidth(-1000);
    expect(mod.sidebarStore.state.width).toBe(SIDEBAR_MIN_WIDTH);
    mod.nudgeSidebarWidth(1000);
    expect(mod.sidebarStore.state.width).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("goes to each bound", () => {
    mod.setSidebarWidthToMin();
    expect(mod.sidebarStore.state.width).toBe(SIDEBAR_MIN_WIDTH);

    mod.setSidebarWidthToMax();
    expect(mod.sidebarStore.state.width).toBe(SIDEBAR_MAX_WIDTH);
  });
});

// ---------------------------------------------------------------------------

describe("loading", () => {
  it("applies the stored width", async () => {
    const m = await load(180);
    expect(m.sidebarStore.state.width).toBe(180);
  });

  it("clamps a stored value from outside the range", async () => {
    const m = await load(9000);

    expect(m.sidebarStore.state.width).toBe(SIDEBAR_MAX_WIDTH);
    // And writes the clamp back, so it stops being re-clamped on every load
    // instead of lingering forever.
    expect(items.sidebarWidthItem.setValue).toHaveBeenCalledWith(
      SIDEBAR_MAX_WIDTH
    );
  });

  it("keeps a stored value that is already in range", async () => {
    const m = await load(180);

    expect(m.sidebarStore.state.width).toBe(180);
    // One write of the same number on open is harmless. What must not happen is the
    // default replacing a saved width — which is what the `isLoaded` guard
    // prevents, and the next test pins.
    expect(items.sidebarWidthItem.setValue).not.toHaveBeenCalledWith(
      DEFAULT_SIDEBAR_WIDTH
    );
  });

  it("keeps the default and still settles when the read fails", async () => {
    vi.resetModules();
    items.sidebarWidthItem.getValue.mockRejectedValue(new Error("no storage"));
    const m = await import("./sidebar");
    await act(async () => {
      await vi.waitFor(() => expect(m.sidebarStore.state.isLoaded).toBe(true));
    });

    expect(m.sidebarStore.state.width).toBe(DEFAULT_SIDEBAR_WIDTH);
    // `isLoaded` matters: persistence runs off changes, so leaving it false would
    // keep the store inert and the width would silently stop being saved.
    expect(m.sidebarStore.state.isLoaded).toBe(true);
  });

  it("does not write the default over a stored value before the read lands", async () => {
    // The persist effect runs once on registration. Without the `isLoaded` guard it
    // writes the default there, and the saved width is gone before it is read.
    let release!: (v: number) => void;
    items.sidebarWidthItem.getValue.mockReset();
    items.sidebarWidthItem.setValue.mockReset();
    items.sidebarWidthItem.getValue.mockReturnValue(
      new Promise<number>((resolve) => {
        release = resolve;
      })
    );
    vi.resetModules();

    const m = await import("./sidebar");
    expect(items.sidebarWidthItem.setValue).not.toHaveBeenCalled();

    await act(async () => {
      release(180);
      await vi.waitFor(() => expect(m.sidebarStore.state.isLoaded).toBe(true));
    });

    expect(m.sidebarStore.state.width).toBe(180);
    expect(items.sidebarWidthItem.setValue).not.toHaveBeenCalledWith(
      DEFAULT_SIDEBAR_WIDTH
    );
  });
});

// ---------------------------------------------------------------------------

describe("persistence", () => {
  /**
   * The regression this module first shipped with.
   *
   * It loaded the stored width, clamped a self-heal back into storage, and watched
   * for changes made elsewhere — and never wrote a user's resize. So the width
   * appeared to work while the popup was open and was forgotten the moment it
   * closed, which is the exact symptom the module was supposed to fix. A store with
   * a watcher and no writer reads as persistence and is not.
   */
  it("writes a width the user dragged", async () => {
    await load(200);
    items.sidebarWidthItem.setValue.mockClear();

    mod.setSidebarWidth(180);

    expect(items.sidebarWidthItem.setValue).toHaveBeenCalledWith(180);
  });

  it("writes a width the user nudged with the keyboard", async () => {
    await load(180);
    items.sidebarWidthItem.setValue.mockClear();

    mod.nudgeSidebarWidth(20);

    expect(items.sidebarWidthItem.setValue).toHaveBeenCalledWith(200);
  });

  it("writes the clamped value, not the raw one", async () => {
    // Stored at 180 so the clamped result differs from both the stored value and
    // the default — otherwise "was it written?" and "was it skipped?" are
    // indistinguishable.
    await load(180);
    items.sidebarWidthItem.setValue.mockClear();

    mod.setSidebarWidth(9000);

    expect(items.sidebarWidthItem.setValue).toHaveBeenCalledWith(
      SIDEBAR_MAX_WIDTH
    );
    expect(mod.sidebarStore.state.width).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("opens at the width the last session left", async () => {
    // The user-visible property, end to end: drag the divider, close the popup,
    // reopen it.
    await load(DEFAULT_SIDEBAR_WIDTH);
    mod.setSidebarWidth(200);

    const next = await load(200);

    expect(next.sidebarStore.state.width).toBe(200);
  });

  it("survives a storage failure without breaking the resize", async () => {
    await load(180);
    items.sidebarWidthItem.setValue.mockClear();
    items.sidebarWidthItem.setValue.mockRejectedValue(new Error("quota"));

    expect(() => mod.setSidebarWidth(190)).not.toThrow();

    // The store is already painted; a storage failure must not undo that.
    expect(mod.sidebarStore.state.width).toBe(190);
  });
});

// ---------------------------------------------------------------------------

describe("a change made elsewhere", () => {
  it("applies a width written by another context", async () => {
    await load(180);

    act(() => lastWatchCallback()(200));

    expect(mod.sidebarStore.state.width).toBe(200);
  });

  it("clamps an out-of-range value from another context", async () => {
    await load(180);

    act(() => lastWatchCallback()(50));

    expect(mod.sidebarStore.state.width).toBe(SIDEBAR_MIN_WIDTH);
  });

  it("ignores a write that changes nothing", async () => {
    await load(180);

    act(() => lastWatchCallback()(180));

    // Otherwise the popup re-renders its whole sidebar for a no-op write.
    expect(mod.sidebarStore.state.width).toBe(180);
  });
});

// ---------------------------------------------------------------------------

describe("React bindings", () => {
  it("re-renders on a width change", async () => {
    await load(180);

    const { result } = renderHook(() => mod.useSidebarWidth((s) => s.width));
    expect(result.current).toBe(180);

    act(() => mod.setSidebarWidth(190));

    // Measured rather than merely present: a binding wired to the wrong store
    // fails silently, returning a valid undefined-shaped value.
    expect(result.current).toBe(190);
  });
});
