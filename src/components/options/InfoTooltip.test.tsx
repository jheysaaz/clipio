import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InfoTooltip } from "./InfoTooltip";

const text = "Trigger prefix";
const tooltipId = `info-tooltip-${text.slice(0, 10).replace(/\s+/g, "-")}`;

function tooltip() {
  return screen.queryByRole("tooltip");
}

describe("InfoTooltip", () => {
  it("names the trigger with the tooltip text and links the two by id", () => {
    render(<InfoTooltip text={text} />);

    const trigger = screen.getByRole("button", { name: text });
    expect(trigger).toHaveAttribute("aria-describedby", tooltipId);
    expect(tooltip()).toBeNull();
  });

  it("shows on hover and hides when the pointer leaves", async () => {
    render(<InfoTooltip text={text} />);
    const trigger = screen.getByRole("button", { name: text });

    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole("tooltip")).toHaveAttribute("id", tooltipId);
    expect(screen.getByRole("tooltip")).toHaveTextContent(text);

    fireEvent.mouseLeave(trigger);
    await waitFor(() => expect(tooltip()).toBeNull());
  });

  it("shows on focus and hides on blur", async () => {
    render(<InfoTooltip text={text} />);
    const trigger = screen.getByRole("button", { name: text });

    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toHaveAttribute("id", tooltipId);
    expect(screen.getByRole("tooltip")).toHaveTextContent(text);

    fireEvent.blur(trigger);
    await waitFor(() => expect(tooltip()).toBeNull());
  });

  it("hides on Escape but ignores other keys", async () => {
    render(<InfoTooltip text={text} />);
    const trigger = screen.getByRole("button", { name: text });
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent(text);

    // Negative: Enter is used to activate the trigger and must not swallow the
    // tooltip the user just opened with the keyboard.
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByRole("tooltip")).toHaveTextContent(text);

    fireEvent.keyDown(trigger, { key: "Escape" });
    await waitFor(() => expect(tooltip()).toBeNull());
  });
});
