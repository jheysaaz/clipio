/**
 * The editor's media side: picker ranges and the image-upload error.
 *
 * ── Why the visibility lives elsewhere ───────────────────────────────────────
 *
 * `activeOverlay` is in `editor-selection.ts`, because the exclusivity rule spans
 * the slash menu and both pickers and can only be enforced where all three are
 * visible. This file owns what the pickers need and nothing else: where to insert,
 * and what went wrong.
 *
 * So the ranges here are *not* a second source of truth for what is open — they are
 * where the open picker inserts. A range with no picker open is simply unused, and
 * `takePickerRange` clears as it reads for the same reason
 * `takePendingSlashContext` does: reading and clearing separately is how the same
 * insertion happens twice.
 */

import { createStore } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";

import {
  openOverlay,
  takePendingSlashContext,
  type EditorRange,
  type EditorSelectionState,
} from "./editor-selection";

/** Which picker a range belongs to. */
export type MediaPicker = "gif" | "image";

export type EditorMediaState = {
  /** Where the open picker inserts. `null` when nothing is open. */
  gifPickerRange: EditorRange | null;
  imagePickerRange: EditorRange | null;
  /**
   * Why the last upload failed, or `null`.
   *
   * Keyed by nothing because there is one upload at a time — the picker inserts
   * one image, so one message is enough.
   */
  imageUploadError: string | null;
};

export const editorMediaStore = createStore<EditorMediaState>({
  gifPickerRange: null,
  imagePickerRange: null,
  imageUploadError: null,
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Open a picker to insert at a range. */
export function openMediaPicker(
  picker: MediaPicker,
  range: EditorRange | null
): void {
  // The overlay field belongs to the selection store; this is the only way to
  // change it from here, so the exclusivity rule cannot be bypassed.
  openOverlay(picker);
  editorMediaStore.setState((prev) => ({
    ...prev,
    ...(picker === "gif"
      ? { gifPickerRange: range }
      : { imagePickerRange: range }),
  }));
}

/** Close whichever picker is open, and forget its range. */
export function closeMediaPicker(picker: MediaPicker): void {
  openOverlay(null);
  editorMediaStore.setState((prev) => ({
    ...prev,
    ...(picker === "gif"
      ? { gifPickerRange: null }
      : { imagePickerRange: null }),
  }));
}

/**
 * Read the range to insert at, and clear it.
 *
 * Cleared on read so a second insert cannot reuse a stale range.
 */
export function takePickerRange(picker: MediaPicker): EditorRange | null {
  const range =
    editorMediaStore.state[
      picker === "gif" ? "gifPickerRange" : "imagePickerRange"
    ];
  closeMediaPicker(picker);
  return range;
}

export function setImageUploadError(message: string | null): void {
  editorMediaStore.setState((prev) => ({
    ...prev,
    imageUploadError: message,
  }));
}

/** Clear the upload error. Separate from setting it, so it is dismissible. */
export function dismissImageUploadError(): void {
  setImageUploadError(null);
}

// ---------------------------------------------------------------------------
// Derived
// ---------------------------------------------------------------------------

/**
 * Where a picker insertion should land — and consume both candidate ranges.
 *
 * Prefers the slash context when there is one, because the picker was opened *from*
 * the slash menu and the user's caret has since moved: the range captured when they
 * typed `/` is the one they meant, whereas the picker's own range is wherever they
 * clicked to open it. Falls back to the picker's range, then to `null` for "use the
 * current selection".
 *
 * **Both** are consumed, whichever wins. An earlier version returned the pending
 * context and left the picker's range in place, so a later insertion with no slash
 * context reused a range from an earlier one — the same class of bug
 * `takePendingSlashContext` exists to prevent, one level down. Consuming the
 * picker's range also closes the picker, which is what an insertion should do.
 *
 * Reads the stores rather than being handed a snapshot, because it has to *write*
 * to both to consume them. The first parameter is retained so the call site reads
 * as "resolve against this editor's state" and so the store dependency stays
 * visible; the stores are module singletons, so it is not read.
 */
export function resolveInsertionRange(
  _selectionState: EditorSelectionState,
  picker: MediaPicker
): EditorRange | null {
  const pending = takePendingSlashContext();
  const own = takePickerRange(picker);
  return pending ? pending.range : own;
}

// ---------------------------------------------------------------------------
// Test seam
// ---------------------------------------------------------------------------

export function resetEditorMediaForTests(): void {
  editorMediaStore.setState(() => ({
    gifPickerRange: null,
    imagePickerRange: null,
    imageUploadError: null,
  }));
}

// ---------------------------------------------------------------------------
// React bindings
// ---------------------------------------------------------------------------

export function useEditorMedia<T>(selector: (state: EditorMediaState) => T): T {
  return useStore(editorMediaStore, selector);
}
