/**
 * Tests for src/components/NewSnippetView.tsx
 *
 * The create-snippet form. It was at 0% coverage despite containing real
 * validation: shortcut whitespace rejection, duplicate/prefix conflict detection
 * against existing snippets, and a save button gated on the draft being valid.
 *
 * The validation is the reason to test this component. The layout is presentation
 * and stays thin.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import NewSnippetView from "./NewSnippetView";
import type { Snippet, SnippetFormData } from "@/types";

const onDraftChange = vi.fn();
const onSave = vi.fn();
const onCancel = vi.fn();
const onClearCreateError = vi.fn();

const emptyDraft: SnippetFormData = {
  label: "",
  shortcut: "",
  content: "",
  tags: [],
};

const existing: Snippet[] = [
  {
    id: "1",
    label: "Address",
    shortcut: "/addr",
    content: "123 Fake Street",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as Snippet,
  {
    id: "2",
    label: "Email",
    shortcut: "/mail",
    content: "me@example.com",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as Snippet,
];

/**
 * A stateful parent, because the component is fully controlled.
 *
 * Passing a bare `onDraftChange={vi.fn()}` would be a test that passes for the
 * wrong reason: React would reset the input's value to the unchanged prop after
 * every keystroke, so each character would arrive on its own and the component
 * would never see a realistic value. That surfaced as a confusing failure —
 * typing "/a b" set the "no spaces" error on the space, then the reset dropped
 * the space and the next keystroke cleared the error, so the message never
 * stuck. Driving it through real state is both the honest test and the one that
 * matches how Dashboard uses it.
 */
function Harness({
  initial = emptyDraft,
  ...props
}: Partial<React.ComponentProps<typeof NewSnippetView>> & {
  initial?: SnippetFormData;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <NewSnippetView
      draftSnippet={draft}
      onDraftChange={(next) => {
        onDraftChange(next);
        setDraft(next);
      }}
      onSave={onSave}
      onCancel={onCancel}
      isSaving={false}
      existingSnippets={existing}
      onClearCreateError={onClearCreateError}
      {...props}
    />
  );
}

function renderView(props: Parameters<typeof Harness>[0] = {}) {
  return render(<Harness {...props} />);
}

describe("NewSnippetView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --- rendering --------------------------------------------------------

  it("renders label, shortcut and content fields", () => {
    renderView();

    expect(screen.getByTestId("snippet-label-input")).toBeInTheDocument();
    expect(screen.getByTestId("snippet-shortcut-input")).toBeInTheDocument();
    // The editor is a contenteditable div, so it is a textbox role. It only has
    // an accessible name because RichTextEditor forwards ariaLabel to it.
    expect(
      screen.getByRole("textbox", { name: "Content" })
    ).toBeInTheDocument();
  });

  it("shows the draft it was given", () => {
    renderView({
      initial: {
        label: "Address",
        shortcut: "/addr",
        content: "Street",
        tags: [],
      },
    });

    expect(screen.getByTestId("snippet-label-input")).toHaveValue("Address");
    expect(screen.getByTestId("snippet-shortcut-input")).toHaveValue("/addr");
  });

  // --- save gating ------------------------------------------------------

  it("disables save while the draft is empty", () => {
    renderView();
    expect(screen.getByTestId("snippet-create-save")).toBeDisabled();
  });

  it("disables save while a required field is missing", () => {
    renderView({
      initial: { label: "Address", shortcut: "", content: "Street", tags: [] },
    });
    expect(screen.getByTestId("snippet-create-save")).toBeDisabled();
  });

  it("enables save once label, shortcut and content are all present", () => {
    renderView({
      initial: {
        label: "Address",
        shortcut: "/addr",
        content: "Street",
        tags: [],
      },
    });
    expect(screen.getByTestId("snippet-create-save")).toBeEnabled();
  });

  it("disables save while a save is in flight", () => {
    renderView({
      initial: { label: "A", shortcut: "/a", content: "C", tags: [] },
      isSaving: true,
    });
    expect(screen.getByTestId("snippet-create-save")).toBeDisabled();
  });

  it("calls onSave when a valid draft is saved", async () => {
    const user = userEvent.setup();
    renderView({
      initial: {
        label: "Address",
        shortcut: "/addr",
        content: "Street",
        tags: [],
      },
    });

    await user.click(screen.getByTestId("snippet-create-save"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  // --- shortcut validation ----------------------------------------------

  it("rejects a shortcut containing a space and does not propagate the draft", async () => {
    const user = userEvent.setup();
    renderView();

    // The space goes last on purpose. The component refuses to propagate a
    // shortcut containing a space, so the character never reaches the draft and
    // the input still reads "/a". A character typed after the space would be
    // appended to that reduced value and clear the error again.
    await user.type(screen.getByTestId("snippet-shortcut-input"), "/a ");

    expect(
      await screen.findByText(/cannot contain spaces/i)
    ).toBeInTheDocument();
    expect(screen.getByTestId("snippet-shortcut-input")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    // The offending value is never handed upstream, so a space cannot end up in
    // the saved snippet by typing past the error.
    expect(onDraftChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ shortcut: expect.stringContaining(" ") })
    );
  });

  it("rejects a shortcut that exactly duplicates an existing one", async () => {
    const user = userEvent.setup();
    renderView();

    // "/addr" is already taken by the "Address" snippet.
    await user.type(screen.getByTestId("snippet-shortcut-input"), "/addr");

    expect(
      await screen.findByText(/already|duplicate|used/i)
    ).toBeInTheDocument();
  });

  it("accepts a shortcut that conflicts with nothing", async () => {
    const user = userEvent.setup();
    renderView();

    await user.type(screen.getByTestId("snippet-shortcut-input"), "/brand-new");

    expect(
      screen.queryByText(/already|duplicate|used/i)
    ).not.toBeInTheDocument();
    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({ shortcut: "/brand-new" })
    );
  });

  // --- error surface ----------------------------------------------------

  it("shows a create error when one is supplied", () => {
    renderView({ createError: "Storage is full" });
    expect(screen.getByText("Storage is full")).toBeInTheDocument();
  });

  it("shows no error when there is none", () => {
    renderView({ createError: null });
    expect(screen.queryByText("Storage is full")).not.toBeInTheDocument();
  });

  // --- cancel -----------------------------------------------------------

  it("calls onCancel when the close button is pressed", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // --- editing ----------------------------------------------------------

  it("propagates label edits to the draft", async () => {
    const user = userEvent.setup();
    renderView();

    await user.type(screen.getByTestId("snippet-label-input"), "A");

    expect(onDraftChange).toHaveBeenCalled();
  });
});
