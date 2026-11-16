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
import { sidebarOpenItem, sidebarWidthItem } from "@/storage/items";
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
   * Whether the sidebar is expanded.
   *
   * Persisted, because it was `useState` in the component and therefore reset to
   * expanded on every popup open — so a user who had collapsed the sidebar to give
   * the detail pane room had to collapse it again every single time. That is the
   * kind of setting that looks like it works, because it does, right up until you
   * close the popup.
   */
  isOpen: boolean;
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
  isOpen: true,
  isLoaded: false,
});

async function loadSidebarWidth(): Promise<void> {
  try {
    const [stored, isOpen] = await Promise.all([
      sidebarWidthItem.getValue(),
      sidebarOpenItem.getValue(),
    ]);
    const width = clampSidebarWidth(stored);
    sidebarStore.setState(() => ({ width, isOpen, isLoaded: true }));
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
      isOpen: true,
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

/**
 * Expand or collapse the sidebar.
 *
 * Written straight through rather than debounced: a toggle is one discrete click,
 * and a quarter-second delay on a button press reads as lag.
 */
export function setSidebarOpen(isOpen: boolean): void {
  sidebarStore.setState((prev) => ({ ...prev, isOpen }));
  persistNow(isOpen);
}

export function toggleSidebar(): void {
  setSidebarOpen(!sidebarStore.state.isOpen);
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

/** How long the width must be still before it is written. */
const PERSIST_DEBOUNCE_MS = 250;

/**
 * Write the width once the user stops moving the divider.
 *
 * ── Why debounced, and not on every change ─────────────────────────────────
 *
 * The first version wrote on every change. A drag emits a `pointermove` per pixel,
 * so that was a `storage.local` round trip per pixel — which is what made the
 * resize look unstable: the popup was doing a hundred writes a second while the
 * user dragged, and the sidebar visibly stuttered.
 *
 * The *render* must still be immediate — the store updates on every move, which is
 * what makes the sidebar track the pointer. Only the write is deferred. The options
 * page sidebar does not have this problem because it never persisted during a drag.
 *
 * **This was also missing entirely** in the first version, which loaded the stored
 * width, clamped a self-heal back into storage, and watched for changes made
 * elsewhere — but never wrote a user's resize. So the width appeared to work while
 * the popup was open and was forgotten the moment it closed. A store with a
 * watcher and no writer reads as persistence and is not.
 */
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(width: number): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    // A storage failure must not stop the resize working — the store is already
    // painted. Warn and carry on, as the settings store does.
    sidebarWidthItem.setValue(width).catch(console.warn);
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * The same writer, used for the boolean below.
 *
 * Separate from the width's because a boolean is set once per click: debouncing it
 * would delay the write by a quarter second for no benefit, and sharing one timer
 * would let a drag swallow a toggle.
 */
function persistNow(isOpen: boolean): void {
  sidebarOpenItem.setValue(isOpen).catch(console.warn);
}

effectOn(sidebarStore, ["width", "isLoaded"], ({ width, isLoaded }) => {
  // `isLoaded` is the load-bearing guard, and the reason this is not just "write
  // on every change": the effect also runs once on registration, so without it
  // this would write the default straight over a saved value before the read
  // lands. Verified by the test that holds the read open.
  if (!isLoaded) return;
  schedulePersist(width);
});

// A change made in another document. Deliberately not torn down — the store lives
// as long as the document does, and the document going away is what ends it.
sidebarWidthItem.watch((stored) => {
  const width = clampSidebarWidth(stored);
  if (width === sidebarStore.state.width) return;
  sidebarStore.setState((prev) => ({ ...prev, width }));
});

sidebarOpenItem.watch((stored) => {
  if (stored === sidebarStore.state.isOpen) return;
  sidebarStore.setState((prev) => ({ ...prev, isOpen: stored }));
});

// ---------------------------------------------------------------------------
// React bindings
// ---------------------------------------------------------------------------

export function useSidebarWidth<T>(
  selector: (state: SidebarWidthState) => T
): T {
  return useStore(sidebarStore, selector);
}
