import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueState } from "@/lib/write-queue";
import { StorageQuotaError } from "./types";

const emptyQueue = (): QueueState => ({ operations: [], sentAt: [] });

const mocks = vi.hoisted(() => ({
  queue: { operations: [], sentAt: [] } as QueueState,
  commit: vi.fn(),
  captureError: vi.fn(),
}));

vi.mock("./items", () => ({
  writeQueueItem: {
    getValue: vi.fn(async () => mocks.queue),
    setValue: vi.fn(async (value: QueueState) => {
      mocks.queue = value;
    }),
  },
}));

vi.mock("./index", () => ({
  commitSnippetChange: (...args: unknown[]) => mocks.commit(...args),
}));

vi.mock("@/lib/sentry", () => ({
  captureError: (...args: unknown[]) => mocks.captureError(...args),
}));

import { drainWriteQueue } from "./queue-drain";

const fields = {
  label: "New",
  shortcut: "/new",
  content: "body",
  tags: ["x"],
};

function operation(overrides: Partial<QueueState["operations"][number]> = {}) {
  return {
    id: "op-1",
    snippetId: "s1",
    kind: "upsert" as const,
    fields,
    baseRev: 2,
    updatedAt: "2026-01-02T00:00:00.000Z",
    updatedBy: "writer-1",
    reason: "edit" as const,
    attempts: 0,
    nextAttemptAt: 0,
    status: "pending" as const,
    createdAt: 1,
    ...overrides,
  };
}

describe("background write queue drain", () => {
  beforeEach(() => {
    mocks.queue = emptyQueue();
    mocks.commit.mockReset();
    mocks.captureError.mockReset();
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when the queue is empty", async () => {
    await drainWriteQueue();

    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("commits a due operation and removes it from the queue", async () => {
    mocks.queue = { ...emptyQueue(), operations: [operation()] };
    mocks.commit.mockResolvedValue({ ok: true, snippet: null });

    await drainWriteQueue();

    expect(mocks.commit).toHaveBeenCalledWith({
      snippetId: "s1",
      kind: "upsert",
      fields,
      baseRev: 2,
      updatedAt: "2026-01-02T00:00:00.000Z",
      updatedBy: "writer-1",
      reason: "edit",
    });
    // One accepted write is recorded for the rate limit even on success.
    expect(mocks.queue.sentAt).toEqual([1_000_000]);
    expect(mocks.queue.operations).toHaveLength(0);
  });

  it("marks a quota refusal terminal without retrying", async () => {
    mocks.queue = { ...emptyQueue(), operations: [operation()] };
    mocks.commit.mockRejectedValue(new StorageQuotaError("sync is full"));

    await drainWriteQueue();

    expect(mocks.queue.operations[0]).toMatchObject({
      status: "refused",
      error: "sync is full",
    });
    expect(mocks.commit).toHaveBeenCalledTimes(1);
  });

  it("marks a stale conflict terminal instead of retrying forever", async () => {
    mocks.queue = { ...emptyQueue(), operations: [operation()] };
    mocks.commit.mockResolvedValue({
      ok: false,
      conflict: { id: "s1", rev: 9 },
    });

    await drainWriteQueue();

    expect(mocks.queue.operations[0]).toMatchObject({
      status: "failed",
      error: "conflict",
    });
    expect(mocks.commit).toHaveBeenCalledTimes(1);
  });

  it("schedules a transient failure with exponential backoff", async () => {
    mocks.queue = { ...emptyQueue(), operations: [operation()] };
    mocks.commit.mockRejectedValue(new Error("network hiccup"));

    await drainWriteQueue();

    expect(mocks.queue.operations[0]).toMatchObject({
      status: "pending",
      attempts: 1,
      nextAttemptAt: 1_001_000,
      error: "network hiccup",
    });
    expect(mocks.captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: "queue.commit" })
    );
  });

  it("serializes overlapping drains so one operation is not sent twice", async () => {
    mocks.queue = {
      ...emptyQueue(),
      operations: [operation(), operation({ id: "op-2", snippetId: "s2" })],
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.commit.mockImplementation(async () => {
      await gate;
      return { ok: true, snippet: null };
    });

    const first = drainWriteQueue();
    const second = drainWriteQueue();
    expect(second).toBe(first);

    try {
      await Promise.resolve();
      await Promise.resolve();
      // The second call joined the first; neither started a parallel commit.
      expect(mocks.commit).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
    await Promise.all([first, second]);

    // The second drain saw the rate limit record from the first and stopped.
    expect(mocks.commit).toHaveBeenCalledTimes(1);
  });

  it("waits for a retry that is not due yet", async () => {
    mocks.queue = {
      ...emptyQueue(),
      operations: [operation({ nextAttemptAt: 2_000_000 })],
    };

    await drainWriteQueue();

    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("treats an absent stored queue as empty", async () => {
    mocks.queue = null as unknown as QueueState;

    await drainWriteQueue();

    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("does not send while the rate budget is spent", async () => {
    // The gap check in commitOne is the second arm of `!op || !canSend`.
    mocks.queue = {
      ...emptyQueue(),
      operations: [operation()],
      sentAt: [1_000_000],
    };

    await drainWriteQueue();

    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("records a non-Error rejection as its string value", async () => {
    mocks.queue = { ...emptyQueue(), operations: [operation()] };
    mocks.commit.mockRejectedValue("plain failure");

    await drainWriteQueue();

    expect(mocks.queue.operations[0]).toMatchObject({
      error: "plain failure",
      attempts: 1,
      status: "pending",
    });
    expect(mocks.captureError).toHaveBeenCalledWith(
      "plain failure",
      expect.objectContaining({ action: "queue.commit" })
    );
  });

  it("stops when the state did not advance between the loop and commit", async () => {
    // A worker restart or a clock adjustment can make canSend() true at the
    // loop check and false inside commitOne. commitOne returns the same object;
    // without the identity break the drain would spin forever.
    mocks.queue = {
      ...emptyQueue(),
      operations: [operation()],
      sentAt: [1_000_000],
    };
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_003_000)
      .mockReturnValueOnce(1_003_000)
      .mockReturnValueOnce(1_000_500)
      .mockReturnValue(1_000_000);

    await drainWriteQueue();

    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
