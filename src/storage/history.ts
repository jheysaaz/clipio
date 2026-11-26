/**
 * Local version history: record, read and restore.
 *
 * A snapshot is taken *before* a commit overwrites a snippet, so undoing one
 * step means writing the snapshot back through the same queue as any other
 * edit. Nothing here writes to sync, backup, cache, search or counts.
 */

import type { Snippet, SnippetEditReason } from "@/types";
import {
  HISTORY_LIMITS,
  applyHistoryCaps,
  shouldCoalesce,
  withBytes,
  type HistoryEntry,
} from "@/lib/history-policy";
import { deleteHistory, listHistory, writeHistory } from "./backends/history";

export type HistoryDeps = {
  list: () => Promise<HistoryEntry[]>;
  write: (entries: HistoryEntry[]) => Promise<void>;
  remove: (ids: string[]) => Promise<void>;
  now: () => string;
  id: () => string;
};

const defaultDeps: HistoryDeps = {
  list: listHistory,
  write: writeHistory,
  remove: deleteHistory,
  now: () => new Date().toISOString(),
  id: () => crypto.randomUUID(),
};

/**
 * Snapshot the state being replaced. Repeated edits inside the coalescing
 * window keep the first snapshot, which is the state the user wants to get
 * back to when they undo the burst.
 */
export async function recordHistory(
  snapshot: Snippet,
  reason: SnippetEditReason,
  deps: HistoryDeps = defaultDeps
): Promise<void> {
  const createdAt = deps.now();
  const existing = await deps.list();
  if (
    shouldCoalesce(
      existing,
      { snippetId: snapshot.id, reason, createdAt },
      HISTORY_LIMITS
    )
  ) {
    return;
  }

  const entry = withBytes({
    id: deps.id(),
    snippetId: snapshot.id,
    rev: typeof snapshot.rev === "number" ? snapshot.rev : 0,
    reason,
    snapshot: structuredClone(snapshot),
    createdAt,
  });
  const caps = applyHistoryCaps([...existing, entry], HISTORY_LIMITS);
  await deps.write([entry]);
  await deps.remove(caps.removedIds);
}

/** Newest snapshots first. */
export async function getHistory(
  snippetId: string,
  deps: HistoryDeps = defaultDeps
): Promise<HistoryEntry[]> {
  const entries = await deps.list();
  return entries
    .filter((entry) => entry.snippetId === snippetId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Return a snapshot by revision, or null when it is not in local history. */
export async function restoreVersion(
  snippetId: string,
  rev: number,
  deps: HistoryDeps = defaultDeps
): Promise<Snippet | null> {
  const entries = await getHistory(snippetId, deps);
  return entries.find((entry) => entry.rev === rev)?.snapshot ?? null;
}
