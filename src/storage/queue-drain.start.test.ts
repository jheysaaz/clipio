/**
 * Wiring tests for startWriteQueue in src/storage/queue-drain.ts.
 *
 * The production module is imported by the background entrypoint, where the
 * watcher and the startup drain are the only ways a queued edit ever leaves
 * local storage. This file drives those listeners directly; the decisions they
 * delegate to are covered in queue-drain.test.ts and lib/write-queue.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedChange, QueueState } from "@/lib/write-queue";

const mocks = vi.hoisted(() => ({
  queue: { operations: [], sentAt: [] } as QueueState,
  watch: vi.fn(),
  failRead: false,
  commit: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock("./items", () => ({
  writeQueueItem: {
    getValue: vi.fn(async () => {
      if (mocks.failRead) throw new Error("read failed");
      return mocks.queue;
    }),
    setValue: vi.fn(async (value: QueueState) => {
      mocks.queue = value;
    }),
    watch: mocks.watch,
  },
}));

vi.mock("./index", () => ({
  commitSnippetChange: (...args: unknown[]) => mocks.commit(...args),
}));

vi.mock("@/lib/sentry", () => ({
  captureError: (...args: unknown[]) => mocks.captureError(...args),
}));

async function loadFreshModule() {
  vi.resetModules();
  return await import("./queue-drain");
}

async function flushMicrotasks() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function operation(overrides: Partial<QueuedChange> = {}): QueuedChange {
  return {
    id: "op-1",
    snippetId: "s1",
    kind: "upsert",
    fields: { label: "L", shortcut: "/l", content: "C", tags: [] },
    baseRev: 2,
    updatedAt: "2026-01-02T00:00:00.000Z",
    updatedBy: "writer-1",
    reason: "edit",
    attempts: 0,
    nextAttemptAt: 0,
    status: "pending",
    createdAt: 1,
    ...overrides,
  };
}

describe("startWriteQueue", () => {
  beforeEach(() => {
    mocks.queue = { operations: [], sentAt: [] };
    mocks.failRead = false;
    mocks.watch.mockReset();
    mocks.commit.mockReset();
    mocks.captureError.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does nothing when no browser extension API exists", async () => {
    vi.stubGlobal("browser", undefined);
    const { startWriteQueue } = await loadFreshModule();

    startWriteQueue();

    expect(mocks.watch).not.toHaveBeenCalled();
    expect(mocks.captureError).not.toHaveBeenCalled();
  });

  it("watches the queue, drains on startup, and is idempotent", async () => {
    const { startWriteQueue } = await loadFreshModule();
    mocks.failRead = true;

    startWriteQueue();

    expect(mocks.watch).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(mocks.captureError).toHaveBeenCalledWith(expect.any(Error), {
        action: "queue.drain.startup",
      });
    });

    mocks.captureError.mockClear();
    const watcher = mocks.watch.mock.calls[0]?.[0] as (() => void) | undefined;
    expect(watcher).toBeTypeOf("function");
    watcher?.();

    await vi.waitFor(() => {
      expect(mocks.captureError).toHaveBeenCalledWith(expect.any(Error), {
        action: "queue.drain",
      });
    });

    startWriteQueue();
    expect(mocks.watch).toHaveBeenCalledTimes(1);
  });

  it("wakes up after the min-gap cooldown instead of waiting for another write", async () => {
    // A queue change is the only wake-up the browser gives us. If that change
    // arrives during a cooldown, an uncommitted edit must still be sent once
    // the cooldown ends — no second keystroke or popup open required.
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { startWriteQueue } = await loadFreshModule();
    startWriteQueue();
    await flushMicrotasks();

    mocks.queue = {
      operations: [operation()],
      sentAt: [1_000_000],
    };
    mocks.commit.mockResolvedValue({ ok: true, snippet: null });
    const watcher = mocks.watch.mock.calls[0]?.[0] as () => void;
    watcher();
    await flushMicrotasks();

    expect(mocks.commit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(mocks.queue.operations).toHaveLength(0);
  });

  it("retries a transient failure after its backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const { startWriteQueue } = await loadFreshModule();
    startWriteQueue();
    await flushMicrotasks();

    mocks.queue = { operations: [operation()], sentAt: [] };
    mocks.commit
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ ok: true, snippet: null });
    const watcher = mocks.watch.mock.calls[0]?.[0] as () => void;
    watcher();
    await flushMicrotasks();

    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.commit).toHaveBeenCalledTimes(2);
    expect(mocks.queue.operations).toHaveLength(0);
  });
});
