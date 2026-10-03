/**
 * Component tests for src/components/SnippetListItem.tsx
 *
 * Separate from SnippetListItem.test.ts, which covers only the getContentPreview
 * helper. This file renders the component and drives the inline editing a user
 * actually performs: double-click a field, type, press Enter to save or Escape to
 * abandon.
 *
 * The behaviours worth pinning, because each was a plausible bug:
 *  - saving an unchanged value must NOT call onUpdate (it would mark the snippet
 *    dirty and trigger the unsaved-changes guard for no reason)
 *  - saving a blank value must NOT call onUpdate
 *  - Escape must discard rather than save
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SnippetListItem from "./SnippetListItem";
import type { Snippet } from "@/types";
import { TIMING } from "@/config/constants";

const snippet: Snippet = {
  id: "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b",
  label: "Address",
  shortcut: "/addr",
  content: "123 Fake Street",
  tags: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as Snippet;

const onClick = vi.fn();
const onUpdate = vi.fn();

function renderItem(
  props: Partial<React.ComponentProps<typeof SnippetListItem>> = {}
) {
  return render(
    <ul>
      <SnippetListItem
        snippet={snippet}
        snippetId="snippet-1"
        isSelected={false}
        onClick={onClick}
        onUpdate={onUpdate}
        {...props}
      />
    </ul>
  );
}

describe("SnippetListItem", () => {
  beforeEach(() => {
    onClick.mockClear();
    onUpdate.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --- display ---------------------------------------------------------

  it("shows the label, shortcut and a preview of the content", () => {
    renderItem();

    expect(screen.getByText("Address")).toBeInTheDocument();
    expect(screen.getByText("/addr")).toBeInTheDocument();
    expect(screen.getByText("123 Fake Street")).toBeInTheDocument();
  });

  it("marks the item as selected when told to", () => {
    const { container } = renderItem({ isSelected: true });
    const item = container.querySelector("[data-testid='snippet-list-item']");
    expect(item).toBeTruthy();
    expect(item?.className).toMatch(/blue|selected|active/i);
  });

  it("calls onClick when the row is activated", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.click(screen.getByText("Address"));
    // The click is deferred so a double-click can cancel it; see the note on
    // handleRowClick. A plain click lands once the defer window passes.
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
  });

  // --- inline editing --------------------------------------------------

  it("opens an editable field on double-click and pre-fills it", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.dblClick(screen.getByText("Address"));

    const input = await screen.findByRole("textbox");
    expect(input).toHaveValue("Address");
  });

  it("saves a changed label on Enter", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.dblClick(screen.getByText("Address"));
    const input = await screen.findByRole("textbox");
    await user.clear(input);
    await user.type(input, "Home address{Enter}");

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Home address" })
    );
  });

  it("trims whitespace before saving", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.dblClick(screen.getByText("Address"));
    const input = await screen.findByRole("textbox");
    await user.clear(input);
    await user.type(input, "   Padded   {Enter}");

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Padded" })
    );
  });

  it("does NOT save when the value is unchanged", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.dblClick(screen.getByText("Address"));
    const input = await screen.findByRole("textbox");
    await user.type(input, "{Enter}"); // no edit, just confirm

    // Saving an identical value would mark the snippet dirty for nothing.
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("does NOT save a blank value", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.dblClick(screen.getByText("Address"));
    const input = await screen.findByRole("textbox");
    await user.clear(input);
    await user.type(input, "{Enter}");

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("discards the edit on Escape", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.dblClick(screen.getByText("Address"));
    const input = await screen.findByRole("textbox");
    await user.clear(input);
    await user.type(input, "Should not survive{Escape}");

    expect(onUpdate).not.toHaveBeenCalled();
    // The row is back to its read-only display.
    expect(await screen.findByText("Address")).toBeInTheDocument();
  });

  it("edits the shortcut independently of the label", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.dblClick(screen.getByText("/addr"));
    const input = await screen.findByRole("textbox");
    expect(input).toHaveValue("/addr");

    await user.clear(input);
    await user.type(input, "/home{Enter}");

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ shortcut: "/home", label: snippet.label })
    );
  });

  it("does not select the row when starting an edit", async () => {
    // The bug this pins. A double-click emits click, click, dblclick, so the row
    // has already handled two clicks before the editor opens. Because
    // Dashboard's selection handler consults `detailHasChanges` and can raise
    // the unsaved-changes guard, renaming a snippet by double-clicking could
    // interrupt the user with a confirm dialog about their own work.
    const user = userEvent.setup();
    renderItem();

    await user.dblClick(screen.getByText("Address"));
    // Wait past the defer window the cancelled click would have fired in.
    await new Promise((r) => setTimeout(r, TIMING.DOUBLE_CLICK_MS + 50));

    expect(onClick).not.toHaveBeenCalled();
  });

  // --- resilience ------------------------------------------------------

  it("still works when onUpdate is not supplied", async () => {
    const user = userEvent.setup();
    renderItem({ onUpdate: undefined });

    await user.dblClick(screen.getByText("Address"));
    const input = await screen.findByRole("textbox");
    await user.clear(input);
    await user.type(input, "No handler{Enter}");

    expect(screen.getByText("Address")).toBeInTheDocument();
  });

  it("renders content previews with media placeholders replaced", () => {
    renderItem({
      snippet: {
        ...snippet,
        content: "see {{image:3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b:200}}",
      },
    });

    expect(screen.getByText(/see \[image\]/)).toBeInTheDocument();
    expect(screen.queryByText(/{{image:/)).not.toBeInTheDocument();
  });
});
