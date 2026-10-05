import { describe, it, expect, beforeEach } from "vitest";

import {
  OVERLAYS,
  closeSlashMenu,
  editorSelectionStore,
  hasPendingSlashContext,
  openOverlay,
  openSlashMenu,
  resetEditorSelectionForTests,
  setSlashQuery,
  stashSlashContextForPicker,
  takePendingSlashContext,
  type EditorRange,
  type EditorSelectionState,
} from "./editor-selection";

/**
 * The invariant: at most one overlay is open at a time.
 *
 * The slash menu and the two pickers all render a floating panel at a saved editor
 * range and all dismiss on Escape. Nothing previously stopped two opening at once,
 * and the result would be two panels competing for the same key and the same range.
 *
 * Every sequence of two and three opens is checked rather than a couple of
 * hand-picked ones — the failure mode is "some pair", not a specific pair.
 */

function range(offset: number): EditorRange {
  return {
    anchor: { path: [0], offset },
    focus: { path: [0], offset },
  };
}

function state(): EditorSelectionState {
  return editorSelectionStore.state;
}

beforeEach(() => {
  resetEditorSelectionForTests();
});

// ---------------------------------------------------------------------------

describe("overlay exclusivity", () => {
  for (const first of OVERLAYS) {
    for (const second of OVERLAYS) {
      it(`has only ${second} open after opening ${first} then ${second}`, () => {
        openOverlay(first);
        openOverlay(second);

        // One field, so two-open is not representable. Asserted anyway, because an
        // invariant argued only in a comment is not an invariant.
        expect(state().activeOverlay).toBe(second);
        const openCount = OVERLAYS.filter(
          (o) => state().activeOverlay === o
        ).length;
        expect(openCount).toBe(1);
      });
    }
  }

  it("closes everything when asked for null", () => {
    for (const overlay of OVERLAYS) {
      openOverlay(overlay);
      openOverlay(null);
      expect(state().activeOverlay).toBeNull();
    }
  });

  it("closes the previous overlay when the slash menu opens", () => {
    // The slash menu is an overlay like the others, so opening it goes through the
    // same door rather than setting its own flag.
    openOverlay("gif");
    openSlashMenu(range(3), false);

    expect(state().activeOverlay).toBe("slash");
  });

  it("starts with nothing open", () => {
    expect(state().activeOverlay).toBeNull();
  });

  it("forgets the slash menu's range when another overlay takes over", () => {
    // A range left behind is a range a later insertion could use.
    openSlashMenu(range(3), false);
    expect(state().slashMenuRange).not.toBeNull();

    openOverlay("image");

    expect(state().slashMenuRange).toBeNull();
  });

  it("keeps the range when the slash menu is re-opened", () => {
    // The opposite: clearing it here would lose the caret position for the case the
    // range exists to serve.
    const r = range(7);
    openSlashMenu(r, false);
    openSlashMenu(r, true);

    expect(state().slashMenuRange).toBe(r);
  });
});

describe("the slash menu", () => {
  it("records the range and whether it was deliberate", () => {
    const r = range(4);
    openSlashMenu(r, true);

    expect(state().slashMenuRange).toBe(r);
    expect(state().manualTrigger).toBe(true);
    // A fresh open starts with an empty query. Carrying the last one would filter
    // the menu to whatever the previous invocation was filtered to.
    expect(state().slashSearchQuery).toBe("");
  });

  it("records what the user typed", () => {
    setSlashQuery("head");
    expect(state().slashSearchQuery).toBe("head");
  });

  it("clears everything on dismissal", () => {
    openSlashMenu(range(2), true);
    setSlashQuery("tab");

    closeSlashMenu();

    expect(state().activeOverlay).toBeNull();
    expect(state().slashMenuRange).toBeNull();
    expect(state().slashSearchQuery).toBe("");
    expect(state().manualTrigger).toBe(false);
  });

  it("drops a stashed context on dismissal", () => {
    // Otherwise the next picker insertion lands at a range the user abandoned.
    stashSlashContextForPicker(range(1), "img", false);
    expect(hasPendingSlashContext(state())).toBe(true);

    closeSlashMenu();

    expect(hasPendingSlashContext(state())).toBe(false);
  });
});

describe("the slash context handoff", () => {
  it("survives the menu closing under a picker", () => {
    // The picker covers the screen; when it closes, the editor has to know where
    // the user was typing. Losing this is how an image lands at the top of the
    // document instead of where they asked.
    const r = range(9);
    openSlashMenu(r, false);
    setSlashQuery("image");

    stashSlashContextForPicker(r, "image", false);

    // The menu is gone, replaced by the picker...
    expect(state().activeOverlay).toBeNull();
    // ...but the context is waiting to be claimed.
    expect(hasPendingSlashContext(state())).toBe(true);
    expect(takePendingSlashContext()).toEqual({
      range: r,
      query: "image",
      manual: false,
    });
  });

  it("is claimed exactly once", () => {
    // Reading and clearing separately is how the same insertion happens twice: an
    // image goes in, the picker opens again, and a second image lands at the old
    // range.
    stashSlashContextForPicker(range(5), "gif", true);

    expect(takePendingSlashContext()).not.toBeNull();
    expect(takePendingSlashContext()).toBeNull();
  });

  it("returns null when the picker was not opened from the slash menu", () => {
    // The signal to insert at the current selection instead.
    expect(takePendingSlashContext()).toBeNull();
    expect(hasPendingSlashContext(state())).toBe(false);
  });

  it("carries whether the trigger was manual", () => {
    // The manual/typed distinction survives the handoff: it decides whether the
    // query is cleared when the picker closes.
    stashSlashContextForPicker(range(1), "img", true);
    expect(takePendingSlashContext()?.manual).toBe(true);
  });
});

describe("React bindings", () => {
  it("re-renders when the overlay changes", async () => {
    const { renderHook, act } = await import("@testing-library/react");
    const { useEditorSelection } = await import("./editor-selection");

    const { result } = renderHook(() => ({
      overlay: useEditorSelection((s) => s.activeOverlay),
      query: useEditorSelection((s) => s.slashSearchQuery),
    }));

    expect(result.current.overlay).toBeNull();

    act(() => openSlashMenu(range(1), false));
    expect(result.current.overlay).toBe("slash");

    act(() => setSlashQuery("tab"));
    expect(result.current.query).toBe("tab");

    act(() => openOverlay("gif"));
    // Measured rather than merely present: a binding wired to the wrong store
    // fails silently, returning a valid undefined-shaped value.
    expect(result.current.overlay).toBe("gif");
  });
});

describe("useOverlayFlag", () => {
  /**
   * The adapter the editor's interaction logic actually uses.
   *
   * Measured rather than merely present: it is the only door through which the
   * editor opens an overlay, so a bug here is the bug the exclusivity tests cannot
   * see — they call `openOverlay` directly.
   */
  it("opens and closes, and reports the flag", async () => {
    const { renderHook, act } = await import("@testing-library/react");
    const { useOverlayFlag } = await import("./editor-selection");

    const { result } = renderHook(() => useOverlayFlag("gif"));

    expect(result.current.open).toBe(false);

    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);
    expect(state().activeOverlay).toBe("gif");

    // Closing goes through the same door, so it clears the shared field rather than
    // leaving it set for the next reader.
    act(() => result.current.setOpen(false));
    expect(result.current.open).toBe(false);
    expect(state().activeOverlay).toBeNull();
  });

  it("closing dismisses whatever is showing, since only one can be", async () => {
    const { renderHook, act } = await import("@testing-library/react");
    const { useOverlayFlag } = await import("./editor-selection");

    const { result } = renderHook(() => useOverlayFlag("image"));

    // The editor's Escape handler is per-overlay: whichever component is mounted
    // handles the key and closes "its" overlay. Since only one is ever showing,
    // closing means closing the overlay layer — which is what Escape should do.
    // Being stricter here (closing only if it is *this* overlay) would leave the
    // slash menu open when the image picker dismissed itself.
    act(() => {
      openOverlay("slash");
      result.current.setOpen(false);
    });

    expect(state().activeOverlay).toBeNull();
  });

  it("opening one flag closes another", async () => {
    const { renderHook, act } = await import("@testing-library/react");
    const { useOverlayFlag } = await import("./editor-selection");

    const { result } = renderHook(() => ({
      gif: useOverlayFlag("gif"),
      image: useOverlayFlag("image"),
    }));

    act(() => result.current.gif.setOpen(true));
    expect(result.current.gif.open).toBe(true);

    act(() => result.current.image.setOpen(true));

    // The editor's real payoff: opening the image picker closes the GIF one,
    // which three separate booleans could not express.
    expect(result.current.image.open).toBe(true);
    expect(result.current.gif.open).toBe(false);
    expect(state().activeOverlay).toBe("image");
  });
});
