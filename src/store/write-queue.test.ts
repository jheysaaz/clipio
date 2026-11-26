import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Snippet } from "@/types";
import type { DraftMap } from "@/lib/snippet-draft";
import type { QueueState } from "@/lib/write-queue";
import type { UndoStacks } from "@/lib/undo-stack";
import { fieldsFromSnippet } from "@/lib/snippet-draft";
import { emptyQueue } from "@/lib/write-queue";

const state = vi.hoisted(() => ({
  drafts: {} as DraftMap,
  queue: null as QueueState | null,
  undo: {} as UndoStacks,
  draftWatch: null as (() => void) | null,
  queueWatch: null as (() => void) | null,
}));

vi.mock("@/storage/items", () => ({
  editorDraftsItem: {
    getValue: vi.fn(async () => state.drafts),
    setValue: vi.fn(async (value: DraftMap) => {
      state.drafts = value;
    }),
    watch: vi.fn((callback: () => void) => {
      state.draftWatch = callback;
      return () => {
        state.draftWatch = null;
      };
    }),
  },
  writeQueueItem: {
    getValue: vi.fn(async () => state.queue),
    setValue: vi.fn(async (value: QueueState) => {
      state.queue = value;
    }),
    watch: vi.fn((callback: () => void) => {
      state.queueWatch = callback;
      return () => {
        state.queueWatch = null;
      };
    }),
  },
  undoStacksItem: {
    getValue: vi.fn(async () => state.undo),
    setValue: vi.fn(async (value: UndoStacks) => {
      state.undo = value;
    }),
  },
}));

vi.mock("@/storage/writer-id", () => ({
  getWriterId: vi.fn(async () => "writer-1"),
}));

import {
  clearCommittedFields,
  discardDraft,
  discardUnflushedDraft,
  enqueueDelete,
  flushDraft,
  queueOperationsStore,
  queueOutcomesStore,
  refreshSyncStatus,
  refreshUndoAvailability,
  redoLastEdit,
  rememberCommittedFields,
  stageEdit,
  stageProvisionalDraft,
  undoAvailabilityStore,
  undoLastEdit,
  waitForSnippetCommit,
  watchWriteQueueStatus,
  writeQueueStore,
  draftPreviewsStore,
} from "./write-queue";
import {
  emitStorageChange,
  mockStorageOnChanged,
} from "../../tests/mocks/browser";

const snippet: Snippet = {
  id: "s1",
  label: "Old",
  shortcut: "/old",
  content: "old body",
  tags: ["a"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  rev: 3,
  updatedBy: "other",
} as Snippet;

const fields = {
  label: "New",
  shortcut: "/new",
  content: "new body",
  tags: ["b"],
};

function reset() {
  state.drafts = {};
  state.queue = emptyQueue();
  state.undo = {};
  state.draftWatch = null;
  state.queueWatch = null;
  writeQueueStore.setState(() => ({
    pending: 0,
    failed: 0,
    refused: 0,
    saving: false,
  }));
  draftPreviewsStore.setState(() => ({}));
  queueOperationsStore.setState(() => ({}));
  queueOutcomesStore.setState(() => ({}));
  clearCommittedFields();
}

describe("popup write queue", () => {
  beforeEach(reset);

  it("stages an edit without committing it", async () => {
    await stageEdit(snippet, fields);

    expect(state.drafts.s1).toMatchObject({
      id: "s1",
      baseRev: 3,
      isNew: false,
      fields,
    });
    // The queue is the background's authority: staging must not enqueue yet.
    expect(state.queue?.operations).toHaveLength(0);
  });

  it("publishes the staged fields as a live preview and a saving status", async () => {
    await stageEdit(snippet, fields);

    expect(draftPreviewsStore.state.s1).toEqual(fields);
    expect(writeQueueStore.state.saving).toBe(true);
  });

  it("keeps the live preview after a commit but stops claiming it is saving", async () => {
    await stageEdit(snippet, fields);
    await flushDraft("s1", []);
    // The background removes only the draft it committed, then the queue change
    // re-publishes status. The preview stays: our own commit is not a refresh.
    state.drafts = {};
    await refreshSyncStatus();

    expect(writeQueueStore.state.saving).toBe(false);
    expect(draftPreviewsStore.state.s1).toEqual(fields);
  });

  it("leaves Saving when the background clears the staged draft", async () => {
    await stageEdit(snippet, fields);
    expect(writeQueueStore.state.saving).toBe(true);

    const stop = watchWriteQueueStatus();
    // The background deletes only the draft it committed, then drains the queue.
    // The popup must react to that write instead of waiting for another keystroke.
    state.drafts = {};
    state.queue = emptyQueue();
    state.draftWatch?.();

    await vi.waitFor(() => expect(writeQueueStore.state.saving).toBe(false));
    // Only the status changes; the sidebar still shows what the user typed.
    expect(draftPreviewsStore.state.s1).toEqual(fields);

    stop();
    expect(state.draftWatch).toBeNull();
  });

  it("does not claim Saving for a draft left by an earlier popup", async () => {
    // A draft recovered on mount was staged by a document that may have closed
    // before enqueuing. Adopting it into stagedDraftIds pins the toolbar to
    // Saving… forever because no queued operation will ever release it.
    state.drafts = {
      s1: {
        id: "s1",
        baseRev: 3,
        isNew: false,
        updatedAt: "2026-01-02T00:00:00.000Z",
        fields,
      },
    };
    await refreshSyncStatus();
    expect(writeQueueStore.state.saving).toBe(false);

    await stageEdit(snippet, fields);
    expect(writeQueueStore.state.saving).toBe(true);

    // Only this document's staged id retires when its draft is cleared.
    state.drafts = {};
    await refreshSyncStatus();
    expect(writeQueueStore.state.saving).toBe(false);
  });

  it("remembers the previous fields so undo has a target", async () => {
    await stageEdit(snippet, fields);

    expect(state.undo.s1.past).toEqual([fieldsFromSnippet(snippet)]);
    expect(
      undoAvailabilityStore.state.snippetId === "s1" &&
        undoAvailabilityStore.state.canUndo
    ).toBe(true);
  });

  it("flushes a valid draft into exactly one queued operation", async () => {
    await stageEdit(snippet, fields);
    const draft = state.drafts.s1!;
    const result = await flushDraft("s1", [], "2026-01-02T00:00:00.000Z");

    expect(result).toEqual({ ok: true, isNew: false });
    expect(state.queue?.operations).toHaveLength(1);
    expect(state.queue?.operations[0]).toMatchObject({
      kind: "upsert",
      snippetId: "s1",
      baseRev: 3,
      reason: "edit",
      updatedBy: "writer-1",
      updatedAt: "2026-01-02T00:00:00.000Z",
      draftUpdatedAt: draft.updatedAt,
    });
    // The draft survives until the background knows the outcome, so a quota
    // refusal or conflict can be fixed without retyping the edit.
    expect(state.drafts.s1).toEqual(draft);
  });

  it("keeps an invalid draft local and does not queue it", async () => {
    await stageEdit(snippet, { ...fields, label: "   " });

    const result = await flushDraft("s1", []);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("emptyLabel");
    expect(state.queue?.operations).toHaveLength(0);
    expect(state.drafts.s1).toBeDefined();
  });

  it("publishes the queue summary to the sync-status store", async () => {
    await stageProvisionalDraft("new-id", {
      label: "New",
      shortcut: "/new",
      content: "body",
      tags: [],
    });
    await flushDraft("new-id", []);

    await refreshSyncStatus();

    expect(writeQueueStore.state.pending).toBe(1);
    expect(writeQueueStore.state.failed).toBe(0);
  });

  it("stages a new snippet with a caller-chosen provisional id", async () => {
    const draft = await stageProvisionalDraft("new-id", {
      label: "New",
      shortcut: "/new",
      content: "body",
      tags: [],
    });

    expect(draft).toMatchObject({ id: "new-id", baseRev: 0, isNew: true });
    expect(state.drafts["new-id"]).toEqual(draft);
  });

  it("undoes the last staged edit through the restore queue", async () => {
    await stageEdit(snippet, fields);
    const before = fieldsFromSnippet(snippet);

    const ok = await undoLastEdit(snippet, fields);

    expect(ok.ok).toBe(true);
    expect(state.queue?.operations[0]).toMatchObject({
      snippetId: "s1",
      baseRev: 3,
      reason: "restore",
      fields: before,
    });
    expect(undoAvailabilityStore.state.canRedo).toBe(true);
  });

  it("does not enqueue anything when there is nothing to undo", async () => {
    const ok = await undoLastEdit(snippet, fields);

    expect(ok.ok).toBe(false);
    expect(state.queue?.operations).toHaveLength(0);
  });

  it("redoes the state that was undone", async () => {
    await stageEdit(snippet, fields);
    await undoLastEdit(snippet, fields);

    const ok = await redoLastEdit(snippet, fieldsFromSnippet(snippet));

    expect(ok.ok).toBe(true);
    // Restore is coalesced with the pending undo for the same snippet.
    expect(state.queue?.operations[0]).toMatchObject({
      reason: "restore",
      fields,
    });
    expect(undoAvailabilityStore.state.canRedo).toBe(false);
  });

  it("clears draft, undo state and refusal when a snippet is discarded", async () => {
    await stageEdit(snippet, fields);
    state.queue = {
      operations: [
        {
          id: "op-refused",
          snippetId: "s1",
          kind: "upsert",
          fields,
          baseRev: 3,
          updatedAt: "2026-01-02T00:00:00.000Z",
          updatedBy: "writer-1",
          reason: "edit",
          attempts: 0,
          nextAttemptAt: 1,
          status: "refused",
          error: "quota",
          createdAt: 1,
        },
      ],
      sentAt: [],
    };

    await discardDraft("s1");

    expect(state.drafts.s1).toBeUndefined();
    expect(state.undo.s1).toBeUndefined();
    expect(state.queue?.operations).toHaveLength(0);
    await refreshUndoAvailability("s1");
    expect(undoAvailabilityStore.state.canUndo).toBe(false);
  });

  it("drops a pending draft without clearing the undo history", async () => {
    // Undo starts by discarding whatever was typed after the committed edit.
    // Clearing the stack here would make every Undo button a no-op.
    await stageEdit(snippet, fields);
    await discardUnflushedDraft("s1");

    expect(state.drafts.s1).toBeUndefined();
    expect(state.undo.s1).toBeDefined();
    const ok = await undoLastEdit(snippet, fieldsFromSnippet(snippet));
    expect(ok.ok).toBe(true);
  });

  it("reports no undo controls when no snippet is selected", async () => {
    await refreshUndoAvailability(null);

    expect(undoAvailabilityStore.state).toEqual({
      snippetId: null,
      canUndo: false,
      canRedo: false,
    });
  });

  it("treats a flush with no staged draft as a successful no-op", async () => {
    expect(await flushDraft("missing", [])).toEqual({ ok: true });
    expect(state.queue?.operations).toHaveLength(0);
  });

  it("falls back to an empty queue when the stored value is absent", async () => {
    state.queue = null as unknown as QueueState;
    await stageEdit(snippet, fields);

    expect((await flushDraft("s1", [])).ok).toBe(true);
    expect(state.queue?.operations).toHaveLength(1);
  });

  it("keeps a provisional create draft on the id the caller chose", async () => {
    const draft = await stageProvisionalDraft("new-id", {
      label: "New",
      shortcut: "/new",
      content: "body",
      tags: [],
    });

    expect(draft).toMatchObject({ id: "new-id", baseRev: 0, isNew: true });
    expect(state.drafts["new-id"]).toEqual(draft);
  });

  it("treats missing undo stacks as empty when staging an edit", async () => {
    state.undo = null as unknown as UndoStacks;

    await stageEdit(snippet, fields);

    expect(state.undo.s1.past).toEqual([fieldsFromSnippet(snippet)]);
  });

  it("has nothing to undo when the stored stacks are absent", async () => {
    state.undo = null as unknown as UndoStacks;

    expect((await undoLastEdit(snippet, fields)).ok).toBe(false);
    expect(state.queue?.operations).toHaveLength(0);
  });

  it("has nothing to redo when the stored stacks are absent", async () => {
    state.undo = null as unknown as UndoStacks;

    expect((await redoLastEdit(snippet, fields)).ok).toBe(false);
    expect(state.queue?.operations).toHaveLength(0);
  });

  it("drops an unflushed draft even when none exists", async () => {
    await discardUnflushedDraft("missing");

    expect(state.drafts).toEqual({});
    expect(state.queue?.operations).toHaveLength(0);
  });

  it("clears missing undo stacks when discarding a snippet", async () => {
    state.undo = null as unknown as UndoStacks;

    await discardDraft("s1");

    expect(state.undo).toEqual({});
  });

  it("queues a delete with the default timestamp and local writer id", async () => {
    await enqueueDelete(snippet);

    expect(state.queue?.operations[0]).toMatchObject({
      snippetId: "s1",
      kind: "delete",
      reason: "delete",
      updatedBy: "writer-1",
    });
    expect(state.queue?.operations[0].updatedAt).toEqual(expect.any(String));
  });

  it("refreshes the status when the background writes the queue locally", async () => {
    state.queue = {
      operations: [
        {
          id: "op-refused",
          snippetId: "s1",
          kind: "upsert",
          fields,
          baseRev: 3,
          updatedAt: "2026-01-02T00:00:00.000Z",
          updatedBy: "writer-1",
          reason: "edit",
          attempts: 0,
          nextAttemptAt: 1,
          status: "refused",
          error: "quota",
          createdAt: 1,
        },
      ],
      sentAt: [],
    };

    emitStorageChange(
      { writeQueue: { oldValue: null, newValue: state.queue } },
      "local"
    );

    await vi.waitFor(() => expect(writeQueueStore.state.refused).toBe(1));
    expect(queueOutcomesStore.state.s1).toMatchObject({
      opId: "op-refused",
      status: "refused",
      error: "quota",
    });
  });

  it("ignores storage changes outside the local queue key", () => {
    writeQueueStore.setState(() => ({
      pending: 9,
      failed: 0,
      refused: 0,
      saving: false,
    }));

    emitStorageChange({ other: { oldValue: undefined, newValue: 1 } }, "sync");

    expect(writeQueueStore.state.pending).toBe(9);
  });

  it("steps undo through editor states, not the authoritative record", async () => {
    await stageEdit(snippet, fields);
    const later = { ...fields, label: "Later" };
    await stageEdit(snippet, later);

    expect(state.undo.s1.past).toEqual([fieldsFromSnippet(snippet), fields]);
  });

  it("uses remembered committed fields as the first undo target", async () => {
    const committed = { ...fieldsFromSnippet(snippet), label: "Committed" };
    rememberCommittedFields("s1", committed);

    await stageEdit(snippet, fields);

    expect(state.undo.s1.past).toEqual([committed]);
  });

  it("waits for a queued snippet to leave the queue before reporting success", async () => {
    await stageEdit(snippet, fields);
    await flushDraft("s1", []);

    const pending = waitForSnippetCommit("s1");
    queueOperationsStore.setState(() => ({}));

    await expect(pending).resolves.toBeNull();
  });

  it("waits for a terminal outcome before reporting failure", async () => {
    await stageEdit(snippet, fields);
    await flushDraft("s1", []);

    const pending = waitForSnippetCommit("s1");
    queueOutcomesStore.setState(() => ({
      s1: {
        opId: "op-1",
        snippetId: "s1",
        status: "refused",
        error: "quota",
      },
    }));

    await expect(pending).resolves.toMatchObject({
      status: "refused",
      error: "quota",
    });
  });

  it("keeps both operations when two snippets flush concurrently", async () => {
    await stageEdit(snippet, fields);
    await stageEdit({ ...snippet, id: "s2" }, fields);

    await Promise.all([flushDraft("s1", []), flushDraft("s2", [])]);

    expect(state.queue?.operations.map((op) => op.snippetId).sort()).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("does not subscribe to storage changes when no browser API exists", async () => {
    const before = mockStorageOnChanged.addListener.mock.calls.length;
    vi.stubGlobal("browser", undefined);
    vi.resetModules();
    try {
      await import("./write-queue");
      expect(mockStorageOnChanged.addListener.mock.calls.length).toBe(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
