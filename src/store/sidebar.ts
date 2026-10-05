/**
 * The popup sidebar's width, as a store value with persistence.
 *
 * ── Why it is here ──────────────────────────────────────────────────────────
 *
 * The width was `useState` in `Dashboard.tsx`, so it reset every time the popup
 * closed — and a popup closes on every blur. Dragging the divider, then clicking
 * back into the page, lost the size. That is the case this module exists for.
 *
 * The bounds live here rather than in the component so the clamp is applied in one
 * place. They were `const`s inside the component, applied in three handlers, and
 * nothing stopped a stale stored value from exceeding them: a popup and the options
 * page are different documents reading the same key.
 */

import { createStore } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";

import {
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/config/constants";
import { sidebarWidthItem } from "@/storage/items";
import { effectOn } from "./effect";
import { captureError } from "@/lib/sentry";

/** Clamp a width into the range the resizer enforces. */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.min(SIDEBAR_MAX_WIDTH, Math.round(width))
  );
}

export type SidebarWidthState = {
  width: number;
  /**
   * Whether the stored width has been read.
   *
   * Separate from `width` for the same reason as the theme: persistence runs off
   * changes, so without this the store would write the default straight over a
   * saved value before the read landed.
   */
  isLoaded: boolean;
};

export const sidebarStore = createStore<SidebarWidthState>({
  width: DEFAULT_SIDEBAR_WIDTH,
  isLoaded: false,
});

async function loadSidebarWidth(): Promise<void> {
  try {
    const stored = await sidebarWidthItem.getValue();
    const width = clampSidebarWidth(stored);
    sidebarStore.setState(() => ({ width, isLoaded: true }));
    // Self-heal a value from outside the range: a hand edit, a restored backup, or
    // a build whose bounds were wider. Writing the clamp back means it stops being
    // re-clamped on every load.
    if (width !== stored) {
      sidebarWidthItem.setValue(width).catch(console.warn);
    }
  } catch (error) {
    // Keep the default but still mark loaded, or the persist effect below stays
    // inert for the rest of the session and the width silently stops being saved.
    captureError(error, { action: "sidebar.load" });
    sidebarStore.setState(() => ({
      width: DEFAULT_SIDEBAR_WIDTH,
      isLoaded: true,
    }));
  }
}

void loadSidebarWidth();

/** Set the width, clamped. The only way to change it. */
export function setSidebarWidth(width: number): void {
  sidebarStore.setState((prev) => ({
    ...prev,
    width: clampSidebarWidth(width),
  }));
}

/** Nudge by a step, for the arrow-key resize. */
export function nudgeSidebarWidth(step: number): void {
  sidebarStore.setState((prev) => ({
    ...prev,
    width: clampSidebarWidth(prev.width + step),
  }));
}

export function setSidebarWidthToMin(): void {
  setSidebarWidth(SIDEBAR_MIN_WIDTH);
}

export function setSidebarWidthToMax(): void {
  setSidebarWidth(SIDEBAR_MAX_WIDTH);
}

// ---------------------------------------------------------------------------
// Persist
// ---------------------------------------------------------------------------

/**
 * Write the width when it changes.
 *
 * **This was missing entirely** in the first version of this module. It loaded the
 * stored width, clamped a self-heal back into storage, and watched for changes made
 * elsewhere — but nothing ever wrote a user's resize. So the width appeared to work
 * while the popup was open and was forgotten the moment it closed, which is the
 * exact symptom this module was supposed to fix. A store with a watcher and no
 * writer reads as persistence and is not.
 *
 * Guarded on `isLoaded` for the same reason as the theme in `settings.ts`: without
 * it this runs once on registration and writes the default straight over a saved
 * value before the read lands.
 */
effectOn(sidebarStore, ["width", "isLoaded"], ({ width, isLoaded }) => {
  // `isLoaded` is the load-bearing guard, and the reason this is not just "write
  // on every change": the effect also runs once on registration, so without it
  // this would write the default straight over a saved value before the read
  // lands. Verified by the test that holds the read open.
  if (!isLoaded) return;
  // A storage failure must not stop the resize working — the store is already
  // painted. Warn and carry on, as the settings store does.
  sidebarWidthItem.setValue(width).catch(console.warn);
});

// A change made in another document. Deliberately not torn down — the store lives
// as long as the document does, and the document going away is what ends it.
sidebarWidthItem.watch((stored) => {
  const width = clampSidebarWidth(stored);
  if (width === sidebarStore.state.width) return;
  sidebarStore.setState((prev) => ({ ...prev, width }));
});

// ---------------------------------------------------------------------------
// React bindings
// ---------------------------------------------------------------------------

export function useSidebarWidth<T>(
  selector: (state: SidebarWidthState) => T
): T {
  return useStore(sidebarStore, selector);
}
