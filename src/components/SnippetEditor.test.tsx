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
  within,
} from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { FeedbackProvider } from "@/components/feedback/FeedbackProvider";
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
    ref: React.Ref<{ focus: () => void; openCommandMenu: () => void }>
  ) {
    // Mirror the real editor's ref contract: its focus action puts the caret in
    // the editable surface. The test below proves SnippetEditor calls it.
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    React.useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
      openCommandMenu: () => textareaRef.current?.focus(),
    }));
    return (
      <div>
        <textarea
          ref={textareaRef}
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
    <FeedbackProvider>
      <SnippetEditor
        snippet={snippet}
        onDelete={onDelete}
        onToggleSidebar={onToggleSidebar}
        existingSnippets={[snippet]}
        {...props}
      />
    </FeedbackProvider>
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
    <FeedbackProvider>
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
    </FeedbackProvider>
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
  expect(screen.getAllByLabelText("Snippet name")).toHaveLength(1);
  expect(screen.getAllByLabelText("Shortcut")).toHaveLength(1);
  expect(screen.getByTestId("snippet-content-editor")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /add tag/i })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Tags" })).toBeInTheDocument();
}

async function expectSavedFooter() {
  await waitFor(() =>
    expect(screen.getByTestId("snippet-metadata")).toHaveTextContent(/3\s*uses/)
  );
  expect(screen.getByText("Updated")).toBeInTheDocument();
  const time = screen.getByTestId("snippet-updated-time");
  expect(time).toHaveAttribute("datetime", snippet.updatedAt);
  expect(time).toHaveAttribute(
    "title",
    new Date(snippet.updatedAt).toLocaleString()
  );
}

function expectDraftFooter() {
  expect(screen.getByTestId("snippet-draft")).toHaveTextContent("Draft");
  expect(screen.queryByTestId("snippet-metadata")).toBeNull();
}

/** Fix measured chip widths so the overflow decision is deterministic. */
function stubTagWidths(available: number, each: number, more: number) {
  const rect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      let width = 0;
      if (this.getAttribute("data-testid") === "snippet-tags") {
        width = available;
      } else if (this.hasAttribute("data-measure-more")) {
        width = more;
      } else if (this.hasAttribute("data-measure-tag")) {
        width = each;
      }
      return {
        width,
        height: 20,
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: 20,
        toJSON: () => ({}),
      } as DOMRect;
    });
  return () => rect.mockRestore();
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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
  consoleErrorSpy?.mockRestore();
  consoleErrorSpy = null;
  vi.useRealTimers();
});

describe("one editor, two data states", () => {
  it("renders the same landmarks for a saved snippet and a draft", async () => {
    const saved = renderView();
    expectLandmarks();
    await expectSavedFooter();
    saved.unmount();

    renderDraft();
    expectLandmarks();
    expectDraftFooter();
  });

  it("has one status element and no Create, Save or Updated copy for a draft", () => {
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
    // An untouched draft has nothing to report; the reserved slot stays empty.
    expect(screen.getByTestId("snippet-sync-status")).toBeEmptyDOMElement();
  });

  it("focuses the name when empty header space is clicked", async () => {
    const user = userEvent.setup();
    renderView();
    const shortcut = screen.getByTestId("snippet-shortcut-input");
    await user.click(shortcut);
    expect(shortcut).toHaveFocus();

    await user.click(screen.getByTestId("snippet-header"));
    expect(screen.getByTestId("snippet-label-input")).toHaveFocus();
  });

  it("reads name and shortcut as part of the document, not a tinted band", () => {
    renderView();
    const header = screen.getByTestId("snippet-header");
    const name = screen.getByTestId("snippet-label-input");
    const shortcut = screen.getByTestId("snippet-shortcut-input");

    expect(header.className).not.toContain("bg-muted");
    expect(name.className).toContain("text-ui-lg!");
    expect(name.className).toContain("bg-transparent");
    expect(name).toHaveAttribute("placeholder", "Untitled snippet");
    // The shortcut has no pill: only a bottom border appears on hover/focus.
    expect(shortcut.className).toContain("border-b");
    expect(shortcut.className).toContain("border-transparent");
    expect(shortcut.className).toContain("hover:border-ring/60");
    expect(shortcut.className).not.toContain("bg-background");
    expect(shortcut.className).not.toContain("rounded-md");
  });

  it("tabs name → shortcut → content and focuses content on Enter in the name", async () => {
    const user = userEvent.setup();
    renderView();
    const name = screen.getByTestId("snippet-label-input");
    const shortcut = screen.getByTestId("snippet-shortcut-input");
    const content = screen.getByRole("textbox", { name: "Snippet content" });

    name.focus();
    await user.tab();
    expect(shortcut).toHaveFocus();
    await user.tab();
    expect(content).toHaveFocus();

    name.focus();
    fireEvent.keyDown(name, { key: "Enter" });
    expect(content).toHaveFocus();
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
      "snippet-add-tag",
    ]) {
      expect(screen.getByTestId(testId)).toHaveAccessibleName();
      expect(screen.getByTestId(testId)).toHaveAttribute("title");
    }
  });

  it("shows the shortcut hint only while focused, linked as a tooltip", async () => {
    const user = userEvent.setup();
    renderView();
    const input = screen.getByTestId("snippet-shortcut-input");

    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.click(input);

    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent(
      "Type this on any page to expand the snippet"
    );
    expect(input).toHaveAttribute("aria-describedby", "shortcut-tip");
    expect(document.getElementById("shortcut-tip")).toBe(tip);

    await user.tab();
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("shows the hint for an empty shortcut on hover", () => {
    renderDraft({ initial: { ...blank, shortcut: "" } });
    const input = screen.getByTestId("snippet-shortcut-input");

    fireEvent.mouseEnter(input.parentElement!);

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Type this on any page"
    );
    expect(input).toHaveAttribute("aria-describedby", "shortcut-tip");
  });

  it("keeps the Add tag control icon-only once the snippet has tags", () => {
    renderView();
    const button = screen.getByTestId("snippet-add-tag");

    expect(button).toHaveAccessibleName("Add tag");
    expect(button).toHaveAttribute("title", "Add tag");
    expect(button).toHaveTextContent("");
    expect(screen.queryByText("New Tag")).toBeNull();
    expect(screen.queryByText("TAGS")).toBeNull();
    expect(screen.queryByText("+ Tag")).toBeNull();
  });

  it("labels the empty Add tag control New Tag, then drops the label after the first tag", async () => {
    const user = userEvent.setup();
    renderDraft();
    const button = screen.getByTestId("snippet-add-tag");

    expect(button).toHaveAccessibleName("Add tag");
    expect(button).toHaveTextContent("New Tag");

    await user.click(button);
    await user.type(screen.getByPlaceholderText(/tag name/i), "work{Enter}");

    expect(screen.getByTestId("snippet-add-tag")).toHaveTextContent("");
    expect(screen.queryByText("New Tag")).toBeNull();
    expect(screen.getAllByText("work")).toHaveLength(1);
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

  it("enqueues the autosaved edit while the pane is still open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderView();

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY * 2);
    expect(q.flushDraft).not.toHaveBeenCalled();

    await user.type(screen.getByTestId("snippet-label-input"), "!");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY);

    expect(q.stageEdit).toHaveBeenCalledTimes(1);
    // The staged draft is handed to the background on the same debounce. Waiting
    // for pagehide alone strands it when the popup closes before that handler
    // finishes, leaving the toolbar stuck on Saving… with no queued write.
    expect(q.flushDraft).toHaveBeenCalledTimes(1);
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

    expect(q.flushDraft).toHaveBeenCalled();
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
      await vi.advanceTimersByTimeAsync(0);
      expect(q.flushDraft).not.toHaveBeenCalled();

      setVisibility("hidden");
      fireEvent(document, new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(q.flushDraft).toHaveBeenCalled();
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

    const input = screen.getByTestId("snippet-shortcut-input");
    expect(input).toHaveValue("/a b");
    const error = screen.getByTestId("snippet-shortcut-error");
    expect(error).toHaveTextContent("cannot contain spaces");
    expect(error).toHaveAttribute("role", "tooltip");
    expect(input).toHaveAttribute("aria-describedby", "shortcut-error");
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

    const input = screen.getByTestId("snippet-shortcut-input");
    fireEvent.change(input, { target: { value: "/addr" } });
    fireEvent.blur(input);

    // The duplicate hint outlives focus; only changing the value dismisses it.
    const error = screen.getByTestId("snippet-shortcut-error");
    expect(error).toHaveTextContent("already used");
    // Base UI's positioner keeps opacity: 0 until layout in a real browser, so
    // happy-dom cannot report the popup as visible. `data-open` is the
    // primitive's own open-state contract.
    expect(error).toHaveAttribute("data-open", "");
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
    // The error outlives focus; see the data-open note in the duplicate test.
    expect(screen.getByTestId("snippet-shortcut-error")).toHaveAttribute(
      "data-open",
      ""
    );

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

    const status = screen.getByTestId("snippet-sync-status");
    expect(status).toBeEmptyDOMElement();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(399);
    });
    expect(status).not.toHaveTextContent("Saving");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(status).toHaveTextContent("Saving…");
  });

  it("shows one Saved check after the queue settles, then leaves the slot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T12:00:00.000Z"));
    writeQueueStore.setState(() => ({
      pending: 1,
      failed: 0,
      refused: 0,
      saving: true,
    }));
    renderView();

    const status = screen.getByTestId("snippet-sync-status");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(401);
    });
    expect(status).toHaveTextContent("Saving…");

    await act(async () => {
      writeQueueStore.setState(() => ({
        pending: 0,
        failed: 0,
        refused: 0,
        saving: false,
      }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(status).toHaveTextContent("Saved");
    expect(status.querySelectorAll("svg")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    // The footer follows the completed write, not the record's original date.
    expect(screen.getByTestId("snippet-updated-time")).toHaveTextContent(
      "just now"
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(status).toBeEmptyDOMElement();
  });

  it("shows a sticky retry status without a banner and logs the failure", async () => {
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
    expect(status.querySelector("button")?.getAttribute("title")).toMatch(
      /Storage is full/
    );
    expect(screen.queryByTestId("inline-error")).toBeNull();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Storage is full"
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[Clipio] snippet save failed",
      expect.objectContaining({
        snippetId: "s1",
        opId: "op-1",
        status: "refused",
        error: "Storage is full",
      })
    );
  });

  it("translates a conflict token into hover copy instead of showing it", async () => {
    queueOutcomesStore.setState(() => ({
      s1: {
        opId: "op-2",
        snippetId: "s1",
        status: "failed",
        error: "conflict",
      },
    }));
    writeQueueStore.setState(() => ({
      pending: 0,
      failed: 1,
      refused: 0,
      saving: false,
    }));
    renderView();

    expect(screen.queryByTestId("inline-error")).toBeNull();
    const retry = await screen.findByRole("button", {
      name: "Couldn't save · Retry",
    });
    expect(retry.getAttribute("title")).toMatch(/A newer version/);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[Clipio] snippet save failed",
      expect.objectContaining({
        error: "A newer version of this snippet was saved first",
      })
    );
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

    // The visible error is the inline surface; the shared assertive region
    // repeats the same text for screen readers, so query the surface directly.
    expect(await screen.findByTestId("inline-error")).toHaveTextContent(
      "This snippet is too large to sync."
    );
    expect(captureError).not.toHaveBeenCalled();
  });

  it("surfaces an unexpected delete failure", async () => {
    const user = userEvent.setup();
    onDelete.mockRejectedValue(new Error("denied"));
    renderView();

    await user.click(screen.getByTestId("snippet-more"));
    await user.click(screen.getByTestId("snippet-delete"));

    expect(await screen.findByTestId("inline-error")).toHaveTextContent(
      "Failed to delete snippet. Please try again."
    );
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

  it("does not restage restored fields as a new edit", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
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
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY * 2);

    // The restore is already in the queue. Re-staging these fields as an edit
    // would coalesce over the restore and fail against the committed revision.
    expect(q.stageEdit).not.toHaveBeenCalled();
    expect(q.flushDraft).not.toHaveBeenCalled();
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
      expect(screen.getByTestId("snippet-metadata")).toHaveTextContent(
        /4\s*uses/
      )
    );
  });

  it("shows and clears a copy failure", async () => {
    const user = userEvent.setup();
    vi.mocked(copyMarkdownAsRichText).mockRejectedValue(new Error("blocked"));
    renderView();

    await user.click(screen.getByTestId("snippet-copy"));
    expect(await screen.findByTestId("inline-error")).toHaveTextContent(
      "Failed to copy to clipboard"
    );

    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(screen.queryByTestId("inline-error")).toBeNull();
  });

  it("surfaces a copy failure raised inside the editor", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(
      screen.getByRole("button", { name: "simulate editor copy failure" })
    );

    expect(await screen.findByTestId("inline-error")).toHaveTextContent(
      "Failed to copy to clipboard"
    );
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

  it("collapses overflowing chips into a popover of the hidden tags", async () => {
    const restoreLayout = stubTagWidths(120, 40, 30);
    try {
      const user = userEvent.setup();
      const tags = ["alpha", "beta", "gamma", "delta"];
      renderView({ snippet: { ...snippet, tags } });

      expect(screen.getAllByTestId("snippet-tag-chip")).toHaveLength(1);
      const overflow = screen.getByTestId("snippet-tag-overflow");
      expect(overflow).toHaveTextContent("+3");

      await user.click(overflow);
      const popover = screen.getByRole("dialog", { name: "Hidden tags" });
      for (const tag of tags.slice(1)) {
        expect(within(popover).getByText(tag)).toBeInTheDocument();
      }
    } finally {
      restoreLayout();
    }
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
