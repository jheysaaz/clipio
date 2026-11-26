/**
 * Policy for local-only snippet version history.
 *
 * Snapshots are kept in IndexedDB, separate from sync, export, import, search
 * and the content-script cache. This module owns the numbers and the trimming
 * rules so the tests can state them without opening a database.
 *
 * Coalescing keeps the *first* snapshot of a burst. A user typing for thirty
 * seconds should be able to undo back to what the snippet said before they
 * started, not step through one snapshot per keystroke.
 */

import type { Snippet, SnippetEditReason } from "@/types";

export type HistoryEntry = {
  id: string;
  snippetId: string;
  rev: number;
  reason: SnippetEditReason;
  snapshot: Snippet;
  createdAt: string;
  /** UTF-16 estimate of the stored record, used for the global byte cap. */
  bytes: number;
};

export type HistoryLimits = {
  perSnippet: number;
  globalVersions: number;
  globalBytes: number;
  coalesceMs: number;
};

export const HISTORY_LIMITS: HistoryLimits = {
  perSnippet: 20,
  globalVersions: 500,
  globalBytes: 10 * 1024 * 1024,
  coalesceMs: 30_000,
};

export function historyBytes(entry: Omit<HistoryEntry, "bytes">): number {
  // JSON storage in IndexedDB is UTF-16 in every browser we support. The
  // estimate is intentionally simple and slightly conservative: it only has
  // to decide when to trim, not report an exact quota.
  return JSON.stringify(entry).length * 2;
}

export function withBytes(entry: Omit<HistoryEntry, "bytes">): HistoryEntry {
  return { ...entry, bytes: historyBytes(entry) };
}

/** True when `next` is another snapshot in the same short editing burst. */
export function shouldCoalesce(
  entries: HistoryEntry[],
  next: Pick<HistoryEntry, "snippetId" | "reason" | "createdAt">,
  limits: HistoryLimits = HISTORY_LIMITS
): boolean {
  const latest = entries
    .filter((e) => e.snippetId === next.snippetId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!latest || latest.reason !== next.reason) return false;
  const delta = Date.parse(next.createdAt) - Date.parse(latest.createdAt);
  return delta >= 0 && delta < limits.coalesceMs;
}

/** Keep the newest `perSnippet` entries for each snippet. */
export function trimPerSnippet(
  entries: HistoryEntry[],
  limits: HistoryLimits = HISTORY_LIMITS
): HistoryEntry[] {
  const bySnippet = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const list = bySnippet.get(entry.snippetId) ?? [];
    list.push(entry);
    bySnippet.set(entry.snippetId, list);
  }
  return [...bySnippet.values()].flatMap((list) =>
    [...list]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limits.perSnippet)
  );
}

/**
 * Enforce the global caps, oldest first, while preserving the newest snapshot
 * of every snippet. A snippet must always have at least one way back.
 */
export function trimGlobal(
  entries: HistoryEntry[],
  limits: HistoryLimits = HISTORY_LIMITS
): { kept: HistoryEntry[]; removedIds: string[] } {
  const newestBySnippet = new Set(
    [...trimPerSnippet(entries, { ...limits, perSnippet: 1 })].map((e) => e.id)
  );
  const ascending = [...entries].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
  const kept = new Set(ascending.map((e) => e.id));
  const removedIds: string[] = [];
  let bytes = ascending.reduce((sum, e) => sum + e.bytes, 0);

  for (const entry of ascending) {
    if (kept.size <= limits.globalVersions && bytes <= limits.globalBytes) {
      break;
    }
    if (newestBySnippet.has(entry.id)) continue;
    kept.delete(entry.id);
    removedIds.push(entry.id);
    bytes -= entry.bytes;
  }

  return {
    kept: ascending.filter((e) => kept.has(e.id)),
    removedIds,
  };
}

/** Apply every cap in one pass, in the order history is written. */
export function applyHistoryCaps(
  entries: HistoryEntry[],
  limits: HistoryLimits = HISTORY_LIMITS
): { kept: HistoryEntry[]; removedIds: string[] } {
  const perSnippet = trimPerSnippet(entries, limits);
  const removedIds = entries
    .filter((e) => !perSnippet.some((k) => k.id === e.id))
    .map((e) => e.id);
  const global = trimGlobal(perSnippet, limits);
  return {
    kept: global.kept,
    removedIds: [...removedIds, ...global.removedIds],
  };
}
