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
  type QueuedChange,
  type QueueState,
} from "@/lib/write-queue";
import { withQueueLock } from "@/storage/queue-lock";
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
  /** A draft is staged locally and has not been committed yet. */
  saving: boolean;
};

export const writeQueueStore = new Store<SyncStatus>({
  pending: 0,
  failed: 0,
  refused: 0,
  saving: false,
});

export type QueueOutcome = {
  opId: string;
  snippetId: string;
  status: "failed" | "refused";
  error?: string;
};

/**
 * Terminal outcomes keyed by snippet id, for per-snippet UI recovery.
 *
 * `writeQueueStore` answers "are writes landing?"; it cannot answer "which
 * record failed and why" without shadowing the queue's own state. Keeping the
 * outcome here lets the detail pane show the error for the record on screen and
 * lets the dashboard wait for a create/delete to actually commit.
 */
export const queueOutcomesStore = new Store<Record<string, QueueOutcome>>({});

/** Live queue operations keyed by id, for observing commit progress. */
export const queueOperationsStore = new Store<Record<string, QueuedChange>>({});

/** The fields our own last commit wrote, keyed by snippet id. */
const committedFieldsStore = new Store<Record<string, EditorFields>>({});

/**
 * The fields of drafts staged in this document, keyed by snippet id.
 *
 * The authoritative store deliberately ignores our own commits (see
 * `src/store/snippets.ts`), so a snippet's `content` there stays at the value the
 * popup loaded until an external writer changes it. The sidebar needs what the
 * user is typing *now*, which is exactly the staged draft.
 */
export const draftPreviewsStore = new Store<Record<string, EditorFields>>({});

function setDraftPreview(snippetId: string, fields: EditorFields): void {
  draftPreviewsStore.setState((prev) => ({ ...prev, [snippetId]: fields }));
}

function removeDraftPreview(snippetId: string): void {
  draftPreviewsStore.setState((prev) => {
    if (!(snippetId in prev)) return prev;
    const next = { ...prev };
    delete next[snippetId];
    return next;
  });
}

/** Forget previews after an authoritative re-read replaces the library. */
export function clearDraftPreviews(): void {
  draftPreviewsStore.setState(() => ({}));
}

/** Remember the fields our own commit wrote, for the next edit's undo target. */
export function rememberCommittedFields(
  snippetId: string,
  fields: EditorFields
): void {
  committedFieldsStore.setState((prev) => ({
    ...prev,
    [snippetId]: {
      ...fields,
      tags: [...(fields.tags ?? [])],
    },
  }));
}

/** Forget committed fields after a refresh or an abandoned snippet. */
export function clearCommittedFields(snippetId?: string): void {
  committedFieldsStore.setState((prev) => {
    if (!snippetId) return {};
    if (!(snippetId in prev)) return prev;
    const next = { ...prev };
    delete next[snippetId];
    return next;
  });
}

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

let cachedQueue: QueueState = emptyQueue();
const stagedDraftIds = new Set<string>();

async function readQueue(): Promise<QueueState> {
  cachedQueue = (await writeQueueItem.getValue()) ?? emptyQueue();
  return cachedQueue;
}

async function writeQueue(state: QueueState): Promise<void> {
  cachedQueue = state;
  await writeQueueItem.setValue(state);
  publish();
}

/**
 * Mutate the queue under the cross-context lock.
 *
 * The read and the write must be one transaction: with a bare read/write pair,
 * the background's result can land after a popup enqueue and erase it.
 */
async function updateQueue(
  change: (state: QueueState) => QueueState
): Promise<QueueState> {
  return withQueueLock(async () => {
    const state = await readQueue();
    const next = change(state);
    if (next !== state) await writeQueue(next);
    return next;
  });
}

function publish(): void {
  const summary = queueSummary(cachedQueue);
  writeQueueStore.setState(() => ({
    ...summary,
    saving: stagedDraftIds.size > 0,
  }));

  const operations: Record<string, QueuedChange> = {};
  const outcomes: Record<string, QueueOutcome> = {};
  for (const op of cachedQueue.operations) {
    operations[op.id] = op;
    if (op.status === "failed" || op.status === "refused") {
      outcomes[op.snippetId] = {
        opId: op.id,
        snippetId: op.snippetId,
        status: op.status,
        error: op.error,
      };
    }
  }
  queueOperationsStore.setState(() => operations);
  queueOutcomesStore.setState(() => outcomes);
}

type CommitSettlement = { outcome: QueueOutcome | null };

function settledOutcome(snippetId: string): CommitSettlement | null {
  const outcome = queueOutcomesStore.state[snippetId];
  if (outcome) return { outcome };
  const stillQueued = Object.values(queueOperationsStore.state).some(
    (op) => op.snippetId === snippetId
  );
  return stillQueued ? null : { outcome: null };
}

/**
 * Wait until every queued operation for a snippet has committed or terminalised.
 *
 * Create, delete and undo-delete are addressed optimistically in the popup, but
 * the authoritative write happens later in the background. Waiting by snippet
 * rather than by the id returned from `enqueue` is deliberate: coalescing keeps
 * the *existing* operation id, so a caller's fresh id may never appear in the
 * queue. A null outcome means success — the queue removed the operation.
 */
export function waitForSnippetCommit(
  snippetId: string
): Promise<QueueOutcome | null> {
  const settled = settledOutcome(snippetId);
  if (settled) return Promise.resolve(settled.outcome);

  return new Promise<QueueOutcome | null>((resolve) => {
    const finish = () => {
      const next = settledOutcome(snippetId);
      if (!next) return;
      unsubscribeOperations.unsubscribe();
      unsubscribeOutcomes.unsubscribe();
      resolve(next.outcome);
    };
    const unsubscribeOperations = queueOperationsStore.subscribe(finish);
    const unsubscribeOutcomes = queueOutcomesStore.subscribe(finish);
    // Recheck in case a commit landed between the first check and subscribing.
    finish();
  });
}

/** Refresh the status shown in the top bar from the authoritative stores. */
export async function refreshSyncStatus(): Promise<void> {
  const [, drafts] = await Promise.all([
    readQueue(),
    editorDraftsItem.getValue(),
  ]);
  stagedDraftIds.clear();
  for (const [id, draft] of Object.entries(drafts ?? {})) {
    stagedDraftIds.add(id);
    setDraftPreview(id, draft.fields);
  }
  // Previews for already-committed edits are kept: this document deliberately
  // ignores its own commits in the authoritative store, so clearing a preview on
  // every queue change would make the sidebar snap back to stale content.
  publish();
}

let refreshChain: Promise<void> = Promise.resolve();

/**
 * Keep the toolbar status in step with the background-owned queue.
 *
 * The popup publishes `Saving…` when it stages a draft, but the background is
 * what later removes that draft and the queued operation. Without watching both
 * items the local store never hears about the commit and the toolbar sticks on
 * `Saving…` even though the write landed. Serialising refreshes stops an older
 * read from overwriting the result of a newer one.
 */
export function watchWriteQueueStatus(): () => void {
  let disposed = false;
  const refresh = () => {
    if (disposed) return;
    refreshChain = refreshChain.then(refreshSyncStatus, refreshSyncStatus);
  };
  const unwatchDrafts = editorDraftsItem.watch(refresh);
  const unwatchQueue = writeQueueItem.watch(refresh);
  refresh();
  return () => {
    disposed = true;
    unwatchDrafts();
    unwatchQueue();
  };
}

/** Save editor fields locally without committing them yet. */
export async function stageDraft(draft: EditorDraft): Promise<void> {
  const drafts = await editorDraftsItem.getValue();
  await editorDraftsItem.setValue({ ...drafts, [draft.id]: draft });
  stagedDraftIds.add(draft.id);
  setDraftPreview(draft.id, draft.fields);
  publish();
}

/**
 * Validate a draft and hand it to the background queue.
 *
 * The draft stays in local storage until the background reports success. Terminal
 * quota/conflict outcomes need the editable fields to still be there, and the
 * background deletes only the exact draft the operation was built from.
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
  const change = {
    id: `op-${crypto.randomUUID()}`,
    snippetId,
    kind: "upsert" as const,
    fields: draft.fields,
    baseRev: draft.baseRev,
    updatedAt: now,
    updatedBy: writerId,
    reason: "edit" as const,
    createdAt: Date.now(),
    draftUpdatedAt: draft.updatedAt,
  };
  await updateQueue((state) => enqueue(state, change, Date.now()));
  return { ok: true, isNew: draft.isNew };
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

function sameFields(a: EditorFields, b: EditorFields): boolean {
  return (
    a.label === b.label &&
    a.shortcut === b.shortcut &&
    a.content === b.content &&
    JSON.stringify(a.tags ?? []) === JSON.stringify(b.tags ?? [])
  );
}

/**
 * Stage one debounced edit and remember the editor state it replaced.
 *
 * The in-memory snippet is deliberately not refreshed on our own commits, so it
 * still holds the fields the popup loaded. Undo must step from the last *editor*
 * state instead: the staged draft while one exists, then the fields our last
 * commit wrote, and only the stored snippet as a fallback.
 */
export async function stageEdit(
  snippet: Snippet,
  fields: EditorFields
): Promise<void> {
  const drafts = await editorDraftsItem.getValue();
  const before =
    drafts[snippet.id]?.fields ??
    committedFieldsStore.state[snippet.id] ??
    fieldsFromSnippet(snippet);
  await stageDraft({
    id: snippet.id,
    baseRev: drafts[snippet.id]?.baseRev ?? snippetRev(snippet),
    fields,
    updatedAt: new Date().toISOString(),
    isNew: false,
  });
  if (sameFields(before, fields)) return;
  const stacks = (await undoStacksItem.getValue()) ?? EMPTY_UNDO_STACKS;
  await undoStacksItem.setValue(pushUndo(stacks, snippet.id, before));
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
  setDraftPreview(snippet.id, fields);
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
  setDraftPreview(snippet.id, fields);
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
    stagedDraftIds.delete(snippetId);
    removeDraftPreview(snippetId);
    publish();
  }
  await updateQueue((state) => clearRefused(state, snippetId));
}

/** Abandon every trace of a snippet: its draft and its undo history. */
export async function discardDraft(snippetId: string): Promise<void> {
  await discardUnflushedDraft(snippetId);
  clearCommittedFields(snippetId);
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
  const change = {
    id: `op-${crypto.randomUUID()}`,
    snippetId: snippet.id,
    kind: "delete" as const,
    baseRev: snippetRev(snippet),
    updatedAt: now,
    updatedBy: writerId,
    reason: "delete" as const,
    createdAt: Date.now(),
  };
  await updateQueue((state) => enqueue(state, change, Date.now()));
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
  const change = {
    id: `op-${crypto.randomUUID()}`,
    snippetId: snippet.id,
    kind: "upsert" as const,
    fields,
    baseRev: snippetRev(snippet),
    updatedAt: now,
    updatedBy: writerId,
    reason: "restore" as const,
    createdAt: Date.now(),
  };
  await updateQueue((state) => enqueue(state, change, Date.now()));
}

if (typeof browser !== "undefined" && browser.storage?.onChanged) {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.writeQueue) {
      void refreshSyncStatus();
    }
  });
}
