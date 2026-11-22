/**
 * Background-owned drain for the local write queue.
 *
 * This is the only place that turns queued operations into authoritative
 * writes. It runs in the background worker, so a popup that closes on blur does
 * not take pending commits with it. Budgeting, coalescing and retry decisions
 * are pure functions in `lib/write-queue.ts`; this module is the wiring.
 */

import { captureError } from "@/lib/sentry";
import {
  canSend,
  markInFlight,
  nextDueOperation,
  QUEUE_POLICY,
  recordResult,
  recordSend,
  releaseInFlight,
  type QueueState,
  type WriteResult,
} from "@/lib/write-queue";
import { editorDraftsItem, writeQueueItem } from "./items";
import { commitSnippetChange, getSnippets } from "./index";
import { StorageQuotaError } from "./types";
import { withQueueLock } from "./queue-lock";

async function readQueue(): Promise<QueueState> {
  return (await writeQueueItem.getValue()) ?? { operations: [], sentAt: [] };
}

/** Remove only the draft this operation was built from, not a newer edit. */
async function clearCommittedDraft(
  snippetId: string,
  draftUpdatedAt?: string
): Promise<void> {
  if (!draftUpdatedAt) return;
  const drafts = await editorDraftsItem.getValue();
  const draft = drafts[snippetId];
  if (!draft || draft.updatedAt !== draftUpdatedAt) return;
  const remaining = { ...drafts };
  delete remaining[snippetId];
  await editorDraftsItem.setValue(remaining);
}

/**
 * Commit one operation while holding the cross-context queue lock.
 *
 * Persisting the send ticket *and* the in-flight claim before the authoritative
 * write means a worker that dies mid-commit can be reconciled on restart: the
 * stored record carries the same `updatedAt`/`updatedBy` as the operation.
 * Holding the lock until the result is persisted stops the popup from enqueuing
 * against a commit already in progress.
 */
async function commitOne(): Promise<boolean> {
  return withQueueLock(async () => {
    const state = await readQueue();
    const now = Date.now();
    const op = nextDueOperation(state, now);
    if (!op || !canSend(state, now, QUEUE_POLICY)) return false;

    let next = markInFlight(recordSend(state, now, QUEUE_POLICY), op.id);
    await writeQueueItem.setValue(next);

    let result: WriteResult;
    try {
      const outcome = await commitSnippetChange({
        snippetId: op.snippetId,
        kind: op.kind,
        fields: op.fields,
        baseRev: op.baseRev,
        updatedAt: op.updatedAt,
        updatedBy: op.updatedBy,
        reason: op.reason,
      });
      result = outcome.ok
        ? { ok: true }
        : {
            ok: false,
            quota: false,
            conflict: true,
            error: "conflict",
          };
    } catch (error) {
      if (error instanceof StorageQuotaError) {
        // ADR 0004: a quota ceiling is an answer, not a transient failure. The
        // draft stays local and the refusal is shown; nothing is retried.
        result = { ok: false, quota: true, error: error.message };
      } else {
        captureError(error, {
          action: "queue.commit",
          snippetId: op.snippetId,
        });
        result = {
          ok: false,
          quota: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    if (result.ok) await clearCommittedDraft(op.snippetId, op.draftUpdatedAt);
    // The lock covers the whole transaction, so the claimed snapshot is still
    // current here. Re-reading would only hide a lost lock, not repair it.
    next = recordResult(next, op.id, result, Date.now());
    await writeQueueItem.setValue(next);
    return true;
  });
}

/** Resolve operations claimed by a worker that died before recording the result. */
export async function reconcileInFlight(): Promise<void> {
  await withQueueLock(async () => {
    const state = await readQueue();
    const claimed = state.operations.filter((op) => op.inFlight);
    if (claimed.length === 0) return;

    const snippets = await getSnippets();
    let next = state;
    for (const op of claimed) {
      const stored = snippets.find((item) => item.id === op.snippetId);
      const committed =
        op.kind === "delete"
          ? !stored
          : !!stored &&
            stored.updatedAt === op.updatedAt &&
            stored.updatedBy === op.updatedBy;
      if (committed) {
        await clearCommittedDraft(op.snippetId, op.draftUpdatedAt);
        next = recordResult(next, op.id, { ok: true }, Date.now());
      } else {
        next = releaseInFlight(next, op.id);
      }
    }
    await writeQueueItem.setValue(next);
  });
}

/**
 * Earliest wall-clock time another write is allowed. WXT's watch fires when the
 * queue changes, not when a rate limit expires, so without this the queue can
 * sit forever with a pending operation written during a cooldown.
 */
function nextSendableAt(state: QueueState, now: number): number {
  const candidates: number[] = [];
  const last = state.sentAt.at(-1);
  if (last !== undefined) candidates.push(last + QUEUE_POLICY.minGapMs);

  const withinWindow = (windowMs: number) =>
    state.sentAt.filter((t) => t <= now && now - t < windowMs);
  const minute = withinWindow(60_000);
  if (minute.length >= QUEUE_POLICY.perMinute) {
    candidates.push(Math.min(...minute) + 60_000);
  }
  const hour = withinWindow(3_600_000);
  if (hour.length >= QUEUE_POLICY.perHour) {
    candidates.push(Math.min(...hour) + 3_600_000);
  }
  return candidates.length === 0 ? now : Math.max(now, ...candidates);
}

let inFlight: Promise<void> | null = null;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;

/** Wake the drain when a pending operation becomes both due and sendable. */
async function scheduleNextDrain(): Promise<void> {
  if (wakeTimer !== null) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  try {
    const state = await readQueue();
    const pending = state.operations.filter((op) => op.status === "pending");
    if (pending.length === 0) return;

    const now = Date.now();
    const at = Math.max(
      Math.min(...pending.map((op) => op.nextAttemptAt)),
      nextSendableAt(state, now)
    );
    wakeTimer = setTimeout(
      () => {
        wakeTimer = null;
        void runDrain("queue.drain.wake");
      },
      Math.max(1, at - now)
    );
  } catch (error) {
    captureError(error, { action: "queue.schedule" });
  }
}

async function runDrain(action: string): Promise<void> {
  try {
    await drainWriteQueue();
  } catch (error) {
    captureError(error, { action });
  }
  await scheduleNextDrain();
}

/** Drain as many due operations as the budget allows, once at a time. */
export function drainWriteQueue(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    while (true) {
      const state = await readQueue();
      if (!nextDueOperation(state, Date.now()) || !canSend(state, Date.now())) {
        break;
      }
      if (!(await commitOne())) break;
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Register the wake-up listeners. Safe to call more than once per context. */
let started = false;
export function startWriteQueue(): void {
  if (started || typeof browser === "undefined") return;
  started = true;
  writeQueueItem.watch(() => {
    void runDrain("queue.drain");
  });
  void (async () => {
    try {
      await reconcileInFlight();
    } catch (error) {
      captureError(error, { action: "queue.reconcile.startup" });
    }
    await runDrain("queue.drain.startup");
  })();
}
