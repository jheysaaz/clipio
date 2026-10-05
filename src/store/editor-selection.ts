/**
 * The editor's overlay state, and the caret context behind it.
 *
 * ── Why one store ───────────────────────────────────────────────────────────
 *
 * The editor held nine slices across two concerns: the slash command menu, and the
 * three media pickers. Split into this file and `editor-media.ts`, which is
 * imported *by* this one — so the direction of the dependency is "the thing that
 * knows about all three overlays owns them", rather than each knowing about the
 * others.
 *
 * ── The invariant ───────────────────────────────────────────────────────────
 *
 * **At most one overlay is open at a time.** The slash menu and the pickers all
 * render a floating element positioned at a saved editor range, and all dismiss on
 * Escape. Nothing previously stopped the GIF picker opening while the image picker
 * was open; the result would be two panels competing for the same key and the same
 * range.
 *
 * Enforced structurally rather than by convention: `activeOverlay` is a single
 * field and `openOverlay` is the only way to change it, so "two are open" is not
 * representable. `overlay-exclusivity.test.ts` asserts it over every sequence,
 * because an invariant that is only argued in a comment is not an invariant.
 *
 * The ranges are Slate `TRange` values — plain data. So this store holds no DOM
 * and no editor instance, and its tests need no renderer.
 */

import { createStore } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";

/**
 * A Slate range.
 *
 * Typed structurally rather than imported from `platejs`, so this module and its
 * tests do not pull the editor in.
 */
export type EditorRange = {
  anchor: { path: number[]; offset: number };
  focus: { path: number[]; offset: number };
};

/** Which overlay is showing. `null` is the common case and the only safe default. */
export type Overlay = "slash" | "gif" | "image" | null;

/** Every overlay, so a test can assert the invariant across all of them. */
export const OVERLAYS: readonly Exclude<Overlay, null>[] = [
  "slash",
  "gif",
  "image",
];

export type EditorSelectionState = {
  /**
   * The one overlay showing, or `null`.
   *
   * Single field rather than three booleans precisely so two overlays being open
   * cannot be represented.
   */
  activeOverlay: Overlay;
  /** Where the slash menu was opened, and where a picker inserts. */
  slashMenuRange: EditorRange | null;
  /** What the user has typed after the `/`. */
  slashSearchQuery: string;
  /**
   * Whether the menu was opened deliberately rather than by typing `/`.
   *
   * Distinct because the two have different lifetimes: a typed `/` should close the
   * menu when the slash is deleted, an explicitly opened one should not.
   */
  manualTrigger: boolean;
  /**
   * The slash context held while a picker is open on top of it.
   *
   * The picker covers the screen; when it closes, the editor has to put the caret
   * back where the user left it and clear the query. Losing this is how an image
   * lands at the top of the document instead of where the user was typing.
   */
  pendingSlashContext: {
    range: EditorRange | null;
    query: string;
    manual: boolean;
  } | null;
};

const INITIAL: EditorSelectionState = {
  activeOverlay: null,
  slashMenuRange: null,
  slashSearchQuery: "",
  manualTrigger: false,
  pendingSlashContext: null,
};

export const editorSelectionStore = createStore<EditorSelectionState>({
  ...INITIAL,
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Open an overlay, closing whichever was open.
 *
 * Opening is one setter rather than three booleans, so exclusivity holds by
 * construction. Passing `null` closes.
 */
export function openOverlay(overlay: Overlay): void {
  editorSelectionStore.setState((prev) => ({
    ...prev,
    activeOverlay: overlay,
    // The slash menu's own state only means anything while it is the overlay.
    ...(overlay === "slash" ? {} : { slashMenuRange: null }),
  }));
}

/** Open the slash menu at a range, and say whether it was deliberate. */
export function openSlashMenu(
  range: EditorRange | null,
  manual: boolean
): void {
  editorSelectionStore.setState((prev) => ({
    ...prev,
    activeOverlay: "slash",
    slashMenuRange: range,
    manualTrigger: manual,
    slashSearchQuery: "",
  }));
}

/** Record what the user has typed after the `/`. */
export function setSlashQuery(query: string): void {
  editorSelectionStore.setState((prev) => ({
    ...prev,
    slashSearchQuery: query,
  }));
}

/**
 * Close the slash menu outright.
 *
 * For dismissal with nothing to hand on. Choosing an item goes through
 * `takePendingSlashContext`, which keeps the range and query.
 */
export function closeSlashMenu(): void {
  editorSelectionStore.setState((prev) => ({
    ...prev,
    activeOverlay: null,
    slashMenuRange: null,
    slashSearchQuery: "",
    manualTrigger: false,
    pendingSlashContext: null,
  }));
}

/**
 * Hand the slash context to a picker that is opening over it.
 *
 * The slash menu closes and the context survives, so the picker knows where to
 * insert and what to clear.
 */
export function stashSlashContextForPicker(
  range: EditorRange | null,
  query: string,
  manual: boolean
): void {
  editorSelectionStore.setState((prev) => ({
    ...prev,
    activeOverlay: null,
    pendingSlashContext: { range, query, manual },
  }));
}

/**
 * Read the stash and clear it, in one call.
 *
 * Combined because reading and clearing separately is how the context gets
 * applied twice: an image is inserted, the user opens the picker again, and a
 * second image lands at the old range.
 *
 * `null` means the picker was not opened from the slash menu — the signal to
 * insert at the current selection instead.
 */
export function takePendingSlashContext(): EditorSelectionState["pendingSlashContext"] {
  const context = editorSelectionStore.state.pendingSlashContext;
  if (context) {
    editorSelectionStore.setState((prev) => ({
      ...prev,
      pendingSlashContext: null,
    }));
  }
  return context;
}

/** Whether a slash context is waiting to be claimed. */
export function hasPendingSlashContext(state: EditorSelectionState): boolean {
  return state.pendingSlashContext !== null;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * `useState`-shaped access to one overlay's visibility.
 *
 * The editor's interaction logic opens and closes overlays from about a dozen
 * places, and rewriting every call site to the store's vocabulary would be a large
 * diff through code that is mostly about Plate and not about this state. This
 * keeps the call sites unchanged and still makes the state real: every write goes
 * through `openOverlay`, so opening the GIF picker *does* close the image picker.
 *
 * That is the point. With three `useState` booleans the invariant was unenforceable
 * — nothing stopped two overlays opening — and with an adapter it holds by
 * construction while the diff stays small enough to review.
 */

// ---------------------------------------------------------------------------
// Test seam
// ---------------------------------------------------------------------------

export function resetEditorSelectionForTests(): void {
  editorSelectionStore.setState(() => ({ ...INITIAL }));
}

// ---------------------------------------------------------------------------
// React bindings
// ---------------------------------------------------------------------------

export function useEditorSelection<T>(
  selector: (state: EditorSelectionState) => T
): T {
  return useStore(editorSelectionStore, selector);
}

/**
 * `useState`-shaped access to one overlay's visibility.
 *
 * The editor's interaction logic opens and closes overlays from about a dozen
 * places, and rewriting every call site to the store's vocabulary would be a large
 * diff through code that is mostly about Plate and not about this state. This
 * keeps the call sites unchanged and still makes the state real: every write goes
 * through `openOverlay`, so opening the GIF picker *does* close the image picker.
 *
 * That is the point. With three `useState` booleans the invariant was unenforceable
 * — nothing stopped two overlays opening — and with an adapter it holds by
 * construction while the diff stays small enough to review.
 */
export function useOverlayFlag(overlay: Exclude<Overlay, null>): {
  open: boolean;
  setOpen: (open: boolean) => void;
} {
  const isOpen = useEditorSelection((s) => s.activeOverlay === overlay);
  return {
    open: isOpen,
    setOpen: (next: boolean) => openOverlay(next ? overlay : null),
  };
}
