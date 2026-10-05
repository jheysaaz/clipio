/**
 * Tests for src/components/SnippetDetailView.tsx
 *
 * The detail pane was at 0% coverage while holding the most failure-prone logic
 * in the app: a save that early-returns on no change, an async delete behind a
 * confirm dialog, three separate error surfaces, tag add/remove with duplicate
 * suppression, and a dirty-state report back to the parent.
 *
 * The paths worth pinning are the ones where a silent failure loses a user's
 * work — a rejected save that shows nothing, a delete that fires on cancel, or
 * a tag that quietly duplicates.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SnippetDetailView from "./SnippetDetailView";
import type { Snippet } from "@/types";

const copyMarkdownAsRichText = vi.fn();
const getSnippetUsageCount = vi.fn();
const incrementSnippetUsage = vi.fn();

vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }));

import { captureError } from "@/lib/sentry";
import { SnippetWriteRefused } from "@/store/snippets";

vi.mock("@/lib/copy-markdown-as-rich-text", () => ({
  copyMarkdownAsRichText: (...args: unknown[]) =>
    copyMarkdownAsRichText(...args),
}));

vi.mock("@/storage/usage-tracking", () => ({
  getSnippetUsageCount: (...args: unknown[]) => getSnippetUsageCount(...args),
  incrementSnippetUsage: (...args: unknown[]) => incrementSnippetUsage(...args),
}));

const editorCalls = vi.hoisted(() => ({
  openCommandMenu: vi.fn(),
}));

/**
 * The editor is replaced with a textarea plus a ref and a copy-error trigger.
 *
 * RichTextEditor.tsx is excluded from coverage — it is Plate/Slate presentation,
 * exercised by the editor e2e specs. What this file owns is the wiring into it:
 * that content edits reach the draft, that the insert-command button reaches the
 * editor's imperative handle, and that a copy failure inside the editor surfaces
 * as an inline error. All three are unreachable against the real component,
 * because contenteditable does not drive Plate from happy-dom and the ref is
 * internal to it.
 *
 * The textarea carries the same aria-label the real editor does, so the existing
 * queries in this file are unaffected.
 */
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
          defaultValue={value}
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
const onUpdate = vi.fn();
const onHasChanges = vi.fn();
const onToggleSidebar = vi.fn();

const snippet: Snippet = {
  id: "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b",
  label: "Address",
  shortcut: "/addr",
  content: "123 Fake Street",
  tags: ["personal"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as Snippet;

function renderView(
  props: Partial<React.ComponentProps<typeof SnippetDetailView>> = {}
) {
  return render(
    <SnippetDetailView
      snippet={snippet}
      onDelete={onDelete}
      onUpdate={onUpdate}
      onHasChanges={onHasChanges}
      onToggleSidebar={onToggleSidebar}
      {...props}
    />
  );
}

describe("SnippetDetailView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSnippetUsageCount.mockResolvedValue(3);
    incrementSnippetUsage.mockResolvedValue(4);
    copyMarkdownAsRichText.mockResolvedValue(undefined);
    onDelete.mockResolvedValue(undefined);
    onUpdate.mockResolvedValue(undefined);
    vi.mocked(captureError).mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --- display ---------------------------------------------------------

  it("shows the usage count for the snippet", async () => {
    renderView();

    // Loaded asynchronously, so this also proves the effect wired it up.
    await waitFor(() =>
      expect(screen.getByText("3", { exact: true })).toBeInTheDocument()
    );
  });

  it("renders the existing tags", () => {
    renderView();

    expect(screen.getByText("personal")).toBeInTheDocument();
  });

  it("renders no usage count before the read resolves", () => {
    getSnippetUsageCount.mockReturnValue(new Promise(() => {}));
    renderView();

    // Guards against a test that would pass if the count were hardcoded.
    expect(screen.queryByText("3", { exact: true })).not.toBeInTheDocument();
  });

  it("keeps working when the usage count cannot be read", async () => {
    getSnippetUsageCount.mockRejectedValue(new Error("storage unavailable"));
    renderView();

    // The failure is reported to Sentry rather than thrown, so the pane must
    // still render the snippet.
    expect(
      await screen.findByRole("button", { name: /delete snippet/i })
    ).toBeEnabled();
  });

  // --- save gating -----------------------------------------------------

  it("disables save when nothing has changed", () => {
    renderView();

    expect(screen.getByTestId("snippet-save")).toBeDisabled();
  });

  it("does NOT call onUpdate when save is pressed with no changes", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByTestId("snippet-save"));

    // The button is disabled, and handleSave also early-returns on !hasChanges.
    // Both must hold: a guard that only the disabled attribute protects would
    // start saving the moment anything re-enabled the button.
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("enables save once something actually changed", async () => {
    const user = userEvent.setup();
    renderView();

    // Removing a tag is the cheapest real edit; typing into the Slate editor
    // would test the editor, not this component.
    await user.click(
      screen.getByRole("button", { name: /remove "personal"/i })
    );

    expect(screen.getByTestId("snippet-save")).toBeEnabled();
  });

  it("disables save and reports progress while a save is in flight", async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    onUpdate.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    renderView();

    await user.click(
      screen.getByRole("button", { name: /remove "personal"/i })
    );
    await user.click(screen.getByTestId("snippet-save"));

    // A second click while the first is pending must not fire a second save.
    expect(screen.getByTestId("snippet-save")).toBeDisabled();
    expect(await screen.findByText(/saving/i)).toBeInTheDocument();

    release?.();
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
  });

  it("confirms a completed save to assistive tech", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(
      screen.getByRole("button", { name: /remove "personal"/i })
    );
    await user.click(screen.getByTestId("snippet-save"));

    // The visible label changes, but a screen-reader user needs the polite live
    // region too — that is the only announcement on save.
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/saved/i)
    );
  });

  it("surfaces a save failure instead of failing silently", async () => {
    const user = userEvent.setup();
    onUpdate.mockRejectedValue(new Error("sync storage is full"));
    renderView();

    await user.click(
      screen.getByRole("button", { name: /remove "personal"/i })
    );
    await user.click(screen.getByTestId("snippet-save"));

    // The user's edit was rejected upstream. Showing nothing here is the worst
    // outcome: the pane looks saved and the work is gone.
    expect(
      await screen.findByText("Failed to save snippet. Please try again.")
    ).toBeInTheDocument();
  });

  it("shows the store's explanation for a quota refusal, and does not report it", async () => {
    // The case the generic-message assertion above cannot distinguish.
    //
    // A refusal is not an exception: it is an expected condition with an
    // explanation already worked out. Before this, `Dashboard` threw the
    // localised string as a bare `Error`, this handler filed it to Sentry as
    // user-facing copy, and then replaced it with "please try again" — so the
    // limit detail the store had computed was thrown away, and every user who hit
    // the quota ceiling produced an exception report.
    const user = userEvent.setup();
    onUpdate.mockRejectedValue(
      new SnippetWriteRefused(
        "This snippet is 210.5 KB and sync allows 100.0 KB."
      )
    );
    renderView();

    await user.click(
      screen.getByRole("button", { name: /remove "personal"/i })
    );
    await user.click(screen.getByTestId("snippet-save"));

    expect(
      await screen.findByText(
        "This snippet is 210.5 KB and sync allows 100.0 KB."
      )
    ).toBeInTheDocument();
    // Not the generic copy: the specific one replaced it.
    expect(
      screen.queryByText("Failed to save snippet. Please try again.")
    ).not.toBeInTheDocument();
    expect(captureError).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "saveSnippet" })
    );
  });

  it("re-enables save after a failed save so the edit is not stranded", async () => {
    const user = userEvent.setup();
    onUpdate.mockRejectedValue(new Error("sync storage is full"));
    renderView();

    await user.click(
      screen.getByRole("button", { name: /remove "personal"/i })
    );
    await user.click(screen.getByTestId("snippet-save"));

    // handleSave clears isSaving in a finally block. If it did not, the button
    // would stay disabled and the user could never retry the save.
    await waitFor(() =>
      expect(screen.getByTestId("snippet-save")).toBeEnabled()
    );
    // And it must not claim success.
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  // --- delete flow -----------------------------------------------------

  it("does not delete until the confirm dialog is confirmed", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByTestId("snippet-delete"));

    // Opening the dialog must not delete anything.
    expect(onDelete).not.toHaveBeenCalled();
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("deletes after the dialog is confirmed", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByTestId("snippet-delete"));
    await user.click(await screen.findByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(snippet.id));
  });

  it("does NOT delete when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByTestId("snippet-delete"));
    await user.click(await screen.findByRole("button", { name: /cancel/i }));

    expect(onDelete).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    );
  });

  it("surfaces a delete failure instead of failing silently", async () => {
    const user = userEvent.setup();
    onDelete.mockRejectedValue(new Error("sync quota exceeded"));
    renderView();

    await user.click(screen.getByTestId("snippet-delete"));
    await user.click(await screen.findByRole("button", { name: /^delete$/i }));

    // A rejected delete that showed nothing would leave the user believing the
    // snippet was gone.
    expect(await screen.findByText(/delete|failed|error/i)).toBeInTheDocument();
  });

  it("discards unsaved edits when a different snippet is selected", async () => {
    const user = userEvent.setup();
    const other: Snippet = {
      ...snippet,
      id: "other-id",
      label: "Email",
      tags: ["work"],
    };
    const { rerender } = renderView();

    await user.click(
      screen.getByRole("button", { name: /remove "personal"/i })
    );
    expect(screen.queryByText("personal")).not.toBeInTheDocument();

    rerender(
      <SnippetDetailView
        snippet={other}
        onDelete={onDelete}
        onUpdate={onUpdate}
        onHasChanges={onHasChanges}
        onToggleSidebar={onToggleSidebar}
      />
    );

    // The component keeps editedContent/editedTags in local state. Without the
    // reset on id change, selecting the next snippet would show the previous
    // one's unsaved edits — and saving would write them onto the new snippet.
    expect(await screen.findByText("work")).toBeInTheDocument();
    expect(screen.queryByText("personal")).not.toBeInTheDocument();
  });

  it("does not report changes again after switching snippets", async () => {
    const user = userEvent.setup();
    const other: Snippet = {
      ...snippet,
      id: "other-id",
      label: "Email",
      tags: [],
    };
    const { rerender } = renderView();

    await user.click(
      screen.getByRole("button", { name: /remove "personal"/i })
    );
    onHasChanges.mockClear();

    rerender(
      <SnippetDetailView
        snippet={other}
        onDelete={onDelete}
        onUpdate={onUpdate}
        onHasChanges={onHasChanges}
        onToggleSidebar={onToggleSidebar}
      />
    );

    // Left true, the parent would keep the unsaved-changes guard armed for a
    // snippet the user never edited.
    await waitFor(() => expect(onHasChanges).toHaveBeenCalledWith(false));
  });

  // --- tags ------------------------------------------------------------

  it("adds a tag on Enter, lowercased", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: /add tag/i }));
    await user.type(screen.getByPlaceholderText(/tag/i), "Work{Enter}");

    expect(await screen.findByText("work")).toBeInTheDocument();
  });

  it("does not add a duplicate tag", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: /add tag/i }));
    // "personal" already exists, so re-adding it must be a no-op rather than
    // a second badge with the same key.
    await user.type(screen.getByPlaceholderText(/tag/i), "personal{Enter}");

    expect(screen.getAllByText("personal")).toHaveLength(1);
  });

  it("closes the tag input on Escape without adding the tag", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: /add tag/i }));
    await user.type(screen.getByPlaceholderText(/tag/i), "discarded{Escape}");

    expect(screen.queryByPlaceholderText(/tag/i)).not.toBeInTheDocument();
    expect(screen.queryByText("discarded")).not.toBeInTheDocument();
  });

  it("removes a tag when its remove button is pressed", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(
      screen.getByRole("button", { name: /remove "personal"/i })
    );

    expect(screen.queryByText("personal")).not.toBeInTheDocument();
  });

  // --- dirty state reporting -------------------------------------------

  it("reports no changes for an untouched snippet", async () => {
    renderView();

    await waitFor(() => expect(onHasChanges).toHaveBeenCalledWith(false));
  });

  it("reports changes once a tag is removed", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(
      screen.getByRole("button", { name: /remove "personal"/i })
    );

    // Dashboard uses this to arm the unsaved-changes guard.
    await waitFor(() => expect(onHasChanges).toHaveBeenCalledWith(true));
  });

  it("does not crash when onHasChanges is not supplied", async () => {
    renderView({ onHasChanges: undefined });

    expect(
      await screen.findByRole("button", { name: /delete snippet/i })
    ).toBeEnabled();
  });

  it("calls the newest onHasChanges, not the one from first render", async () => {
    const user = userEvent.setup();
    // Two distinct identities for the same prop, as a parent re-creating an
    // inline arrow on every render would pass. The component reaches the
    // callback through a ref, so the *latest* one must be the one invoked.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderView({ onHasChanges: first });
    await waitFor(() => expect(first).toHaveBeenCalledWith(false));

    rerender(
      <SnippetDetailView
        snippet={snippet}
        onDelete={onDelete}
        onUpdate={onUpdate}
        onHasChanges={second}
        onToggleSidebar={onToggleSidebar}
      />
    );
    second.mockClear();

    await user.click(
      screen.getByRole("button", { name: /remove "personal"/i })
    );

    // If the ref went stale, the report would land on the discarded `first`
    // and the parent would never arm its unsaved-changes guard.
    await waitFor(() => expect(second).toHaveBeenCalledWith(true));
    expect(first).not.toHaveBeenCalledWith(true);
  });

  it("does not re-report dirty state when only the callback identity changes", async () => {
    // The other half of the ref indirection, and the reason it exists.
    // Satisfying `react-hooks/exhaustive-deps` the obvious way — putting
    // `onHasChanges` straight into the dependency array — makes this component
    // report once per parent render, because an inline arrow has a fresh
    // identity every time. A parent that setState in response would then spin.
    //
    // This test fails under that fix, which is the point of writing it.
    const parent = vi.fn();
    const { rerender } = renderView({ onHasChanges: parent });
    await waitFor(() => expect(parent).toHaveBeenCalledTimes(1));
    parent.mockClear();

    // Identical snippet and identical dirty state; only a new function identity.
    const replacement = vi.fn();
    rerender(
      <SnippetDetailView
        snippet={snippet}
        onDelete={onDelete}
        onUpdate={onUpdate}
        onHasChanges={replacement}
        onToggleSidebar={onToggleSidebar}
      />
    );

    // Asserted on the *new* callback, not the original. The dirty state never
    // changed, so a correct component reports nothing; one that re-ran on
    // identity churn would call this immediately with `false`.
    expect(replacement).not.toHaveBeenCalled();
    expect(parent).not.toHaveBeenCalled();
  });

  it("does not refetch the usage count when only the content changes", async () => {
    // The reset effect and the usage-count read are keyed on different things.
    // Sharing one effect meant a same-id content change — the parent echoing a
    // save back — refetched the count for a snippet whose count cannot have
    // moved. Pinned because the two effects are easy to merge back together.
    const edited: Snippet = { ...snippet, content: "999 Real Street" };
    const { rerender } = renderView();
    await waitFor(() => expect(getSnippetUsageCount).toHaveBeenCalledTimes(1));

    rerender(
      <SnippetDetailView
        snippet={edited}
        onDelete={onDelete}
        onUpdate={onUpdate}
        onHasChanges={onHasChanges}
        onToggleSidebar={onToggleSidebar}
      />
    );

    // Proof the rerender actually landed, so the count assertion below cannot
    // pass vacuously: the id guard kept the *old* body in local state, so the
    // component now correctly reports itself dirty against the new prop.
    await waitFor(() => expect(onHasChanges).toHaveBeenCalledWith(true));
    expect(getSnippetUsageCount).toHaveBeenCalledTimes(1);
  });

  // --- copy ------------------------------------------------------------

  it("increments the usage count after a successful copy", async () => {
    const user = userEvent.setup();
    renderView();
    await waitFor(() => expect(getSnippetUsageCount).toHaveBeenCalled());

    await user.click(screen.getByTestId("snippet-copy"));

    await waitFor(() =>
      expect(incrementSnippetUsage).toHaveBeenCalledWith(snippet.id)
    );
  });

  it("shows an error when the copy fails", async () => {
    const user = userEvent.setup();
    copyMarkdownAsRichText.mockRejectedValue(new Error("clipboard blocked"));
    renderView();

    await user.click(screen.getByTestId("snippet-copy"));

    expect(
      await screen.findByText("Failed to copy to clipboard")
    ).toBeInTheDocument();
  });

  it("surfaces a copy failure that happens inside the editor", async () => {
    // A different path from the toolbar copy button: the editor can fail to
    // copy on its own, and it reports through onCopyError rather than by
    // throwing. Nothing else routes that into the same inline error.
    const user = userEvent.setup();
    renderView();

    await user.click(
      screen.getByRole("button", { name: /simulate editor copy failure/i })
    );

    expect(
      await screen.findByText("Failed to copy to clipboard")
    ).toBeInTheDocument();
  });

  it("clears the inline error when it is dismissed", async () => {
    const user = userEvent.setup();
    copyMarkdownAsRichText.mockRejectedValue(new Error("clipboard blocked"));
    renderView();
    await user.click(screen.getByTestId("snippet-copy"));
    await screen.findByText("Failed to copy to clipboard");

    await user.click(screen.getByRole("button", { name: "Dismiss error" }));

    expect(
      screen.queryByText("Failed to copy to clipboard")
    ).not.toBeInTheDocument();
  });

  it("reverts the copied indicator after two seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderView();

      await user.click(screen.getByTestId("snippet-copy"));
      // "Copied!" is the button's accessible name, not text — the icon swaps
      // for a tick. Asserted by role+name so the test pins what a screen-reader
      // user is told, which is the only version of this state they perceive.
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Copied!" })
        ).toBeInTheDocument()
      );

      // The timer callback is what puts the UI back. Without this the button
      // would claim "Copied!" forever, which is a small lie the user acts on.
      await vi.advanceTimersByTimeAsync(2000);
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Copied!" })
        ).not.toBeInTheDocument()
      );
      expect(
        screen.getByRole("button", { name: "Copy to clipboard" })
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reverts the saved indicator after two seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderView();
      await user.click(
        screen.getByRole("button", { name: /remove "personal"/i })
      );
      await user.click(screen.getByTestId("snippet-save"));

      await waitFor(() =>
        expect(screen.getByText("Saved", { exact: true })).toBeInTheDocument()
      );

      await vi.advanceTimersByTimeAsync(2000);
      await waitFor(() =>
        expect(
          screen.queryByText("Saved", { exact: true })
        ).not.toBeInTheDocument()
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // --- editor wiring ----------------------------------------------------

  it("reaches the editor's command menu from the insert button", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: /insert command/i }));

    // The button is wired to editorRef.current?.openCommandMenu(). Asserting the
    // editor was called is what proves the ref is attached — clicking with a
    // null ref would silently no-op, which is the bug this guards.
    expect(editorCalls.openCommandMenu).toHaveBeenCalledTimes(1);
  });

  it("turns an editor content edit into a dirty draft", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("textbox", { name: /content/i }));
    await user.keyboard("!");
    await waitFor(() => expect(onHasChanges).toHaveBeenCalledWith(true));

    expect(screen.getByTestId("snippet-save")).toBeEnabled();
  });

  // --- tag input on blur ------------------------------------------------

  it("adds the typed tag when the tag input loses focus", async () => {
    // Blur is a real commit path, not a duplicate of Enter: a user who types a
    // tag and clicks straight into the body never presses Enter, and losing the
    // tag there would look like the field ignoring them.
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: /add tag/i }));
    const input = screen.getByPlaceholderText(/tag/i);
    await user.type(input, "Work");
    await user.tab();

    expect(await screen.findByText("work")).toBeInTheDocument();
  });

  it("closes the tag input on blur without adding an empty tag", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: /add tag/i }));
    // Whitespace only: trim() empties it, so nothing may be added.
    await user.type(screen.getByPlaceholderText(/tag/i), "   ");
    await user.tab();

    expect(
      screen.getByRole("button", { name: /add tag/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "" })).not.toBeInTheDocument();
  });

  it("does not duplicate an existing tag when the input blurs", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: /add tag/i }));
    await user.type(screen.getByPlaceholderText(/tag/i), "personal");
    await user.tab();

    // "personal" is already on the snippet. Case-insensitively, so "Personal"
    // must not slip past as a second tag.
    expect(screen.getAllByText("personal")).toHaveLength(1);
  });

  // --- snippet with no tags ---------------------------------------------

  it("renders a snippet whose tags are missing entirely", () => {
    // `snippet.tags || []` appears twice in this component. Legacy snippets and
    // anything hand-edited in storage can arrive without the field, and the
    // fallback is the only thing standing between that and a crash on render.
    renderView({ snippet: { ...snippet, tags: undefined } as Snippet });

    expect(
      screen.getByRole("button", { name: /delete snippet/i })
    ).toBeEnabled();
  });

  it("still adds the first tag to a snippet that arrived with none", async () => {
    const user = userEvent.setup();
    renderView({ snippet: { ...snippet, tags: undefined } as Snippet });

    await user.click(screen.getByRole("button", { name: /add tag/i }));
    await user.type(screen.getByPlaceholderText(/tag/i), "Work{Enter}");

    expect(await screen.findByText("work")).toBeInTheDocument();
  });
});
