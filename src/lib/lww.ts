/**
 * Last-writer-wins comparison for snippet records.
 *
 * The storage layer has several writers — the popup, the options page and the
 * background queue — and none of them can assume it holds the newest record.
 * Every edit is committed against the revision it was made from; this module is
 * the single place that decides whether that edit or the stored record wins.
 *
 * The ordering is total: timestamp, then revision, then writer id. Timestamp
 * alone is not enough (two writes in the same millisecond are common when a
 * debounce fires next to another context), and revision alone is not enough
 * (records restored from a backup can arrive with a lower revision but a newer
 * timestamp). The writer id is only a deterministic final tie-break; it carries
 * no notion of importance.
 */

import type { Snippet } from "@/types";

/** Writer id used by records written before writer ids existed. */
export const LEGACY_WRITER_ID = "unknown";

/** A missing, non-finite or negative revision is a legacy revision zero. */
export function snippetRev(snippet: Snippet): number {
  const rev = snippet.rev;
  if (typeof rev !== "number" || !Number.isFinite(rev)) return 0;
  return Math.max(0, Math.floor(rev));
}

export function snippetWriter(snippet: Snippet): string {
  return typeof snippet.updatedBy === "string" && snippet.updatedBy
    ? snippet.updatedBy
    : LEGACY_WRITER_ID;
}

function timestamp(snippet: Snippet): string {
  return typeof snippet.updatedAt === "string" ? snippet.updatedAt : "";
}

/**
 * Positive when `a` wins, negative when `b` wins, zero only for the same
 * timestamp, revision and writer. Never mutate either input.
 */
export function compareLww(a: Snippet, b: Snippet): number {
  const byTime = timestamp(a).localeCompare(timestamp(b));
  if (byTime !== 0) return byTime;

  const byRev = snippetRev(a) - snippetRev(b);
  if (byRev !== 0) return byRev;

  return snippetWriter(a).localeCompare(snippetWriter(b));
}
