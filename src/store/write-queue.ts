/**
 * The popup side of the background-owned write queue.
 *
 * The popup only stages drafts and enqueues changes. Draining, rate limiting
 * and retries live in the background worker, because ADR 0011 says this popup
 * disappears on blur — a queue owned by the document would disappear with it.
 * Drafts and the queue are separate local-only keys so neither can affect the
 * content-script cache, search, counts, sync, export or import.
 */

import { Store } from "@tanstack/store";
import type { Snippet } from "@/types";
import { snippetRev } from "@/lib/lww";
import {
  draftFromForm,
  fieldsFromSnippet,
  validateEditorFields,
  type EditorDraft,
  type EditorFields,
} from "@/lib/snippet-draft";
import {
  clearRefused,
  emptyQueue,
  enqueue,
  queueSummary,
  type QueueState,
} from "@/lib/write-queue";
import {
  canRedo,
  canUndo,
  clearUndo,
  popRedo,
  popUndo,
  pushUndo,
  EMPTY_UNDO_STACKS,
} from "@/lib/undo-stack";
import {
  editorDraftsItem,
  undoStacksItem,
  writeQueueItem,
} from "@/storage/items";
import { getWriterId } from "@/storage/writer-id";

export type SyncStatus = {
  pending: number;
  failed: number;
  refused: number;
  lastError?: string;
};

export const writeQueueStore = new Store<SyncStatus>({
  pending: 0,
  failed: 0,
  refused: 0,
});

export const undoAvailabilityStore = new Store<{
  snippetId: string | null;
  canUndo: boolean;
  canRedo: boolean;
}>({ snippetId: null, canUndo: false, canRedo: false });

async function publishUndoAvailability(snippetId: string): Promise<void> {
  const stacks = (await undoStacksItem.getValue()) ?? EMPTY_UNDO_STACKS;
  undoAvailabilityStore.setState(() => ({
    snippetId,
    canUndo: canUndo(stacks, snippetId),
    canRedo: canRedo(stacks, snippetId),
  }));
}

async function readQueue(): Promise<QueueState> {
  return (await writeQueueItem.getValue()) ?? emptyQueue();
}

async function writeQueue(state: QueueState): Promise<void> {
  await writeQueueItem.setValue(state);
  publish(state);
}

function publish(state: QueueState): void {
  const summary = queueSummary(state);
  const lastError =
    [...state.operations].reverse().find((op) => op.error)?.error ?? undefined;
  writeQueueStore.setState((prev) => ({ ...prev, ...summary, lastError }));
}

/** Refresh the status shown in the top bar from the authoritative queue. */
export async function refreshSyncStatus(): Promise<void> {
  publish(await readQueue());
}

/** Save editor fields locally without committing them yet. */
export async function stageDraft(draft: EditorDraft): Promise<void> {
  const drafts = await editorDraftsItem.getValue();
  await editorDraftsItem.setValue({ ...drafts, [draft.id]: draft });
}

/**
 * Validate a draft and hand it to the background queue. An invalid or refused
 * draft stays in local storage; a queued draft is removed so the editor no
 * longer claims it is unsaved.
 */
export async function flushDraft(
  snippetId: string,
  stored: Snippet[],
  now = new Date().toISOString()
): Promise<{ ok: boolean; error?: string; isNew?: boolean }> {
  const drafts = await editorDraftsItem.getValue();
  const draft = drafts[snippetId];
  if (!draft) return { ok: true };

  const validation = validateEditorFields(
    draft.fields,
    stored,
    draft.isNew ? undefined : snippetId
  );
  if (!validation.ok) {
    return { ok: false, error: validation.problem, isNew: draft.isNew };
  }

  const writerId = await getWriterId();
  const state = await readQueue();
  const next = enqueue(
    state,
    {
      id: `op-${crypto.randomUUID()}`,
      snippetId,
      kind: "upsert",
      fields: draft.fields,
      baseRev: draft.baseRev,
      updatedAt: now,
      updatedBy: writerId,
      reason: "edit",
      createdAt: Date.now(),
    },
    Date.now()
  );
  await writeQueue(next);

  const remaining = { ...drafts };
  delete remaining[snippetId];
  await editorDraftsItem.setValue(remaining);
  return { ok: true, isNew: draft.isNew };
}

/** Start a provisional draft for a new snippet before its first commit. */
export async function stageNewSnippetDraft(
  form: Parameters<typeof draftFromForm>[1],
  now?: string
): Promise<EditorDraft> {
  const draft = draftFromForm(crypto.randomUUID(), form, now);
  await stageDraft(draft);
  return draft;
}

/**
 * Stage a new snippet with an id chosen by the caller.
 *
 * The create form keeps one provisional id for the whole session so autosave
 * cannot turn one new snippet into several, and the explicit Create button can
 * navigate to the same record it has been writing all along.
 */
export async function stageProvisionalDraft(
  id: string,
  form: Parameters<typeof draftFromForm>[1],
  now?: string
): Promise<EditorDraft> {
  const draft = draftFromForm(id, form, now);
  await stageDraft(draft);
  return draft;
}

/** Stage one debounced edit and remember the state it replaced. */
export async function stageEdit(
  snippet: Snippet,
  fields: EditorFields
): Promise<void> {
  await stageDraft({
    id: snippet.id,
    baseRev: snippetRev(snippet),
    fields,
    updatedAt: new Date().toISOString(),
    isNew: false,
  });
  const stacks = (await undoStacksItem.getValue()) ?? EMPTY_UNDO_STACKS;
  await undoStacksItem.setValue(
    pushUndo(stacks, snippet.id, fieldsFromSnippet(snippet))
  );
  await publishUndoAvailability(snippet.id);
}

/** Step back through the edits made in this install. */
export async function undoLastEdit(
  snippet: Snippet,
  currentFields: EditorFields
): Promise<{ ok: boolean; fields: EditorFields | null }> {
  const stacks = (await undoStacksItem.getValue()) ?? EMPTY_UNDO_STACKS;
  const { stacks: next, fields } = popUndo(stacks, snippet.id, currentFields);
  if (!fields) return { ok: false, fields: null };
  await undoStacksItem.setValue(next);
  await enqueueRestore(snippet, fields);
  // The restore itself records history, so undo needs no extra snapshot here.
  await publishUndoAvailability(snippet.id);
  return { ok: true, fields };
}

/** Reapply the state the user last stepped back from. */
export async function redoLastEdit(
  snippet: Snippet,
  currentFields: EditorFields
): Promise<{ ok: boolean; fields: EditorFields | null }> {
  const stacks = (await undoStacksItem.getValue()) ?? EMPTY_UNDO_STACKS;
  const { stacks: next, fields } = popRedo(stacks, snippet.id, currentFields);
  if (!fields) return { ok: false, fields: null };
  await undoStacksItem.setValue(next);
  await enqueueRestore(snippet, fields);
  await publishUndoAvailability(snippet.id);
  return { ok: true, fields };
}

/** Refresh the controls after the selected snippet changes. */
export async function refreshUndoAvailability(
  snippetId: string | null
): Promise<void> {
  if (!snippetId) {
    undoAvailabilityStore.setState(() => ({
      snippetId: null,
      canUndo: false,
      canRedo: false,
    }));
    return;
  }
  await publishUndoAvailability(snippetId);
}

/**
 * Drop an unflushed draft without touching the undo history.
 *
 * Undo has to be able to throw away a draft typed after the last commit and
 * still step back through the edits that were committed. `discardDraft` is for
 * abandoning a snippet entirely (Cancel, undo-delete), so it clears both.
 */
export async function discardUnflushedDraft(snippetId: string): Promise<void> {
  const drafts = await editorDraftsItem.getValue();
  if (drafts[snippetId]) {
    const remaining = { ...drafts };
    delete remaining[snippetId];
    await editorDraftsItem.setValue(remaining);
  }
  await writeQueue(clearRefused(await readQueue(), snippetId));
}

/** Abandon every trace of a snippet: its draft and its undo history. */
export async function discardDraft(snippetId: string): Promise<void> {
  await discardUnflushedDraft(snippetId);
  const stacks = (await undoStacksItem.getValue()) ?? EMPTY_UNDO_STACKS;
  await undoStacksItem.setValue(clearUndo(stacks, snippetId));
  await refreshUndoAvailability(snippetId);
}

/** Queue a delete through the same single entry point as an edit. */
export async function enqueueDelete(
  snippet: Snippet,
  now = new Date().toISOString()
): Promise<void> {
  const writerId = await getWriterId();
  await writeQueue(
    enqueue(
      await readQueue(),
      {
        id: `op-${crypto.randomUUID()}`,
        snippetId: snippet.id,
        kind: "delete",
        baseRev: snippetRev(snippet),
        updatedAt: now,
        updatedBy: writerId,
        reason: "delete",
        createdAt: Date.now(),
      },
      Date.now()
    )
  );
}

/**
 * Restore goes through the queue too, but is exempt from the stale-revision
 * check: the user explicitly chose an older snapshot over the current record.
 */
export async function enqueueRestore(
  snippet: Snippet,
  fields: EditorFields,
  now = new Date().toISOString()
): Promise<void> {
  const writerId = await getWriterId();
  await writeQueue(
    enqueue(
      await readQueue(),
      {
        id: `op-${crypto.randomUUID()}`,
        snippetId: snippet.id,
        kind: "upsert",
        fields,
        baseRev: snippetRev(snippet),
        updatedAt: now,
        updatedBy: writerId,
        reason: "restore",
        createdAt: Date.now(),
      },
      Date.now()
    )
  );
}

if (typeof browser !== "undefined" && browser.storage?.onChanged) {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.writeQueue) {
      void refreshSyncStatus();
    }
  });
}
