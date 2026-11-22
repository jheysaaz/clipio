/**
 * Local-only undo/redo stacks for the popup editor.
 *
 * Version history answers "what did this snippet look like before?"; the stacks
 * answer "what did the user just ask me to step back to?". Keeping both avoids
 * guessing a redo target from a chronological list of snapshots — the newest
 * snapshot is not necessarily the state the user just undid.
 *
 * The stacks hold editor fields rather than whole snippets so an undo cannot
 * resurrect a stale `rev`, `usageCount` or `createdAt`. The queue's restore path
 * applies the fields to the record as it exists at commit time.
 */

import type { EditorFields } from "./snippet-draft";

export type UndoStacks = Record<
  string,
  { past: EditorFields[]; future: EditorFields[] }
>;

export const EMPTY_UNDO_STACKS: UndoStacks = {};

/** Maximum steps kept per snippet. Beyond this, history is the longer memory. */
export const UNDO_LIMIT = 50;

function entryOf(stacks: UndoStacks, id: string) {
  return stacks[id] ?? { past: [], future: [] };
}

function withEntry(
  stacks: UndoStacks,
  id: string,
  value: { past: EditorFields[]; future: EditorFields[] }
): UndoStacks {
  return { ...stacks, [id]: value };
}

/** Record the state being replaced before a new edit is staged. */
export function pushUndo(
  stacks: UndoStacks,
  id: string,
  before: EditorFields
): UndoStacks {
  const current = entryOf(stacks, id);
  // A redo branch is invalid once the user edits again. Keeping it would let an
  // undo jump back onto a state that no longer follows the current one.
  const past = [...current.past, before].slice(-UNDO_LIMIT);
  return withEntry(stacks, id, { past, future: [] });
}

/**
 * Step back one edit, returning the state to restore.
 *
 * `current` is the state on screen; it is what a later redo must return to.
 * Without it both undo and redo would restore the same old snapshot.
 */
export function popUndo(
  stacks: UndoStacks,
  id: string,
  current: EditorFields
): { stacks: UndoStacks; fields: EditorFields | null } {
  const entry = entryOf(stacks, id);
  if (entry.past.length === 0) return { stacks, fields: null };
  const past = entry.past.slice();
  const fields = past.pop()!;
  return {
    stacks: withEntry(stacks, id, {
      past,
      future: [...entry.future, current],
    }),
    fields,
  };
}

/** Step forward one edit, returning the state to restore. */
export function popRedo(
  stacks: UndoStacks,
  id: string,
  current: EditorFields
): { stacks: UndoStacks; fields: EditorFields | null } {
  const entry = entryOf(stacks, id);
  if (entry.future.length === 0) return { stacks, fields: null };
  const future = entry.future.slice();
  const fields = future.pop()!;
  return {
    stacks: withEntry(stacks, id, {
      past: [...entry.past, current].slice(-UNDO_LIMIT),
      future,
    }),
    fields,
  };
}

export function canUndo(stacks: UndoStacks, id: string): boolean {
  return entryOf(stacks, id).past.length > 0;
}

export function canRedo(stacks: UndoStacks, id: string): boolean {
  return entryOf(stacks, id).future.length > 0;
}

/** Drop all state for a snippet whose draft was discarded. */
export function clearUndo(stacks: UndoStacks, id: string): UndoStacks {
  const next = { ...stacks };
  delete next[id];
  return next;
}
