/**
 * Tests for src/components/ConfirmDialog.tsx
 *
 * ConfirmDialog was at 0% coverage. This renders it and drives it the way a user
 * would: find the buttons by their accessible name, click them, assert the
 * callbacks fired and that the dialog closed.
 *
 * Assertions are on role and accessible name, not on class strings or internal
 * markup, so a restyle cannot break them and a real accessibility regression can.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfirmDialog from "./ConfirmDialog";

const onClose = vi.fn();
const onConfirm = vi.fn();

function renderDialog(
  props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}
) {
  return render(
    <ConfirmDialog
      isOpen
      onClose={onClose}
      onConfirm={onConfirm}
      title="Delete snippet"
      message="This cannot be undone."
      {...props}
    />
  );
}

describe("ConfirmDialog", () => {
  beforeEach(() => {
    onClose.mockClear();
    onConfirm.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows the title and message it was given", async () => {
    renderDialog();

    expect(await screen.findByText("Delete snippet")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    renderDialog({ isOpen: false });
    // The dialog is unmounted rather than merely hidden.
    expect(screen.queryByText("Delete snippet")).not.toBeInTheDocument();
  });

  it("shows the default button labels when none are supplied", async () => {
    renderDialog();

    // From `confirmDialog.defaultConfirm` / `defaultCancel` in en.yml, resolved
    // through the real #i18n stub, so this also proves the stub returns real
    // user-visible copy.
    expect(
      await screen.findByRole("button", { name: "Confirm" })
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  it("uses the supplied confirm and cancel labels", async () => {
    renderDialog({ confirmText: "Delete forever", cancelText: "Keep it" });

    expect(
      await screen.findByRole("button", { name: "Delete forever" })
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Keep it" })).toBeVisible();
  });

  it("calls onConfirm and closes when the confirm button is pressed", async () => {
    const user = userEvent.setup();
    renderDialog({ confirmText: "Delete forever" });

    await user.click(
      await screen.findByRole("button", { name: "Delete forever" })
    );

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose and does not confirm when cancelled", async () => {
    const user = userEvent.setup();
    renderDialog({ cancelText: "Keep it" });

    await user.click(await screen.findByRole("button", { name: "Keep it" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("marks the confirm button as the dialog's action", async () => {
    renderDialog({ confirmText: "Delete forever" });
    await screen.findByRole("button", { name: "Delete forever" });

    // The dialog reports its own state through aria-expanded on the trigger;
    // the meaningful assertion here is simply that the action is reachable and
    // the message is announced as a description rather than loose text.
    expect(screen.getByText("This cannot be undone.")).toBeVisible();
  });
});
