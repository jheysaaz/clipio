/**
 * Tests for the one data-driven editor.
 *
 * Both saved snippets and empty drafts render through the same toolbar, title,
 * editor and footer. These tests pin the state decisions that differ: what may
 * be disabled, when a draft is staged, which shortcut value is persisted, and
 * which failure is shown where.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import SnippetEditor from "./SnippetEditor";
import type { Snippet, SnippetFormData } from "@/types";
import type { EditorFields } from "@/lib/snippet-draft";
import {
  queueOutcomesStore,
  undoAvailabilityStore,
  writeQueueStore,
} from "@/store/write-queue";
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

vi.mock("@/components/editor", async () => {
  const React = await import("react");
  type Props = {
    value: string;
    onChange: (next: string) => void;
    onCopyError?: () => void;
    ariaLabel?: string;
    placeholder?: string;
  };
  const RichTextEditor = React.forwardRef(function RichTextEditor(
    { value, onChange, onCopyError, ariaLabel, placeholder }: Props,
    _ref: React.Ref<unknown>
  ) {
    return (
      <div>
        <textarea
          aria-label={ariaLabel ?? "Content"}
          placeholder={placeholder}
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
  props: Partial<React.ComponentProps<typeof SnippetEditor>> = {}
) {
  return render(
    <SnippetEditor
      snippet={snippet}
      onDelete={onDelete}
      onUndoDelete={onUndoDelete}
      onToggleSidebar={onToggleSidebar}
      existingSnippets={[snippet]}
      {...props}
    />
  );
}

const AUTOSAVE_DELAY = 600;

const blank: SnippetFormData = {
  label: "",
  shortcut: "/",
  content: "",
  tags: [],
};
const valid: SnippetFormData = {
  label: "Address",
  shortcut: "/addr",
  content: "123 Fake Street",
  tags: [],
};
const newSnippet: Snippet = { ...snippet, id: "new", ...blank };

const onDraftChange = vi.fn();
const onAutoSave = vi.fn();

function DraftHarness({
  initial = blank,
  ...props
}: Partial<React.ComponentProps<typeof SnippetEditor>> & {
  initial?: SnippetFormData;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <SnippetEditor
      snippet={newSnippet}
      draft={draft}
      onDraftChange={(next) => {
        onDraftChange(next);
        setDraft(next);
      }}
      onAutoSave={onAutoSave}
      onDelete={onDelete}
      onToggleSidebar={onToggleSidebar}
      {...props}
    />
  );
}

function renderDraft(
  props: Partial<React.ComponentProps<typeof SnippetEditor>> & {
    initial?: SnippetFormData;
  } = {}
) {
  return render(<DraftHarness {...props} />);
}

function expectLandmarks() {
  expect(screen.getByTestId("snippet-toggle-sidebar")).toBeInTheDocument();
  expect(screen.getByTestId("snippet-undo")).toBeInTheDocument();
  expect(screen.getByTestId("snippet-redo")).toBeInTheDocument();
  expect(screen.getByTestId("snippet-sync-status")).toBeInTheDocument();
  expect(screen.getByTestId("snippet-copy")).toBeInTheDocument();
  expect(screen.getByTestId("snippet-more")).toBeInTheDocument();
  expect(screen.getByTestId("snippet-label-input")).toBeInTheDocument();
  expect(screen.getByTestId("snippet-shortcut-input")).toBeInTheDocument();
  expect(screen.getByTestId("snippet-content-editor")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /add tag/i })).toBeInTheDocument();
  expect(screen.getByText(/uses/i)).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  writeQueueStore.setState(() => ({
    pending: 0,
    failed: 0,
    refused: 0,
    saving: false,
  }));
  undoAvailabilityStore.setState(() => ({
    snippetId: null,
    canUndo: false,
    canRedo: false,
  }));
  queueOutcomesStore.setState(() => ({}));
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

describe("one editor, two data states", () => {
  it("renders the same landmarks for a saved snippet and a draft", () => {
    const saved = renderView();
    expectLandmarks();
    saved.unmount();

    renderDraft();
    expectLandmarks();
  });

  it("has one status element and no Create, Save or Updated copy", () => {
    renderDraft();

    expect(screen.getAllByTestId("snippet-sync-status")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^create$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    expect(screen.queryByText(/updated/i)).toBeNull();
    expect(screen.queryByTestId("snippet-create-save")).toBeNull();
  });

  it("autofocuses the draft name and keeps the actions disabled", () => {
    renderDraft();

    expect(screen.getByTestId("snippet-label-input")).toHaveFocus();
    expect(screen.getByTestId("snippet-copy")).toBeDisabled();
    expect(screen.getByTestId("snippet-more")).toBeDisabled();
    expect(screen.getByTestId("snippet-undo")).toBeDisabled();
    expect(screen.getByTestId("snippet-redo")).toBeDisabled();
    expect(screen.getByTestId("snippet-sync-status")).toHaveTextContent(
      "Draft"
    );
  });

  it("names version-history controls honestly and gives icons accessible names", () => {
    renderView();

    expect(screen.getByTestId("snippet-undo")).toHaveAttribute(
      "title",
      expect.stringContaining("Restore previous version")
    );
    expect(screen.getByTestId("snippet-redo")).toHaveAttribute(
      "title",
      expect.stringContaining("Restore next version")
    );
    for (const testId of [
      "snippet-toggle-sidebar",
      "snippet-copy",
      "snippet-more",
    ]) {
      expect(screen.getByTestId(testId)).toHaveAccessibleName();
      expect(screen.getByTestId(testId)).toHaveAttribute("title");
    }
  });

  it("keeps the shortcut hint in a tooltip without shifting the title row", async () => {
    const user = userEvent.setup();
    const saved = renderView();

    const input = screen.getByTestId("snippet-shortcut-input");
    expect(input.getAttribute("title")).toContain("Type the trigger");
    expect(screen.queryByTestId("snippet-shortcut-tip")).toBeNull();

    // Focusing the pill used to insert an inline label and push the row down.
    await user.click(input);
    expect(input).toHaveFocus();
    expect(screen.queryByTestId("snippet-shortcut-tip")).toBeNull();
    saved.unmount();

    renderDraft({ initial: { ...blank, shortcut: "" } });
    expect(screen.queryByTestId("snippet-shortcut-tip")).toBeNull();
  });
});

describe("draft creation", () => {
  it("does not stage an empty draft", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderDraft();

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY * 3);

    expect(onAutoSave).not.toHaveBeenCalled();
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it("stages a draft with content after the debounce", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDraft();

    await user.type(screen.getByTestId("snippet-label-input"), "A");
    expect(onAutoSave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY);

    expect(onAutoSave).toHaveBeenCalledWith(
      expect.objectContaining({ label: "A", shortcut: "/" })
    );
  });

  it("stages the last typed draft when the pane closes mid-debounce", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = renderDraft();

    await user.type(screen.getByTestId("snippet-label-input"), "Draft");
    unmount();
    await vi.advanceTimersByTimeAsync(0);

    expect(onAutoSave).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Draft" })
    );
  });

  it("stages a body-only draft too", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDraft();

    await user.click(screen.getByRole("textbox", { name: /content/i }));
    await user.keyboard("hello");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY);

    expect(onAutoSave).toHaveBeenCalledWith(
      expect.objectContaining({ content: "hello" })
    );
  });
});

describe("saved snippet autosave", () => {
  it("stages changed name, shortcut, content and tags, never a clean mount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderView();

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY * 2);
    expect(q.stageEdit).not.toHaveBeenCalled();

    await user.clear(screen.getByTestId("snippet-label-input"));
    await user.type(screen.getByTestId("snippet-label-input"), "Home");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY);

    expect(q.stageEdit).toHaveBeenCalledTimes(1);
    expect(q.stageEdit.mock.calls[0]![1]).toMatchObject({
      label: "Home",
      content: snippet.content,
      shortcut: snippet.shortcut,
    });

    await user.click(screen.getByRole("button", { name: /add tag/i }));
    await user.type(screen.getByPlaceholderText(/tag name/i), "work{Enter}");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY);

    expect(q.stageEdit).toHaveBeenLastCalledWith(
      snippet,
      expect.objectContaining({ tags: ["personal", "work"] })
    );
  });

  it("enqueues a staged edit when the pane closes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = renderView();

    await user.click(
      screen.getByRole("button", { name: /remove personal tag/i })
    );
    expect(q.flushDraft).not.toHaveBeenCalled();
    unmount();
    await vi.advanceTimersByTimeAsync(0);

    expect(q.flushDraft).toHaveBeenCalledTimes(1);
  });

  it("reports a validation failure from the queue", async () => {
    const user = userEvent.setup();
    q.flushDraft.mockResolvedValue({ ok: false, error: "emptyContent" });
    renderView();

    await user.click(
      screen.getByRole("button", { name: /remove personal tag/i })
    );
    window.dispatchEvent(new Event("pagehide"));

    expect(
      await screen.findByText("A snippet needs content before it can be saved.")
    ).toBeInTheDocument();
    expect(captureError).not.toHaveBeenCalled();
  });

  it("flushes on a hidden visibility change, not a visible one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup();
    renderView();

    await user.click(
      screen.getByRole("button", { name: /remove personal tag/i })
    );
    const originalVisibility = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState"
    );
    const setVisibility = (value: DocumentVisibilityState) =>
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value,
      });

    try {
      setVisibility("visible");
      fireEvent(document, new Event("visibilitychange"));
      expect(q.flushDraft).not.toHaveBeenCalled();

      setVisibility("hidden");
      fireEvent(document, new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(q.flushDraft).toHaveBeenCalledTimes(1);
    } finally {
      if (originalVisibility) {
        Object.defineProperty(document, "visibilityState", originalVisibility);
      } else {
        Reflect.deleteProperty(document, "visibilityState");
      }
    }
  });

  it("resets local fields when a different snippet is selected", async () => {
    const other: Snippet = {
      ...snippet,
      id: "other",
      label: "Other",
      content: "other body",
    };
    const user = userEvent.setup();
    const { rerender } = renderView();

    await user.clear(screen.getByTestId("snippet-label-input"));
    await user.type(screen.getByTestId("snippet-label-input"), "Changed");
    rerender(
      <SnippetEditor
        snippet={other}
        onDelete={onDelete}
        onToggleSidebar={onToggleSidebar}
      />
    );

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /content/i })).toHaveValue(
        "other body"
      )
    );
    expect(screen.getByTestId("snippet-label-input")).toHaveValue("Other");
  });
});

describe("shortcut validation", () => {
  it("keeps an invalid shortcut visible without persisting it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDraft({ initial: { ...valid, shortcut: "/valid" } });

    fireEvent.change(screen.getByTestId("snippet-shortcut-input"), {
      target: { value: "/a b" },
    });

    expect(screen.getByTestId("snippet-shortcut-input")).toHaveValue("/a b");
    expect(screen.getByTestId("snippet-shortcut-error")).toHaveTextContent(
      "cannot contain spaces"
    );
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY);

    // The rest keeps autosaving while the invalid field is withheld.
    expect(onAutoSave).toHaveBeenCalledWith(
      expect.objectContaining({ shortcut: "/valid", label: "Address" })
    );
    expect(onDraftChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ shortcut: "/a b" })
    );
  });

  it("shows a duplicate inline and does not persist that shortcut", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderDraft({
      initial: { ...valid, shortcut: "/valid" },
      existingSnippets: [snippet],
    });

    fireEvent.change(screen.getByTestId("snippet-shortcut-input"), {
      target: { value: "/addr" },
    });

    expect(screen.getByTestId("snippet-shortcut-error")).toHaveTextContent(
      "already used"
    );
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY);
    expect(onAutoSave).toHaveBeenCalledWith(
      expect.objectContaining({ shortcut: "/valid" })
    );
  });

  it("shows a prefix conflict for an existing shortcut", () => {
    renderDraft({ existingSnippets: [snippet] });

    fireEvent.change(screen.getByTestId("snippet-shortcut-input"), {
      target: { value: "/add" },
    });

    expect(screen.getByTestId("snippet-shortcut-error")).toHaveTextContent(
      "conflicts with"
    );
  });

  it("accepts a valid replacement and clears the error", async () => {
    const user = userEvent.setup();
    renderView({ existingSnippets: [snippet] });

    fireEvent.change(screen.getByTestId("snippet-shortcut-input"), {
      target: { value: "/addr " },
    });
    expect(screen.getByTestId("snippet-shortcut-error")).toBeVisible();

    await user.clear(screen.getByTestId("snippet-shortcut-input"));
    await user.type(screen.getByTestId("snippet-shortcut-input"), "/home");

    expect(screen.queryByTestId("snippet-shortcut-error")).toBeNull();
  });
});

describe("autosave status", () => {
  it("stays quiet for a short save, then shows Saving…", async () => {
    // No real-time drift here: a slow coverage run used to push 399ms past the
    // 400ms threshold before the assertion could read the status.
    vi.useFakeTimers();
    writeQueueStore.setState(() => ({
      pending: 1,
      failed: 0,
      refused: 0,
      saving: true,
    }));
    renderView();

    expect(screen.getByTestId("snippet-sync-status")).toHaveTextContent(
      "Saved ✓"
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(399);
    });
    expect(screen.getByTestId("snippet-sync-status")).not.toHaveTextContent(
      "Saving"
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(screen.getByTestId("snippet-sync-status")).toHaveTextContent(
      "Saving…"
    );
  });

  it("shows Saved ✓ once the queue settles", () => {
    renderView();

    expect(screen.getByTestId("snippet-sync-status")).toHaveTextContent(
      "Saved ✓"
    );
    expect(screen.getByTestId("snippet-sync-status")).toHaveClass(
      "text-muted-foreground"
    );
  });

  it("shows a red retry status for a queued failure", () => {
    queueOutcomesStore.setState(() => ({
      s1: {
        opId: "op-1",
        snippetId: "s1",
        status: "refused",
        error: "Storage is full",
      },
    }));
    writeQueueStore.setState(() => ({
      pending: 0,
      failed: 0,
      refused: 1,
      saving: false,
    }));
    renderView();

    const status = screen.getByTestId("snippet-sync-status");
    expect(status).toHaveTextContent("Couldn't save · Retry");
    expect(status.querySelector("button")).toHaveClass("text-destructive");
  });

  it("dismisses a failure and retries the pending draft", async () => {
    const user = userEvent.setup();
    queueOutcomesStore.setState(() => ({
      s1: {
        opId: "op-1",
        snippetId: "s1",
        status: "failed",
        error: "Offline",
      },
    }));
    renderView();

    await user.click(
      screen.getByRole("button", { name: "Couldn't save · Retry" })
    );

    expect(q.flushDraft).toHaveBeenCalled();
  });
});

describe("toolbar actions", () => {
  it("deletes from the overflow menu and offers undo without a dialog", async () => {
    const user = userEvent.setup();
    renderView();

    expect(screen.queryByTestId("snippet-delete")).toBeNull();
    await user.click(screen.getByTestId("snippet-more"));
    expect(screen.getByRole("menu")).toBeVisible();
    await user.click(screen.getByTestId("snippet-delete"));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("s1"));
    expect(onUndoDelete).toHaveBeenCalledWith(snippet);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("closes the menu on Escape and on an outside click", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByTestId("snippet-more"));
    expect(screen.getByRole("menu")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();

    await user.click(screen.getByTestId("snippet-more"));
    await user.click(screen.getByTestId("snippet-label-input"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("surfaces a delete refusal without reporting it as a bug", async () => {
    const user = userEvent.setup();
    onDelete.mockRejectedValue(
      new SnippetWriteRefused("This snippet is too large to sync.")
    );
    renderView();

    await user.click(screen.getByTestId("snippet-more"));
    await user.click(screen.getByTestId("snippet-delete"));

    expect(
      await screen.findByText("This snippet is too large to sync.")
    ).toBeInTheDocument();
    expect(captureError).not.toHaveBeenCalled();
  });

  it("surfaces an unexpected delete failure", async () => {
    const user = userEvent.setup();
    onDelete.mockRejectedValue(new Error("denied"));
    renderView();

    await user.click(screen.getByTestId("snippet-more"));
    await user.click(screen.getByTestId("snippet-delete"));

    expect(
      await screen.findByText("Failed to delete snippet. Please try again.")
    ).toBeInTheDocument();
    expect(captureError).toHaveBeenCalled();
  });

  it("starts with version undo and redo disabled", () => {
    renderView();

    expect(screen.getByTestId("snippet-undo")).toBeDisabled();
    expect(screen.getByTestId("snippet-redo")).toBeDisabled();
  });

  it("enables undo only for the selected snippet", () => {
    undoAvailabilityStore.setState(() => ({
      snippetId: "s1",
      canUndo: true,
      canRedo: true,
    }));
    renderView();

    expect(screen.getByTestId("snippet-undo")).toBeEnabled();
    expect(screen.getByTestId("snippet-redo")).toBeEnabled();
  });

  it("restores the fields returned by the undo queue", async () => {
    const user = userEvent.setup();
    undoAvailabilityStore.setState(() => ({
      snippetId: "s1",
      canUndo: true,
      canRedo: false,
    }));
    q.undoLastEdit.mockResolvedValue({
      ok: true,
      fields: { ...fields, content: "before" },
    });
    renderView();

    await user.click(screen.getByTestId("snippet-undo"));

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /content/i })).toHaveValue(
        "before"
      )
    );
    expect(q.discardUnflushedDraft).toHaveBeenCalledWith("s1");
  });

  it("redoes through the same queue path", async () => {
    const user = userEvent.setup();
    undoAvailabilityStore.setState(() => ({
      snippetId: "s1",
      canUndo: false,
      canRedo: true,
    }));
    q.redoLastEdit.mockResolvedValue({
      ok: true,
      fields: { ...fields, content: "after" },
    });
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
    const user = userEvent.setup();
    undoAvailabilityStore.setState(() => ({
      snippetId: "s1",
      canUndo: true,
      canRedo: false,
    }));
    q.undoLastEdit.mockResolvedValue({
      ok: true,
      fields: { ...fields, content: "before" },
    });
    renderView();

    await user.click(screen.getByRole("textbox", { name: /content/i }));
    await user.keyboard("{Control>}z{/Control}");

    await waitFor(() => expect(q.undoLastEdit).toHaveBeenCalledTimes(1));
  });

  it("supports the keyboard shortcut for redo", async () => {
    const user = userEvent.setup();
    undoAvailabilityStore.setState(() => ({
      snippetId: "s1",
      canUndo: true,
      canRedo: true,
    }));
    q.redoLastEdit.mockResolvedValue({
      ok: true,
      fields: { ...fields, content: "after" },
    });
    renderView();

    await user.click(screen.getByRole("textbox", { name: /content/i }));
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");

    await waitFor(() => expect(q.redoLastEdit).toHaveBeenCalledTimes(1));
  });

  it("copies content and increments usage", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByTestId("snippet-copy"));

    await waitFor(() =>
      expect(incrementSnippetUsage).toHaveBeenCalledWith("s1")
    );
    expect(copyMarkdownAsRichText).toHaveBeenCalledWith(snippet.content);
    await waitFor(() =>
      expect(screen.getByText("4 uses", { exact: true })).toBeInTheDocument()
    );
  });

  it("shows and clears a copy failure", async () => {
    const user = userEvent.setup();
    vi.mocked(copyMarkdownAsRichText).mockRejectedValue(new Error("blocked"));
    renderView();

    await user.click(screen.getByTestId("snippet-copy"));
    expect(
      await screen.findByText("Failed to copy to clipboard")
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(screen.queryByText("Failed to copy to clipboard")).toBeNull();
  });

  it("surfaces a copy failure raised inside the editor", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(
      screen.getByRole("button", { name: "simulate editor copy failure" })
    );

    expect(
      await screen.findByText("Failed to copy to clipboard")
    ).toBeInTheDocument();
  });

  it("keeps working when the usage count cannot be read", async () => {
    vi.mocked(getSnippetUsageCount).mockRejectedValue(new Error("unavailable"));
    renderView();

    await waitFor(() => expect(captureError).toHaveBeenCalled());
    expect(screen.getByTestId("snippet-more")).toBeInTheDocument();
  });

  it("does not duplicate a tag", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: /add tag/i }));
    await user.type(screen.getByPlaceholderText(/tag name/i), "Work{Enter}");
    expect(await screen.findByText("work")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /add tag/i }));
    await user.type(screen.getByPlaceholderText(/tag name/i), "work{Enter}");
    expect(screen.getAllByText("work")).toHaveLength(1);
  });

  it("closes the tag input on Escape without adding a tag", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: /add tag/i }));
    await user.type(
      screen.getByPlaceholderText(/tag name/i),
      "discarded{Escape}"
    );

    expect(screen.queryByText("discarded")).toBeNull();
  });

  it("commits a typed tag when the input loses focus", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: /add tag/i }));
    await user.type(screen.getByPlaceholderText(/tag name/i), "Work");
    await user.tab();

    expect(await screen.findByText("work")).toBeInTheDocument();
  });

  it("toggles the sidebar and opens the menu from the keyboard", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByTestId("snippet-content-editor"));
    await user.keyboard("{Alt>}b{/Alt}");
    expect(onToggleSidebar).toHaveBeenCalled();

    await user.keyboard("{Alt>}o{/Alt}");
    expect(screen.getByRole("menu")).toBeVisible();
  });
});
