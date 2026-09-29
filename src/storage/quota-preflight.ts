/**
 * Sync quota preflight.
 *
 * spec: specs/storage-quota-preflight.spec.md
 *
 * `storage.sync` is hard-capped at three limits (see `SYNC_QUOTA`). Clipio hits
 * them in normal use: a snippet over 8 KB cannot be stored at all, and a few
 * hundred ordinary snippets exhaust the 100 KB total. Hitting that used to mean
 * the write threw, `StorageManager` silently switched the whole install to local
 * mode **permanently**, and the only signal was an amber banner on a settings
 * page the user might not open for weeks.
 *
 * This projects the post-write state against all three limits *before* anything
 * is mutated, so the failure can be explained instead of suffered.
 *
 * ## This is a guard, not an authority
 *
 * Chrome's quota accounting is not exactly `JSON.stringify(value).length`, and
 * not exactly UTF-8 byte length either — there is no documented formula to
 * reproduce. So:
 *
 * - We measure with `TextEncoder` (real UTF-8 bytes) plus the key's own bytes,
 *   which is the closest documented basis. No fudge factor is applied: an
 *   earlier version of this file rounded each item up to the next 64 bytes "to
 *   err toward warning early", which made a snippet of exactly
 *   `BYTES_PER_ITEM` get rejected. A false refusal sitting on the documented
 *   limit is the worst possible place to be conservative, and because the
 *   browser stays the authority a marginal under-estimate simply falls through
 *   to the existing error path.
 * - The browser's own `QUOTA_BYTES` error remains the source of truth. If this
 *   passes and the browser still fails, the existing error path still runs. That
 *   is an inaccuracy here, not a new failure mode.
 */

import { SYNC_QUOTA } from "@/config/constants";
import type { Snippet } from "~/types";

/** Key prefix `SyncBackend` writes each snippet under. */
const SNIPPET_PREFIX = "snip:";

const encoder = new TextEncoder();

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

/** Serialised size of one snippet, including its key. */
function itemBytes(snippet: Snippet): number {
  return (
    byteLength(JSON.stringify(snippet)) +
    byteLength(SNIPPET_PREFIX + snippet.id)
  );
}

export type QuotaBreachKind = "total" | "per-item" | "count";

export type QuotaBreach = {
  kind: QuotaBreachKind;
  /** Human-readable, already localised at the call site — not here. */
  limit: number;
  actual: number;
  /** Present only for `per-item`: which snippet is the problem. */
  id?: string;
};

export type QuotaCheck = {
  ok: boolean;
  currentBytes: number;
  projectedBytes: number;
  reasons: QuotaBreach[];
};

/**
 * Project `incoming` against the sync limits.
 *
 * `existing` is what is stored right now; `incoming` is the full desired state
 * (this is a replace-the-world write, matching `SyncBackend.saveSnippets`).
 *
 * Snippets whose serialised value is byte-identical to what is already stored
 * are excluded from the projection. That mirrors `SyncBackend.planWrite`, which
 * skips them and therefore performs no write — so re-saving unchanged snippets
 * must not report a breach that no write would ever cause.
 *
 * Pure: no storage, no clock, no randomness.
 */
export function checkQuota(
  existing: readonly Snippet[],
  incoming: readonly Snippet[]
): QuotaCheck {
  const reasons: QuotaBreach[] = [];

  const existingById = new Map(existing.map((s) => [s.id, s]));

  let currentBytes = 0;
  for (const snippet of existing) {
    currentBytes += itemBytes(snippet);
  }

  let projectedBytes = 0;
  for (const snippet of incoming) {
    const prior = existingById.get(snippet.id);
    // Unchanged: planWrite will not write it, so it does not grow the store.
    if (
      prior !== undefined &&
      JSON.stringify(prior) === JSON.stringify(snippet)
    ) {
      projectedBytes += itemBytes(snippet);
      continue;
    }
    const bytes = itemBytes(snippet);
    projectedBytes += bytes;

    if (bytes > SYNC_QUOTA.BYTES_PER_ITEM) {
      reasons.push({
        kind: "per-item",
        limit: SYNC_QUOTA.BYTES_PER_ITEM,
        actual: bytes,
        id: snippet.id,
      });
    }
  }

  if (projectedBytes > SYNC_QUOTA.TOTAL_BYTES) {
    reasons.push({
      kind: "total",
      limit: SYNC_QUOTA.TOTAL_BYTES,
      actual: projectedBytes,
    });
  }

  if (incoming.length > SYNC_QUOTA.MAX_ITEMS) {
    reasons.push({
      kind: "count",
      limit: SYNC_QUOTA.MAX_ITEMS,
      actual: incoming.length,
    });
  }

  return { ok: reasons.length === 0, currentBytes, projectedBytes, reasons };
}
