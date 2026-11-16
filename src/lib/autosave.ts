/**
 * Debounced, serialised autosave for one value.
 *
 * Extracted from `SnippetDetailView` so the part that can actually be wrong — how
 * many writes happen, in what order, and what a caller learns about each one — is
 * testable without a DOM, and so the component is left holding nothing but the
 * effect that decides *when* to schedule. The value is generic; the delay below
 * is named for the tag input that is currently its only caller.
 *
 * Three properties exist because each one is a failure mode that was reachable
 * by writing the naive thing:
 *
 *  1. **Debounced.** The obvious implementation writes on every change. A tag
 *     input commits per keystroke, so that is a storage write per character —
 *     the same shape of defect as the popup sidebar's write-per-event. Only the
 *     final value survives the window, which is the point.
 *
 *  2. **Serialised.** `persist` here is a whole-record upsert, so two writes
 *     that overlap are two writes whose payloads were both derived from the same
 *     stale snapshot. Last one to land wins, and the loser is silently lost —
 *     a tag edit written back over a body edit, with no error anywhere. Every
 *     write is therefore queued behind the previous one and reads its value at
 *     the moment it runs, so the newest edit is always the one that survives.
 *
 *  3. **Never rejects.** A failed write resolves to `{ ok: false, error }`
 *     instead of rejecting. If the chain rejected, one failure would poison
 *     every write after it: the queue would stop draining and the autosave would
 *     be dead for the rest of the session, silently, which is the one outcome
 *     worse than a visible failure.
 */

/**
 * How long the value must settle before it is written.
 *
 * Long enough that a burst of keystrokes or repeated Enter presses is one write;
 * short enough that a user who types a tag and looks away has not waited long.
 */
export const TAG_AUTOSAVE_DELAY_MS = 600;

/** How one write ended. `error` is whatever `persist` threw. */
export type AutosaveOutcome = { ok: true } | { ok: false; error: unknown };

export type Autosave<T> = {
  /** Replace the pending value and restart the timer. */
  schedule(value: T): void;
  /**
   * Write the pending value now, then wait for it. With nothing pending this is
   * just `settle` — so a flush that races the timer still reports the write's
   * outcome rather than reporting nothing.
   */
  flush(): Promise<AutosaveOutcome | null>;
  /** Wait for in-flight writes without starting one. */
  settle(): Promise<AutosaveOutcome | null>;
  /**
   * Drop the pending value and stop the timer. A write already in flight runs to
   * completion — discarding is about what has *not* been written yet.
   */
  discard(): void;
  hasPending(): boolean;
};

/**
 * @param persist Called with the value to write. A synchronous throw, a rejected
 *   promise, and a plain non-promise return are all handled identically.
 * @param delayMs Debounce window; overridable so tests need not wait 600ms.
 */
export function createAutosave<T>(
  persist: (value: T) => unknown,
  delayMs: number = TAG_AUTOSAVE_DELAY_MS
): Autosave<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Wrapped in an object so a pending value of `undefined` is still pending.
  let pending: { value: T } | null = null;
  let last: AutosaveOutcome | null = null;
  // Always resolves, whatever `persist` does — that is what keeps one failure
  // from poisoning the writes behind it.
  let chain: Promise<AutosaveOutcome | null> = Promise.resolve(null);

  function stopTimer(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function enqueue(value: T): Promise<AutosaveOutcome> {
    const run = (): Promise<AutosaveOutcome> =>
      // `Promise.resolve().then(...)` rather than calling `persist` directly, so
      // a synchronous throw inside it lands on the same path as a rejection
      // instead of escaping before the chain is wired up.
      Promise.resolve()
        .then(() => persist(value))
        .then(
          (): AutosaveOutcome => ({ ok: true }),
          (error: unknown): AutosaveOutcome => ({ ok: false, error })
        );
    chain = chain.then(run).then((outcome) => {
      last = outcome;
      return outcome;
    });
    // `chain` is declared with a `| null` head for `settle`, which reads `last`
    // rather than a write result; a value just enqueued is never null.
    return chain as Promise<AutosaveOutcome>;
  }

  return {
    schedule(value: T): void {
      stopTimer();
      pending = { value };
      // The callback closes over the value it was scheduled with rather than
      // re-reading `pending`. Any later `schedule`, `flush` or `discard` stops
      // this timer, so the two cannot go out of step — and there is no branch to
      // cover the case where they somehow did.
      timer = setTimeout(() => {
        timer = null;
        pending = null;
        void enqueue(value);
      }, delayMs);
    },

    flush(): Promise<AutosaveOutcome | null> {
      stopTimer();
      const due = pending;
      pending = null;
      return due ? enqueue(due.value) : chain.then(() => last);
    },

    settle(): Promise<AutosaveOutcome | null> {
      return chain.then(() => last);
    },

    discard(): void {
      stopTimer();
      pending = null;
    },

    hasPending(): boolean {
      return pending !== null;
    },
  };
}
