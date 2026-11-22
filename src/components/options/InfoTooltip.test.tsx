import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InfoTooltip } from "./InfoTooltip";

const text = "Trigger prefix";
const tooltipId = `info-tooltip-${text.slice(0, 10).replace(/\s+/g, "-")}`;

function visible() {
  return screen.getByRole("tooltip").className.includes("opacity-100");
}

describe("InfoTooltip", () => {
  it("names the button with the tooltip text and links the two by id", () => {
    render(<InfoTooltip text={text} />);

    const button = screen.getByRole("button", { name: text });
    expect(button).toHaveAttribute("aria-describedby", tooltipId);
    expect(screen.getByRole("tooltip")).toHaveAttribute("id", tooltipId);
    expect(screen.getByRole("tooltip")).toHaveTextContent(text);
    expect(visible()).toBe(false);
  });

  it("shows on hover and hides when the pointer leaves", () => {
    render(<InfoTooltip text={text} />);
    const trigger = screen.getByRole("button", { name: text }).parentElement!;

    fireEvent.mouseEnter(trigger);
    expect(visible()).toBe(true);

    fireEvent.mouseLeave(trigger);
    expect(visible()).toBe(false);
  });

  it("shows on focus and hides on blur", () => {
    render(<InfoTooltip text={text} />);
    const button = screen.getByRole("button", { name: text });

    fireEvent.focus(button);
    expect(visible()).toBe(true);

    fireEvent.blur(button);
    expect(visible()).toBe(false);
  });

  it("hides on Escape but ignores other keys", () => {
    render(<InfoTooltip text={text} />);
    const button = screen.getByRole("button", { name: text });
    fireEvent.focus(button);
    expect(visible()).toBe(true);

    // Negative: Enter is used to activate the button and must not swallow the
    // tooltip the user just opened with the keyboard.
    fireEvent.keyDown(button, { key: "Enter" });
    expect(visible()).toBe(true);

    fireEvent.keyDown(button, { key: "Escape" });
    expect(visible()).toBe(false);
  });
});
