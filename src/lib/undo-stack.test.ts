import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  clearUndo,
  EMPTY_UNDO_STACKS,
  popRedo,
  popUndo,
  pushUndo,
  UNDO_LIMIT,
  type UndoStacks,
} from "./undo-stack";
import type { EditorFields } from "./snippet-draft";

const fields = (label: string): EditorFields => ({
  label,
  shortcut: `/${label}`,
  content: label,
  tags: [],
});

describe("undo-stack", () => {
  it("has nothing to undo or redo on an empty stack", () => {
    expect(canUndo(EMPTY_UNDO_STACKS, "s1")).toBe(false);
    expect(canRedo(EMPTY_UNDO_STACKS, "s1")).toBe(false);
    expect(popUndo(EMPTY_UNDO_STACKS, "s1", fields("now")).fields).toBeNull();
    expect(popRedo(EMPTY_UNDO_STACKS, "s1", fields("now")).fields).toBeNull();
  });

  it("returns the state before the last edit and makes it redoable", () => {
    const once = pushUndo(EMPTY_UNDO_STACKS, "s1", fields("before"));
    const twice = pushUndo(once, "s1", fields("middle"));

    expect(canUndo(twice, "s1")).toBe(true);
    const undone = popUndo(twice, "s1", fields("now"));
    expect(undone.fields).toEqual(fields("middle"));
    expect(undone.stacks).not.toBe(twice);
    expect(canRedo(undone.stacks, "s1")).toBe(true);
  });

  it("restores a redo exactly once", () => {
    const staged = pushUndo(EMPTY_UNDO_STACKS, "s1", fields("old"));
    const undone = popUndo(staged, "s1", fields("now"));
    const redone = popRedo(undone.stacks, "s1", fields("old"));

    expect(redone.fields).toEqual(fields("now"));
    expect(canRedo(redone.stacks, "s1")).toBe(false);
  });

  it("drops the redo branch when a new edit is staged", () => {
    const staged = pushUndo(EMPTY_UNDO_STACKS, "s1", fields("old"));
    const undone = popUndo(staged, "s1", fields("now"));
    expect(canRedo(undone.stacks, "s1")).toBe(true);

    const branched = pushUndo(undone.stacks, "s1", fields("new"));

    // A stale redo would jump onto a state that no longer follows the edit.
    expect(canRedo(branched, "s1")).toBe(false);
    expect(popRedo(branched, "s1", fields("new")).fields).toBeNull();
  });

  it("keeps snippets independent", () => {
    const stacks = pushUndo(
      pushUndo(EMPTY_UNDO_STACKS, "s1", fields("one")),
      "s2",
      fields("two")
    );

    expect(popUndo(stacks, "s1", fields("x")).fields).toEqual(fields("one"));
    expect(popUndo(stacks, "s2", fields("x")).fields).toEqual(fields("two"));
  });

  it("caps the undo stack without losing the most recent step", () => {
    let stacks: UndoStacks = EMPTY_UNDO_STACKS;
    for (let i = 0; i < UNDO_LIMIT + 10; i += 1) {
      stacks = pushUndo(stacks, "s1", fields(`v${i}`));
    }

    expect(stacks.s1.past).toHaveLength(UNDO_LIMIT);
    expect(popUndo(stacks, "s1", fields("x")).fields).toEqual(
      fields(`v${UNDO_LIMIT + 9}`)
    );
  });

  it("clears one snippet without touching the others", () => {
    const stacks = pushUndo(
      pushUndo(EMPTY_UNDO_STACKS, "s1", fields("one")),
      "s2",
      fields("two")
    );

    const cleared = clearUndo(stacks, "s1");

    expect(canUndo(cleared, "s1")).toBe(false);
    expect(canUndo(cleared, "s2")).toBe(true);
  });
});
