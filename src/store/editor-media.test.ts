import { describe, it, expect, beforeEach } from "vitest";

import {
  closeMediaPicker,
  dismissImageUploadError,
  editorMediaStore,
  openMediaPicker,
  resetEditorMediaForTests,
  resolveInsertionRange,
  setImageUploadError,
  takePickerRange,
  type EditorMediaState,
} from "./editor-media";

import {
  editorSelectionStore,
  hasPendingSlashContext,
  openOverlay,
  resetEditorSelectionForTests,
  stashSlashContextForPicker,
  takePendingSlashContext,
  type EditorRange,
} from "./editor-selection";

function range(offset: number): EditorRange {
  return {
    anchor: { path: [0], offset },
    focus: { path: [0], offset },
  };
}

function media(): EditorMediaState {
  return editorMediaStore.state;
}

beforeEach(() => {
  resetEditorMediaForTests();
  resetEditorSelectionForTests();
});

// ---------------------------------------------------------------------------

describe("opening a picker", () => {
  it("records where to insert", () => {
    const r = range(4);
    openMediaPicker("image", r);

    expect(media().imagePickerRange).toBe(r);
    expect(editorSelectionStore.state.activeOverlay).toBe("image");
  });

  it("keeps the pickers' ranges separate", () => {
    openMediaPicker("gif", range(1));
    openMediaPicker("image", range(2));

    expect(media().gifPickerRange).toEqual(range(1));
    expect(media().imagePickerRange).toEqual(range(2));
  });

  it("accepts a null range", () => {
    // Opened from a click with no captured selection: insert at the current one.
    openMediaPicker("gif", null);

    expect(media().gifPickerRange).toBeNull();
    expect(editorSelectionStore.state.activeOverlay).toBe("gif");
  });

  it("forgets only the picker's own range when it closes", () => {
    openMediaPicker("gif", range(1));
    openMediaPicker("image", range(2));

    closeMediaPicker("image");

    // The GIF range is untouched. Both pickers can hold a range; only the open one
    // is used, and clearing the other would lose a range the user may still return
    // to.
    expect(media().imagePickerRange).toBeNull();
    expect(media().gifPickerRange).toEqual(range(1));
  });

  it("closes the overlay", () => {
    openMediaPicker("image", range(1));
    closeMediaPicker("image");
    expect(editorSelectionStore.state.activeOverlay).toBeNull();
  });
});

describe("taking a range", () => {
  it("returns it and forgets it", () => {
    openMediaPicker("gif", range(6));

    // Cleared on read, so a second insert cannot reuse a stale range.
    expect(takePickerRange("gif")).toEqual(range(6));
    expect(media().gifPickerRange).toBeNull();
  });

  it("returns null the second time", () => {
    openMediaPicker("gif", range(6));

    expect(takePickerRange("gif")).not.toBeNull();
    expect(takePickerRange("gif")).toBeNull();
  });

  it("returns null when no picker was open", () => {
    expect(takePickerRange("image")).toBeNull();
  });
});

describe("the upload error", () => {
  it("records and dismisses", () => {
    setImageUploadError("That file is not an image.");
    expect(media().imageUploadError).toBe("That file is not an image.");

    dismissImageUploadError();
    expect(media().imageUploadError).toBeNull();
  });

  it("is dismissible separately from being set", () => {
    // So the message is a thing the user can close, not only a thing that gets
    // overwritten by the next attempt.
    setImageUploadError("first");
    setImageUploadError("second");

    expect(media().imageUploadError).toBe("second");
    dismissImageUploadError();
    expect(media().imageUploadError).toBeNull();
  });
});

describe("resolveInsertionRange", () => {
  it("prefers the slash context when the picker came from the slash menu", () => {
    // The user's caret has moved since they typed `/` — the range captured then is
    // the one they meant. Using the picker's range instead would insert at a
    // selection the picker opened with, which for a click is wherever they clicked.
    stashSlashContextForPicker(range(9), "image", false);
    openMediaPicker("image", range(0));

    expect(resolveInsertionRange(editorSelectionStore.state, "image")).toEqual(
      range(9)
    );
  });

  it("falls back to the picker's range with no slash context", () => {
    openMediaPicker("image", range(3));

    expect(resolveInsertionRange(editorSelectionStore.state, "image")).toEqual(
      range(3)
    );
  });

  it("returns null when there is neither, for the current selection", () => {
    openMediaPicker("gif", null);

    expect(resolveInsertionRange(editorSelectionStore.state, "gif")).toBeNull();
  });

  it("consumes both sources, so neither can be reused", () => {
    // A range left behind is a range a later, unrelated insertion would use.
    stashSlashContextForPicker(range(9), "image", false);
    openMediaPicker("image", range(3));

    resolveInsertionRange(editorSelectionStore.state, "image");

    expect(hasPendingSlashContext(editorSelectionStore.state)).toBe(false);
    expect(takePickerRange("image")).toBeNull();
  });

  it("picks the right picker's range", () => {
    openMediaPicker("gif", range(1));
    openMediaPicker("image", range(2));
    editorSelectionStore.setState((prev) => ({
      ...prev,
      activeOverlay: "image",
    }));

    expect(resolveInsertionRange(editorSelectionStore.state, "image")).toEqual(
      range(2)
    );
  });
});

describe("the two stores together", () => {
  it("keeps the overlay exclusive across a slash menu and both pickers", () => {
    openOverlay("slash");
    openMediaPicker("gif", range(1));
    expect(editorSelectionStore.state.activeOverlay).toBe("gif");

    openMediaPicker("image", range(2));
    expect(editorSelectionStore.state.activeOverlay).toBe("image");

    closeMediaPicker("image");
    expect(editorSelectionStore.state.activeOverlay).toBeNull();
  });

  it("does not let a picker clear a slash context it did not open", () => {
    // The context belongs to the selection store; closing a picker touches only the
    // overlay and the picker's own range.
    stashSlashContextForPicker(range(1), "gif", false);
    openMediaPicker("gif", range(1));

    closeMediaPicker("gif");

    expect(hasPendingSlashContext(editorSelectionStore.state)).toBe(true);
    expect(takePendingSlashContext()?.range).toEqual(range(1));
  });
});

describe("React bindings", () => {
  it("re-renders when a range changes", async () => {
    const { renderHook, act } = await import("@testing-library/react");
    const { useEditorMedia } = await import("./editor-media");

    const { result } = renderHook(() => ({
      error: useEditorMedia((s) => s.imageUploadError),
      range: useEditorMedia((s) => s.imagePickerRange),
    }));

    expect(result.current.error).toBeNull();
    expect(result.current.range).toBeNull();

    act(() => setImageUploadError("too big"));
    expect(result.current.error).toBe("too big");

    act(() => openMediaPicker("image", range(2)));
    expect(result.current.range).toEqual(range(2));
  });
});
