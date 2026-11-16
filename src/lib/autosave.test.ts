/**
 * Tests for src/lib/autosave.ts
 *
 * The properties pinned here are the ones a caller cannot see and a naive
 * implementation gets wrong: one write per burst, newest value wins, a failed
 * write reported rather than thrown, and a failure that does not kill the queue.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutosave, TAG_AUTOSAVE_DELAY_MS } from "./autosave";

const DELAY = 50;

afterEach(() => {
  vi.useRealTimers();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Let queued microtasks drain without moving the clock. */
const drain = () => Promise.resolve().then().then().then();

describe("createAutosave", () => {
  // --- debouncing -------------------------------------------------------

  it("writes nothing before the debounce window closes", () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave(persist, DELAY);

    autosave.schedule("work");
    vi.advanceTimersByTime(DELAY - 1);

    expect(persist).not.toHaveBeenCalled();
    expect(autosave.hasPending()).toBe(true);
  });

  it("writes once when a burst of changes settles", async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave(persist, DELAY);

    autosave.schedule("w");
    vi.advanceTimersByTime(DELAY - 1);
    autosave.schedule("wo");
    vi.advanceTimersByTime(DELAY - 1);
    autosave.schedule("work");
    vi.advanceTimersByTime(DELAY);
    await drain();

    // Three schedules, one write, and it carries the last value. A write per
    // keystroke is the defect this whole module exists to prevent.
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith("work");
    expect(autosave.hasPending()).toBe(false);
  });

  it("does not write after the pending value is discarded", async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave(persist, DELAY);

    autosave.schedule("work");
    autosave.discard();
    vi.advanceTimersByTime(DELAY * 10);
    await drain();

    // Discard means "this never happened" — used by the explicit Save, which
    // carries the value itself. If it merely deferred, the discard would buy
    // nothing and the same edit would be written twice.
    expect(persist).not.toHaveBeenCalled();
    expect(autosave.hasPending()).toBe(false);
  });

  it("defaults to the documented debounce window", async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave(persist);

    autosave.schedule("work");
    vi.advanceTimersByTime(TAG_AUTOSAVE_DELAY_MS - 1);
    expect(persist).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await drain();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("writes nothing once the pending value is discarded before the timer", async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave(persist, DELAY);

    autosave.schedule("work");
    autosave.discard();
    vi.advanceTimersByTime(DELAY * 10);
    await drain();

    // The timer callback closes over the value it was scheduled with. If
    // `discard` only cleared the pending slot and left that timer running, the
    // discarded value would still be written a moment later — which is the
    // duplicate write `discard` exists to prevent.
    expect(persist).not.toHaveBeenCalled();
  });

  // --- flush ------------------------------------------------------------

  it("writes immediately on flush without waiting for the timer", async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave(persist, DELAY);

    autosave.schedule("work");
    await autosave.flush();

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith("work");
    expect(autosave.hasPending()).toBe(false);
  });

  it("does not write twice when the timer fires after a flush", async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave(persist, DELAY);

    autosave.schedule("work");
    await autosave.flush();
    vi.advanceTimersByTime(DELAY * 10);
    await drain();

    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("reports the last outcome when flushed with nothing pending", async () => {
    const failure = new Error("storage unavailable");
    const autosave = createAutosave(() => Promise.reject(failure), DELAY);

    autosave.schedule("work");
    expect(await autosave.flush()).toEqual({ ok: false, error: failure });

    // A second flush has nothing of its own to write, but must not report
    // success — the caller is about to assume the value is safe.
    expect(await autosave.flush()).toEqual({ ok: false, error: failure });
  });

  it("reports no outcome when nothing has ever been written", async () => {
    const autosave = createAutosave(vi.fn(), DELAY);

    expect(await autosave.flush()).toBeNull();
    expect(await autosave.settle()).toBeNull();
  });

  // --- serialisation ----------------------------------------------------

  it("does not start a second write until the first has finished", async () => {
    const first = deferred();
    const persist = vi.fn((value: string) =>
      value === "first" ? first.promise : Promise.resolve()
    );
    const autosave = createAutosave(persist, DELAY);

    autosave.schedule("first");
    const firstWrite = autosave.flush();
    autosave.schedule("second");
    const secondWrite = autosave.flush();
    await drain();

    // Both values were whole-record snapshots taken from the same pre-edit
    // state. Letting them overlap would mean whichever landed last silently
    // reverted the other.
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith("first");

    first.resolve();
    expect(await firstWrite).toEqual({ ok: true });
    expect(await secondWrite).toEqual({ ok: true });
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith("second");
  });

  it("settle waits for an in-flight write without starting a new one", async () => {
    const inFlight = deferred();
    const persist = vi.fn(() => inFlight.promise);
    const autosave = createAutosave(persist, DELAY);

    autosave.schedule("work");
    const write = autosave.flush();
    const settled = autosave.settle();
    await drain();

    expect(persist).toHaveBeenCalledTimes(1);

    inFlight.resolve();
    expect(await settled).toEqual({ ok: true });
    expect(await write).toEqual({ ok: true });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  // --- failures ---------------------------------------------------------

  it("reports a rejected write instead of throwing", async () => {
    const failure = new Error("storage unavailable");
    const autosave = createAutosave(() => Promise.reject(failure), DELAY);

    autosave.schedule("work");

    // The caller has to be able to learn that the value was not saved.
    await expect(autosave.flush()).resolves.toEqual({
      ok: false,
      error: failure,
    });
  });

  it("reports a synchronous throw from persist", async () => {
    const failure = new Error("extension context invalidated");
    const autosave = createAutosave(() => {
      throw failure;
    }, DELAY);

    autosave.schedule("work");

    // Calling `persist` directly, rather than through the chain, would let this
    // escape before the queue exists and leave it unwired.
    await expect(autosave.flush()).resolves.toEqual({
      ok: false,
      error: failure,
    });
  });

  it("does not let one failed write swallow the next", async () => {
    const persist = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValue(undefined);
    const autosave = createAutosave(persist, DELAY);

    autosave.schedule("first");
    expect(await autosave.flush()).toEqual({
      ok: false,
      error: new Error("storage unavailable"),
    });

    // The queue must still drain. If the chain rejected, every later write would
    // inherit the rejection and the autosave would be dead for the session — a
    // silent failure, which is the worst outcome available here.
    autosave.schedule("second");
    expect(await autosave.flush()).toEqual({ ok: true });
    expect(persist).toHaveBeenLastCalledWith("second");
  });

  it("settle reports a failed write so a later writer is not blocked on it", async () => {
    const failure = new Error("storage unavailable");
    const autosave = createAutosave(() => Promise.reject(failure), DELAY);

    autosave.schedule("work");
    await autosave.flush();

    expect(await autosave.settle()).toEqual({ ok: false, error: failure });
  });

  // --- edge values ------------------------------------------------------

  it("can carry an undefined value", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const autosave = createAutosave(persist, DELAY);

    autosave.schedule(undefined);
    await autosave.flush();

    // `pending` is an object wrapper precisely so `undefined` is still pending.
    expect(persist).toHaveBeenCalledWith(undefined);
  });

  it("discard does not cancel a write already in flight", async () => {
    const inFlight = deferred();
    const persist = vi.fn(() => inFlight.promise);
    const autosave = createAutosave(persist, DELAY);

    autosave.schedule("first");
    const write = autosave.flush();
    autosave.discard();
    inFlight.resolve();

    expect(await write).toEqual({ ok: true });
    // Discard is about what has not been written yet. Cancelling the in-flight
    // write would leave the store holding a value the caller was told nothing
    // about.
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
