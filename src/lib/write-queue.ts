/**
 * Pure state machine for the local write queue.
 *
 * The popup can disappear between a keystroke and a storage write (ADR 0011),
 * so the queue is owned by the background worker and persisted in local
 * storage. This module holds the part that can be wrong without a browser:
 * coalescing, rate limiting, retry backoff and the distinction between a
 * transient rejection and a quota refusal.
 *
 * A quota refusal is terminal by design (ADR 0004). It leaves the draft intact
 * and marks the operation `refused`; it is never retried, chunked or diverted.
 *
 * `inFlight` is separate from `status`: an operation is still `pending` while the
 * background owns it, but no other writer may coalesce into or drain it. That is
 * what keeps a popup edit from being folded into a commit already in progress.
 */

import type { SnippetEditReason } from "@/types";
import type { EditorFields } from "./snippet-draft";

export type QueueKind = "upsert" | "delete";
export type QueueStatus = "pending" | "failed" | "refused";

export type QueuedChange = {
  id: string;
  snippetId: string;
  kind: QueueKind;
  fields?: EditorFields;
  baseRev: number;
  updatedAt: string;
  updatedBy: string;
  reason: SnippetEditReason;
  attempts: number;
  nextAttemptAt: number;
  status: QueueStatus;
  error?: string;
  createdAt: number;
  /** Set while the background is committing this operation. */
  inFlight?: boolean;
  /**
   * Timestamp of the draft this operation was built from. The background only
   * deletes the draft on success if it has not been replaced meanwhile.
   */
  draftUpdatedAt?: string;
};

export type QueueState = {
  operations: QueuedChange[];
  /** Wall-clock times of the most recent accepted writes, for the budgets. */
  sentAt: number[];
};

export type QueuePolicy = {
  perMinute: number;
  perHour: number;
  minGapMs: number;
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  jitterRatio: number;
};

export const QUEUE_POLICY: QueuePolicy = {
  perMinute: 20,
  perHour: 600,
  minGapMs: 2_000,
  maxAttempts: 6,
  baseBackoffMs: 1_000,
  maxBackoffMs: 30_000,
  jitterRatio: 0.25,
};

export function emptyQueue(): QueueState {
  return { operations: [], sentAt: [] };
}

function sentWithin(state: QueueState, now: number, windowMs: number): number {
  return state.sentAt.filter((t) => t <= now && now - t < windowMs).length;
}

/** Whether another write may start right now. */
export function canSend(
  state: QueueState,
  now: number,
  policy: QueuePolicy = QUEUE_POLICY
): boolean {
  const last = state.sentAt.at(-1);
  if (last !== undefined && now - last < policy.minGapMs) return false;
  if (sentWithin(state, now, 60_000) >= policy.perMinute) return false;
  return sentWithin(state, now, 3_600_000) < policy.perHour;
}

export function recordSend(
  state: QueueState,
  now: number,
  policy: QueuePolicy = QUEUE_POLICY
): QueueState {
  return {
    ...state,
    sentAt: [...state.sentAt, now]
      .filter((t) => now - t < 3_600_000)
      .slice(-policy.perHour),
  };
}

/**
 * One operation per snippet matters: a burst of edits is one commit carrying
 * the latest fields and the revision the burst started from. A refused
 * operation is kept untouched — silently replacing it would hide a quota
 * problem the user still needs to see. A *failed* operation is different: a new
 * edit makes it usable again, so it must be restored to pending with fresh retry
 * state instead of inheriting a terminal status the drain will never pick up.
 */
export function enqueue(
  state: QueueState,
  change: Omit<QueuedChange, "attempts" | "nextAttemptAt" | "status">,
  now: number
): QueueState {
  const existing = state.operations.find(
    (op) =>
      op.snippetId === change.snippetId &&
      !op.inFlight &&
      (op.status === "pending" || op.status === "failed")
  );

  if (!existing) {
    const op: QueuedChange = {
      ...change,
      fields: change.fields
        ? { ...change.fields, tags: [...(change.fields.tags ?? [])] }
        : undefined,
      attempts: 0,
      nextAttemptAt: now,
      status: "pending",
      inFlight: false,
    };
    return { ...state, operations: [...state.operations, op] };
  }

  // A conflict or exhausted retry is terminal only until the user edits again.
  // Reusing its fields without resetting these would strand the new edit in an
  // operation `nextDueOperation` can never select.
  const retryingFailure = existing.status === "failed";

  return {
    ...state,
    operations: state.operations.map((op) =>
      op.id === existing.id
        ? {
            ...op,
            fields: change.fields
              ? { ...change.fields, tags: [...(change.fields.tags ?? [])] }
              : undefined,
            kind: change.kind,
            baseRev: retryingFailure
              ? change.baseRev
              : Math.min(op.baseRev, change.baseRev),
            updatedAt: change.updatedAt,
            updatedBy: change.updatedBy,
            reason: change.reason,
            attempts: retryingFailure ? 0 : op.attempts,
            nextAttemptAt: retryingFailure ? now : op.nextAttemptAt,
            status: "pending",
            error: undefined,
            inFlight: false,
            draftUpdatedAt: change.draftUpdatedAt,
          }
        : op
    ),
  };
}

/** Claim an operation so no other writer can touch it while it is committing. */
export function markInFlight(state: QueueState, opId: string): QueueState {
  return {
    ...state,
    operations: state.operations.map((op) =>
      op.id === opId ? { ...op, inFlight: true } : op
    ),
  };
}

/** Give a claimed operation back after a restart could not confirm its commit. */
export function releaseInFlight(state: QueueState, opId: string): QueueState {
  return {
    ...state,
    operations: state.operations.map((op) =>
      op.id === opId ? { ...op, inFlight: false } : op
    ),
  };
}

/** The oldest due, retryable operation, or null when nothing may run. */
export function nextDueOperation(
  state: QueueState,
  now: number
): QueuedChange | null {
  return (
    state.operations
      .filter(
        (op) =>
          op.status === "pending" && !op.inFlight && op.nextAttemptAt <= now
      )
      .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null
  );
}

export type WriteResult =
  | { ok: true }
  | { ok: false; quota: boolean; conflict?: boolean; error: string };

function backoffMs(
  attempts: number,
  policy: QueuePolicy,
  random: () => number
): number {
  const exponential = Math.min(
    policy.maxBackoffMs,
    policy.baseBackoffMs * 2 ** Math.max(0, attempts - 1)
  );
  return Math.min(
    policy.maxBackoffMs,
    exponential + Math.floor(exponential * policy.jitterRatio * random())
  );
}

/** Apply the outcome of one write and return the next queue state. */
export function recordResult(
  state: QueueState,
  opId: string,
  result: WriteResult,
  now: number,
  random: () => number = Math.random,
  policy: QueuePolicy = QUEUE_POLICY
): QueueState {
  const op = state.operations.find((item) => item.id === opId);
  if (!op) return state;

  if (result.ok) {
    const operations = state.operations.filter((item) => item.id !== opId);
    const refused = operations.filter(
      (item) => item.status === "refused" && item.snippetId === op.snippetId
    );
    // A later successful edit clears an earlier refusal for the same snippet:
    // the user no longer needs to act on stale bad news.
    return {
      ...state,
      operations: operations.filter((item) => !refused.includes(item)),
    };
  }

  return {
    ...state,
    operations: state.operations.map((item) => {
      if (item.id !== opId) return item;
      if (result.quota) {
        return {
          ...item,
          status: "refused",
          error: result.error,
          inFlight: false,
        };
      }
      if (result.conflict) {
        // Retrying a stale edit would write it over newer data forever. The
        // draft stays put and the user decides whether to restore or discard.
        return {
          ...item,
          status: "failed",
          error: result.error,
          inFlight: false,
        };
      }
      const attempts = item.attempts + 1;
      const exhausted = attempts >= policy.maxAttempts;
      return {
        ...item,
        inFlight: false,
        attempts,
        status: exhausted ? "failed" : "pending",
        nextAttemptAt: exhausted
          ? item.nextAttemptAt
          : now + backoffMs(attempts, policy, random),
        error: result.error,
      };
    }),
  };
}

export function queueSummary(state: QueueState): {
  pending: number;
  failed: number;
  refused: number;
} {
  return {
    pending: state.operations.filter((o) => o.status === "pending").length,
    failed: state.operations.filter((o) => o.status === "failed").length,
    refused: state.operations.filter((o) => o.status === "refused").length,
  };
}

/** Drop a refusal once the user has acted on it (shortened the snippet, etc.). */
export function clearRefused(state: QueueState, snippetId: string): QueueState {
  return {
    ...state,
    operations: state.operations.filter(
      (op) => !(op.status === "refused" && op.snippetId === snippetId)
    ),
  };
}

/**
 * Whether two snapshots published to the popup stores mean the same thing.
 *
 * Every refresh re-reads the queue from storage, so its operations and derived
 * outcomes arrive as fresh objects even when no write happened. Comparing by
 * reference made the editor re-render and replay a failure on every refresh.
 * These snapshots are plain JSON, so stringifying is a faithful comparison;
 * a different key order only costs one redundant publish, never a stale UI.
 */
export function sameSnapshot<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
