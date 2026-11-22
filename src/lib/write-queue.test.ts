import { describe, it, expect } from "vitest";
import {
  QUEUE_POLICY,
  canSend,
  clearRefused,
  emptyQueue,
  enqueue,
  nextDueOperation,
  queueSummary,
  recordResult,
  recordSend,
  type QueuePolicy,
  type QueueState,
} from "./write-queue";

function change(overrides: Partial<Parameters<typeof enqueue>[1]> = {}) {
  return {
    id: "op1",
    snippetId: "s1",
    kind: "upsert" as const,
    fields: { label: "L", content: "c", shortcut: "/l", tags: ["a"] },
    baseRev: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "device-a",
    reason: "edit" as const,
    createdAt: 1000,
    ...overrides,
  };
}

const policy = (overrides: Partial<QueuePolicy> = {}): QueuePolicy => ({
  ...QUEUE_POLICY,
  ...overrides,
});

describe("rate limiting", () => {
  it("allows the first write", () => {
    expect(canSend(emptyQueue(), 1000)).toBe(true);
  });

  it("refuses a write before the minimum gap", () => {
    const state = recordSend(emptyQueue(), 1000);
    expect(canSend(state, 2999)).toBe(false);
    expect(canSend(state, 3000)).toBe(true);
  });

  it("refuses the twenty-first write inside a minute", () => {
    let state = emptyQueue();
    for (let i = 0; i < 20; i++) {
      state = recordSend(state, 1000 + i * 2_000);
    }
    expect(canSend(state, 1000 + 20 * 2_000)).toBe(false);
  });

  it("refuses the six-hundred-first write inside an hour", () => {
    let state = emptyQueue();
    for (let i = 0; i < 600; i++) {
      state = { ...state, sentAt: [0, ...state.sentAt, 1000 + i] };
    }
    expect(canSend(state, 1_000 + 600, policy({ perMinute: 1_000 }))).toBe(
      false
    );
  });

  it("prunes timestamps older than an hour when recording a send", () => {
    const state: QueueState = {
      operations: [],
      sentAt: [0, 3_600_001],
    };
    expect(recordSend(state, 3_600_002).sentAt).not.toContain(0);
  });
});

describe("enqueue", () => {
  it("adds a pending operation due immediately", () => {
    const state = enqueue(emptyQueue(), change(), 1000);
    expect(state.operations).toHaveLength(1);
    expect(state.operations[0]).toMatchObject({
      status: "pending",
      attempts: 0,
      nextAttemptAt: 1000,
    });
  });

  it("coalesces edits to one snippet, keeping the first base revision", () => {
    let state = enqueue(emptyQueue(), change({ id: "op1", baseRev: 1 }), 1000);
    state = enqueue(
      state,
      change({
        id: "op2",
        baseRev: 3,
        createdAt: 2000,
        fields: { label: "New", content: "new", shortcut: "/new", tags: [] },
      }),
      2000
    );
    expect(state.operations).toHaveLength(1);
    expect(state.operations[0]).toMatchObject({
      id: "op1",
      baseRev: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(state.operations[0]?.fields?.label).toBe("New");
  });

  it("does not overwrite a quota refusal for the same snippet", () => {
    let state = enqueue(emptyQueue(), change(), 1000);
    state = recordResult(
      state,
      "op1",
      {
        ok: false,
        quota: true,
        error: "quota",
      },
      1100
    );
    state = enqueue(state, change({ id: "op2" }), 2000);
    expect(state.operations).toHaveLength(2);
    expect(state.operations.find((o) => o.status === "refused")?.error).toBe(
      "quota"
    );
  });

  it("copies tags so a later draft mutation cannot change the queue", () => {
    const fields = { label: "L", content: "c", shortcut: "/l", tags: ["a"] };
    const state = enqueue(emptyQueue(), change({ fields }), 1000);
    fields.tags.push("b");
    expect(state.operations[0]?.fields?.tags).toEqual(["a"]);
  });
});

describe("nextDueOperation", () => {
  it("returns null when nothing is due", () => {
    const state = enqueue(emptyQueue(), change(), 1000);
    expect(nextDueOperation(state, 999)).toBeNull();
  });

  it("ignores failed and refused operations", () => {
    let state = enqueue(emptyQueue(), change(), 1000);
    state = recordResult(
      state,
      "op1",
      {
        ok: false,
        quota: true,
        error: "quota",
      },
      1000
    );
    expect(nextDueOperation(state, 10_000)).toBeNull();
  });

  it("returns the oldest due operation", () => {
    let state = enqueue(
      emptyQueue(),
      change({ id: "op1", snippetId: "s1", createdAt: 1000 }),
      1000
    );
    state = enqueue(
      state,
      change({ id: "op2", snippetId: "s2", createdAt: 2000 }),
      2000
    );
    expect(nextDueOperation(state, 3000)?.id).toBe("op1");
  });
});

describe("recordResult", () => {
  it("ignores an unknown operation id", () => {
    const state = enqueue(emptyQueue(), change(), 1000);
    expect(recordResult(state, "ghost", { ok: true }, 1000)).toBe(state);
  });

  it("removes a successful operation", () => {
    let state = enqueue(emptyQueue(), change(), 1000);
    state = recordResult(state, "op1", { ok: true }, 1000);
    expect(state.operations).toHaveLength(0);
  });

  it("clears an earlier refusal when a later edit succeeds", () => {
    let state = enqueue(emptyQueue(), change({ id: "op1" }), 1000);
    state = recordResult(
      state,
      "op1",
      {
        ok: false,
        quota: true,
        error: "quota",
      },
      1000
    );
    state = enqueue(state, change({ id: "op2" }), 2000);
    state = recordResult(state, "op2", { ok: true }, 2000);
    expect(state.operations).toHaveLength(0);
  });

  it("marks a quota refusal terminal and keeps the error", () => {
    let state = enqueue(emptyQueue(), change(), 1000);
    state = recordResult(
      state,
      "op1",
      {
        ok: false,
        quota: true,
        error: "Sync storage is full",
      },
      1000
    );
    expect(state.operations[0]).toMatchObject({
      status: "refused",
      error: "Sync storage is full",
    });
  });

  it("retries a transient rejection with backoff and jitter", () => {
    let state = enqueue(emptyQueue(), change(), 1000);
    state = recordResult(
      state,
      "op1",
      { ok: false, quota: false, error: "network" },
      1000,
      () => 0.5,
      policy({ baseBackoffMs: 1000, jitterRatio: 0.25 })
    );
    expect(state.operations[0]).toMatchObject({
      status: "pending",
      attempts: 1,
      nextAttemptAt: 2000 + 125,
    });
    expect(nextDueOperation(state, 2000)).toBeNull();
    expect(nextDueOperation(state, 2200)?.id).toBe("op1");
  });

  it("marks a stale conflict terminal without retrying", () => {
    let state = enqueue(emptyQueue(), change(), 1000);
    state = recordResult(
      state,
      "op1",
      {
        ok: false,
        quota: false,
        conflict: true,
        error: "conflict",
      },
      1000
    );
    expect(state.operations[0]).toMatchObject({
      status: "failed",
      attempts: 0,
    });
    expect(nextDueOperation(state, 100_000)).toBeNull();
  });

  it("stops retrying after the attempt limit", () => {
    let state = enqueue(emptyQueue(), change(), 1000);
    const short = policy({ maxAttempts: 2 });
    state = recordResult(
      state,
      "op1",
      {
        ok: false,
        quota: false,
        error: "network",
      },
      1000,
      () => 0,
      short
    );
    state = recordResult(
      state,
      "op1",
      {
        ok: false,
        quota: false,
        error: "network",
      },
      2000,
      () => 0,
      short
    );
    expect(state.operations[0]).toMatchObject({
      status: "failed",
      attempts: 2,
    });
    expect(nextDueOperation(state, 100_000)).toBeNull();
  });
});

describe("queue state helpers", () => {
  it("counts pending, failed and refused operations", () => {
    let state = enqueue(emptyQueue(), change({ id: "a", snippetId: "s1" }), 1);
    state = enqueue(state, change({ id: "b", snippetId: "s2" }), 2);
    state = enqueue(state, change({ id: "c", snippetId: "s3" }), 3);
    state = recordResult(
      state,
      "b",
      {
        ok: false,
        quota: false,
        error: "network",
      },
      4,
      () => 0,
      policy({ maxAttempts: 1 })
    );
    state = recordResult(
      state,
      "c",
      {
        ok: false,
        quota: true,
        error: "quota",
      },
      5
    );
    expect(queueSummary(state)).toEqual({ pending: 1, failed: 1, refused: 1 });
  });

  it("clears only the named snippet's refusal", () => {
    let state = enqueue(emptyQueue(), change({ id: "a", snippetId: "s1" }), 1);
    state = enqueue(state, change({ id: "b", snippetId: "s2" }), 2);
    state = recordResult(
      state,
      "a",
      {
        ok: false,
        quota: true,
        error: "quota",
      },
      3
    );
    state = recordResult(
      state,
      "b",
      {
        ok: false,
        quota: true,
        error: "quota",
      },
      4
    );
    const cleared = clearRefused(state, "s1");
    expect(cleared.operations.map((o) => o.snippetId)).toEqual(["s2"]);
  });
});
