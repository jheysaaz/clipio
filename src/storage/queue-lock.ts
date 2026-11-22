/**
 * Cross-context mutual exclusion for the local write queue.
 *
 * The popup and the background both mutate `local:writeQueue`, and both do so as
 * a read-modify-write. A plain storage read/write pair is not atomic: the
 * background can finish a commit and persist its result after the popup has
 * enqueued a new operation, overwriting that operation with a stale snapshot.
 *
 * Web Locks give the two contexts the same mutex under the same extension
 * origin. The in-module fallback keeps unit tests and older browsers single-file
 * safe; it cannot coordinate two real contexts, which is why the Web Lock is
 * always preferred when available. Hold the lock around the *whole* transaction,
 * including the authoritative write, so a popup cannot enqueue against a commit
 * that is already in progress.
 */

const LOCK_NAME = "clipio:write-queue";

type LockManager = {
  request: (name: string, callback: () => Promise<unknown>) => Promise<unknown>;
};

function lockManager(): LockManager | null {
  if (typeof navigator === "undefined") return null;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  return locks ?? null;
}

let fallbackTail: Promise<void> = Promise.resolve();

async function withFallbackLock<T>(run: () => Promise<T>): Promise<T> {
  const previous = fallbackTail;
  let release: () => void = () => undefined;
  fallbackTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await run();
  } finally {
    release();
  }
}

/** Run `run` while holding the queue's cross-context mutex. */
export function withQueueLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = lockManager();
  if (!locks) return withFallbackLock(run);
  return locks.request(LOCK_NAME, run) as Promise<T>;
}
