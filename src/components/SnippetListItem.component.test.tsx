/**
 * Component tests for src/components/SnippetListItem.tsx
 *
 * The row is a read-only selection control: naming and shortcuts are edited in
 * the one SnippetEditor. These tests pin that contract, plus the live preview
 * that comes from the staged draft rather than the authoritative record.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SnippetListItem from "./SnippetListItem";
import type { Snippet } from "@/types";
import { draftPreviewsStore } from "@/store/write-queue";

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
        {...props}
      />
    </ul>
  );
}

describe("SnippetListItem", () => {
  beforeEach(() => {
    onClick.mockClear();
    draftPreviewsStore.setState(() => ({}));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows the label, shortcut and a preview of the content", () => {
    renderItem();

    expect(screen.getByText("Address")).toBeInTheDocument();
    expect(screen.getByText("/addr")).toBeInTheDocument();
    expect(screen.getByText("123 Fake Street")).toBeInTheDocument();
  });

  it("previews the staged draft while the editor is being typed into", () => {
    draftPreviewsStore.setState(() => ({
      [snippet.id]: {
        label: snippet.label,
        shortcut: snippet.shortcut,
        content: "typed but not committed",
        tags: [],
      },
    }));

    renderItem();

    expect(screen.getByText("typed but not committed")).toBeInTheDocument();
    expect(screen.queryByText("123 Fake Street")).not.toBeInTheDocument();
  });

  it("falls back to the stored content once no draft is staged", () => {
    renderItem();

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

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not open a second editing surface for the label", async () => {
    const user = userEvent.setup();
    renderItem();

    await user.dblClick(screen.getByText("Address"));

    // The only editor is the detail pane; the row stays plain text.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
