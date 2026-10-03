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

vi.mock("@/lib/copyMarkdownAsRichText", () => ({
  copyMarkdownAsRichText: (...args: unknown[]) =>
    copyMarkdownAsRichText(...args),
}));

vi.mock("@/utils/usageTracking", () => ({
  getSnippetUsageCount: (...args: unknown[]) => getSnippetUsageCount(...args),
  incrementSnippetUsage: (...args: unknown[]) => incrementSnippetUsage(...args),
}));

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
});
