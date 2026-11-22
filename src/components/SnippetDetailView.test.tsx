/**
 * Tests for the autosaving editor.
 *
 * Every assertion below is about a decision the component owns: when to stage
 * an edit, when to enqueue it, what undo actually restores, and which failure is
 * shown. The editor itself is replaced with a textarea because happy-dom cannot
 * drive Plate, and the queue functions are mocked so a rendering test never
 * writes to extension storage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SnippetDetailView from "./SnippetDetailView";
import type { Snippet } from "@/types";
import type { EditorFields } from "@/lib/snippet-draft";
import { undoAvailabilityStore, writeQueueStore } from "@/store/write-queue";
import { resetSnippetsStoreForTests, snippetsStore } from "@/store/snippets";

const q = vi.hoisted(() => ({
  stageEdit: vi.fn<typeof import("@/store/write-queue").stageEdit>(),
  flushDraft: vi.fn<typeof import("@/store/write-queue").flushDraft>(),
  undoLastEdit: vi.fn<typeof import("@/store/write-queue").undoLastEdit>(),
  redoLastEdit: vi.fn<typeof import("@/store/write-queue").redoLastEdit>(),
  discardUnflushedDraft:
    vi.fn<typeof import("@/store/write-queue").discardUnflushedDraft>(),
  refreshSyncStatus:
    vi.fn<typeof import("@/store/write-queue").refreshSyncStatus>(),
  refreshUndoAvailability:
    vi.fn<typeof import("@/store/write-queue").refreshUndoAvailability>(),
}));

vi.mock("@/store/write-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/write-queue")>();
  return {
    ...actual,
    stageEdit: q.stageEdit,
    flushDraft: q.flushDraft,
    undoLastEdit: q.undoLastEdit,
    redoLastEdit: q.redoLastEdit,
    discardUnflushedDraft: q.discardUnflushedDraft,
    refreshSyncStatus: q.refreshSyncStatus,
    refreshUndoAvailability: q.refreshUndoAvailability,
  };
});

vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }));
import { captureError } from "@/lib/sentry";
import { SnippetWriteRefused } from "@/store/snippets";

vi.mock("@/lib/copy-markdown-as-rich-text", () => ({
  copyMarkdownAsRichText: vi.fn(),
}));
import { copyMarkdownAsRichText } from "@/lib/copy-markdown-as-rich-text";

vi.mock("@/storage/usage-tracking", () => ({
  getSnippetUsageCount: vi.fn(),
  incrementSnippetUsage: vi.fn(),
}));
import {
  getSnippetUsageCount,
  incrementSnippetUsage,
} from "@/storage/usage-tracking";

const editorCalls = vi.hoisted(() => ({ openCommandMenu: vi.fn() }));

vi.mock("@/components/editor", async () => {
  const React = await import("react");
  type Props = {
    value: string;
    onChange: (next: string) => void;
    onCopyError?: () => void;
    ariaLabel?: string;
  };
  const RichTextEditor = React.forwardRef(function RichTextEditor(
    { value, onChange, onCopyError, ariaLabel }: Props,
    ref: React.Ref<{ openCommandMenu: () => void }>
  ) {
    React.useImperativeHandle(ref, () => ({
      openCommandMenu: editorCalls.openCommandMenu,
    }));
    return (
      <div>
        <textarea
          aria-label={ariaLabel ?? "Content"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" onClick={() => onCopyError?.()}>
          simulate editor copy failure
        </button>
      </div>
    );
  });
  return { RichTextEditor };
});

const onDelete = vi.fn();
const onUndoDelete = vi.fn();
const onToggleSidebar = vi.fn();

const snippet: Snippet = {
  id: "s1",
  label: "Address",
  shortcut: "/addr",
  content: "123 Fake Street",
  tags: ["personal"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  rev: 1,
} as Snippet;

const fields: EditorFields = {
  label: snippet.label,
  shortcut: snippet.shortcut,
  content: snippet.content,
  tags: snippet.tags,
};

function renderView(
  props: Partial<React.ComponentProps<typeof SnippetDetailView>> = {}
) {
  return render(
    <SnippetDetailView
      snippet={snippet}
      onDelete={onDelete}
      onUndoDelete={onUndoDelete}
      onToggleSidebar={onToggleSidebar}
      {...props}
    />
  );
}

const AUTOSAVE_DELAY = 600;

describe("SnippetDetailView autosave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The stores are module singletons: a prior test's queue state must not
    // decide whether this test starts with Undo enabled.
    writeQueueStore.setState(() => ({ pending: 0, failed: 0, refused: 0 }));
    undoAvailabilityStore.setState(() => ({
      snippetId: null,
      canUndo: false,
      canRedo: false,
    }));
    resetSnippetsStoreForTests();
    snippetsStore.setState((prev) => ({ ...prev, snippets: [snippet] }));
    vi.mocked(getSnippetUsageCount).mockResolvedValue(3);
    vi.mocked(incrementSnippetUsage).mockResolvedValue(4);
    vi.mocked(copyMarkdownAsRichText).mockResolvedValue(undefined);
    onDelete.mockResolvedValue(undefined);
    q.flushDraft.mockResolvedValue({ ok: true });
    q.undoLastEdit.mockResolvedValue({ ok: false, fields: null });
    q.redoLastEdit.mockResolvedValue({ ok: false, fields: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- display ---------------------------------------------------------

  it("renders the snippet content, tags and usage count", async () => {
    renderView();

    expect(screen.getByRole("textbox", { name: /content/i })).toHaveValue(
      snippet.content
    );
    expect(screen.getByText("personal")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("3", { exact: true })).toBeInTheDocument()
    );
  });

  it("keeps working when the usage count cannot be read", async () => {
    vi.mocked(getSnippetUsageCount).mockRejectedValue(new Error("unavailable"));
    renderView();

    expect(
      await screen.findByRole("button", { name: /delete snippet/i })
    ).toBeEnabled();
    expect(captureError).toHaveBeenCalled();
  });

  // --- staging ----------------------------------------------------------

  it("does not stage anything on mount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderView();

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY * 2);

    // An autosave that fires on mount bumps the revision of a snippet nobody
    // touched, and records a history snapshot that cannot be explained.
    expect(q.stageEdit).not.toHaveBeenCalled();
  });

  it("stages the newest fields once a content burst settles", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderView();

    await user.click(screen.getByRole("textbox", { name: /content/i }));
    await user.keyboard("!");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY - 100);
    await user.keyboard("!");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY);

    expect(q.stageEdit).toHaveBeenCalledTimes(1);
    expect(q.stageEdit.mock.calls[0]![1]).toMatchObject({
      content: "123 Fake Street!!",
      tags: ["personal"],
    });
  });

  it("enqueues a staged edit when the pane closes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = renderView();

    await user.click(
      screen.getByRole("button", { name: /remove "personal"/i })
    );
    // The debounce is still pending when the popup would disappear.
    expect(q.flushDraft).not.toHaveBeenCalled();
    unmount();
    await vi.advanceTimersByTimeAsync(0);

    expect(q.flushDraft).toHaveBeenCalledTimes(1);
  });

  it("reports a validation failure from the queue", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    q.flushDraft.mockResolvedValue({ ok: false, error: "emptyContent" });
    renderView();

    await user.click(
      screen.getByRole("button", { name: /remove "personal"/i })
    );
    // Validation is reported when the queued draft is flushed, which is what a
    // popup blur does. The debounce need not elapse first.
    window.dispatchEvent(new Event("pagehide"));
    await waitFor(() =>
      expect(
        screen.getByText("A snippet needs content before it can be saved.")
      ).toBeInTheDocument()
    );
    // The message is shown, not filed as an exception.
    expect(captureError).not.toHaveBeenCalled();
  });

  // --- undo / redo ------------------------------------------------------

  it("starts with undo and redo disabled", () => {
    renderView();

    expect(screen.getByTestId("snippet-undo")).toBeDisabled();
    expect(screen.getByTestId("snippet-redo")).toBeDisabled();
  });

  it("enables undo after an edit is staged", async () => {
    const { undoAvailabilityStore } = await import("@/store/write-queue");
    undoAvailabilityStore.setState(() => ({
      snippetId: "s1",
      canUndo: true,
      canRedo: false,
    }));
    renderView();

    expect(screen.getByTestId("snippet-undo")).toBeEnabled();
    expect(screen.getByTestId("snippet-redo")).toBeDisabled();
  });

  it("undoes to the fields returned by the queue", async () => {
    const { undoAvailabilityStore } = await import("@/store/write-queue");
    undoAvailabilityStore.setState(() => ({
      snippetId: "s1",
      canUndo: true,
      canRedo: false,
    }));
    const restored: EditorFields = { ...fields, content: "before" };
    q.undoLastEdit.mockResolvedValue({ ok: true, fields: restored });
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByTestId("snippet-undo"));

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /content/i })).toHaveValue(
        "before"
      )
    );
    expect(q.discardUnflushedDraft).toHaveBeenCalledWith("s1");
    expect(q.undoLastEdit.mock.calls[0]![1]).toMatchObject(fields);
  });

  it("redoes through the same queue path", async () => {
    const { undoAvailabilityStore } = await import("@/store/write-queue");
    undoAvailabilityStore.setState(() => ({
      snippetId: "s1",
      canUndo: false,
      canRedo: true,
    }));
    q.redoLastEdit.mockResolvedValue({
      ok: true,
      fields: { ...fields, content: "after" },
    });
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByTestId("snippet-redo"));

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /content/i })).toHaveValue(
        "after"
      )
    );
    expect(q.redoLastEdit).toHaveBeenCalledTimes(1);
  });

  it("supports the keyboard shortcut for undo", async () => {
    const { undoAvailabilityStore } = await import("@/store/write-queue");
    undoAvailabilityStore.setState(() => ({
      snippetId: "s1",
      canUndo: true,
      canRedo: false,
    }));
    q.undoLastEdit.mockResolvedValue({
      ok: true,
      fields: { ...fields, content: "before" },
    });
    const user = userEvent.setup();
    renderView();

    // The shortcut is handled on the editor pane, so the key event must start
    // inside it rather than on `document.body`.
    await user.click(screen.getByRole("textbox", { name: /content/i }));
    await user.keyboard("{Control>}z{/Control}");

    await waitFor(() => expect(q.undoLastEdit).toHaveBeenCalledTimes(1));
  });

  // --- sync status ------------------------------------------------------

  it("shows a compact saved status when the queue is empty", () => {
    renderView();

    expect(screen.getByTestId("snippet-sync-status")).toHaveTextContent(
      "All changes saved"
    );
  });

  it("surfaces a refusal rather than claiming success", async () => {
    const { writeQueueStore } = await import("@/store/write-queue");
    writeQueueStore.setState(() => ({
      pending: 0,
      failed: 0,
      refused: 1,
      lastError: "sync is full",
    }));
    renderView();

    expect(screen.getByTestId("snippet-sync-status")).toHaveTextContent(
      "Storage full"
    );
  });

  // --- delete -----------------------------------------------------------

  it("does not delete until the dialog is confirmed", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByTestId("snippet-delete"));

    expect(onDelete).not.toHaveBeenCalled();
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("deletes and offers an undo after confirmation", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByTestId("snippet-delete"));
    await user.click(await screen.findByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("s1"));
    expect(onUndoDelete).toHaveBeenCalledWith(snippet);
  });

  it("does not delete when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByTestId("snippet-delete"));
    await user.click(await screen.findByRole("button", { name: /cancel/i }));

    expect(onDelete).not.toHaveBeenCalled();
  });

  it("surfaces a delete failure", async () => {
    const user = userEvent.setup();
    onDelete.mockRejectedValue(new Error("denied"));
    renderView();

    await user.click(screen.getByTestId("snippet-delete"));
    await user.click(await screen.findByRole("button", { name: /^delete$/i }));

    expect(
      await screen.findByText("Failed to delete snippet. Please try again.")
    ).toBeInTheDocument();
  });

  it("shows the store's quota explanation without reporting it", async () => {
    const user = userEvent.setup();
    onDelete.mockRejectedValue(
      new SnippetWriteRefused(
        "This snippet is 210.5 KB and sync allows 100.0 KB."
      )
    );
    renderView();

    await user.click(screen.getByTestId("snippet-delete"));
    await user.click(await screen.findByRole("button", { name: /^delete$/i }));

    expect(
      await screen.findByText(
        "This snippet is 210.5 KB and sync allows 100.0 KB."
      )
    ).toBeInTheDocument();
    expect(captureError).not.toHaveBeenCalled();
  });

  // --- tags and copy ----------------------------------------------------

  it("adds a tag on Enter and does not duplicate it", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: /add tag/i }));
    await user.type(screen.getByPlaceholderText(/tag/i), "Work{Enter}");
    expect(await screen.findByText("work")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /add tag/i }));
    await user.type(screen.getByPlaceholderText(/tag/i), "work{Enter}");
    expect(screen.getAllByText("work")).toHaveLength(1);
  });

  it("closes the tag input on Escape without adding the tag", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: /add tag/i }));
    await user.type(screen.getByPlaceholderText(/tag/i), "discarded{Escape}");

    expect(screen.queryByText("discarded")).not.toBeInTheDocument();
  });

  it("commits a typed tag when the input loses focus", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: /add tag/i }));
    await user.type(screen.getByPlaceholderText(/tag/i), "Work");
    await user.tab();

    expect(await screen.findByText("work")).toBeInTheDocument();
  });

  it("increments usage after a successful copy", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByTestId("snippet-copy"));

    await waitFor(() =>
      expect(incrementSnippetUsage).toHaveBeenCalledWith("s1")
    );
  });

  it("shows a copy failure and clears it on dismiss", async () => {
    const user = userEvent.setup();
    vi.mocked(copyMarkdownAsRichText).mockRejectedValue(new Error("blocked"));
    renderView();

    await user.click(screen.getByTestId("snippet-copy"));
    expect(
      await screen.findByText("Failed to copy to clipboard")
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(
      screen.queryByText("Failed to copy to clipboard")
    ).not.toBeInTheDocument();
  });

  it("reaches the editor command menu from the insert button", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: /insert command/i }));

    expect(editorCalls.openCommandMenu).toHaveBeenCalledTimes(1);
  });

  it("resets local fields when a different snippet is selected", async () => {
    const other: Snippet = {
      ...snippet,
      id: "other",
      content: "other body",
      tags: ["work"],
    };
    const user = userEvent.setup();
    const { rerender } = renderView();

    await user.click(
      screen.getByRole("button", { name: /remove "personal"/i })
    );
    rerender(
      <SnippetDetailView
        snippet={other}
        onDelete={onDelete}
        onUndoDelete={onUndoDelete}
        onToggleSidebar={onToggleSidebar}
      />
    );

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /content/i })).toHaveValue(
        "other body"
      )
    );
    expect(screen.getByText("work")).toBeInTheDocument();
    expect(screen.queryByText("personal")).not.toBeInTheDocument();
  });

  it("renders a snippet whose tags are missing entirely", async () => {
    renderView({ snippet: { ...snippet, tags: undefined } as Snippet });

    expect(
      await screen.findByRole("button", { name: /delete snippet/i })
    ).toBeEnabled();
  });
});
