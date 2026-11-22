import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ShortcutRecorder } from "./ShortcutRecorder";
import { i18n } from "../../../../tests/mocks/i18n";

function recorder(testId = "shortcut-recorder") {
  return screen.getByTestId(testId);
}

function segments() {
  return [
    ...screen.getByTestId("shortcut-recorder-chord").querySelectorAll("kbd"),
  ];
}

describe("ShortcutRecorder", () => {
  it("draws each parsed chord segment as its own key cap", () => {
    render(
      <ShortcutRecorder
        value="Mod+Shift+Space"
        onChange={vi.fn()}
        testId="shortcut-recorder"
      />
    );

    expect(segments().map((kbd) => kbd.dataset.segment)).toEqual([
      "mod",
      "shift",
      "key",
    ]);
    expect(screen.getByTestId("shortcut-recorder-chord")).toHaveTextContent(
      "Space"
    );
  });

  it("renders alt as its own segment and reports an unset value", () => {
    const { unmount } = render(
      <ShortcutRecorder
        value="Alt+K"
        onChange={vi.fn()}
        testId="shortcut-recorder"
      />
    );
    expect(segments().map((kbd) => kbd.dataset.segment)).toEqual([
      "alt",
      "key",
    ]);
    unmount();

    render(
      <ShortcutRecorder
        value=""
        onChange={vi.fn()}
        testId="shortcut-recorder"
      />
    );
    expect(
      screen.queryByTestId("shortcut-recorder-chord")
    ).not.toBeInTheDocument();
    expect(recorder()).toHaveTextContent(i18n.t("options.shortcut.unset"));
  });

  it("arms on click, shows the prompt, and cancels on Escape", () => {
    const onChange = vi.fn();
    render(
      <ShortcutRecorder
        value="Mod+K"
        onChange={onChange}
        testId="shortcut-recorder"
      />
    );
    const button = recorder();

    expect(button).toHaveAttribute("data-armed", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("data-armed", "true");
    expect(button).toHaveAttribute(
      "aria-describedby",
      "shortcut-recorder-hint"
    );
    expect(button).toHaveTextContent(i18n.t("options.shortcut.pressKeys"));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(button).toHaveAttribute("data-armed", "false");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects a chord with no modifier and stores a valid one in neutral form", () => {
    const onChange = vi.fn();
    render(
      <ShortcutRecorder
        value="Mod+K"
        onChange={onChange}
        testId="shortcut-recorder"
      />
    );

    fireEvent.click(recorder());
    fireEvent.keyDown(document, { key: "A" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("shortcut-recorder-error")).toHaveTextContent(
      i18n.t("options.shortcut.needsModifier")
    );
    expect(recorder()).toHaveAttribute("data-armed", "true");

    fireEvent.keyDown(document, {
      key: "k",
      ctrlKey: true,
      shiftKey: true,
      altKey: true,
    });
    expect(onChange).toHaveBeenCalledWith("Mod+Alt+Shift+K");
    expect(recorder()).toHaveAttribute("data-armed", "false");
    expect(
      screen.queryByTestId("shortcut-recorder-error")
    ).not.toBeInTheDocument();
  });

  it("abandons a pending chord on blur and on a second click", () => {
    const onChange = vi.fn();
    render(
      <ShortcutRecorder
        value="Mod+K"
        onChange={onChange}
        testId="shortcut-recorder"
      />
    );
    const button = recorder();

    fireEvent.click(button);
    fireEvent.blur(button);
    expect(button).toHaveAttribute("data-armed", "false");

    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toHaveAttribute("data-armed", "false");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stays inert when disabled", () => {
    render(
      <ShortcutRecorder
        value="Mod+K"
        onChange={vi.fn()}
        testId="shortcut-recorder"
        disabled
      />
    );

    expect(recorder()).toBeDisabled();
    fireEvent.click(recorder());
    expect(recorder()).toHaveAttribute("data-armed", "false");
  });

  it("keeps the error and prompt identifiable without an explicit test id", () => {
    render(<ShortcutRecorder value="" onChange={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("options.shortcut.recorder") })
    );
    fireEvent.keyDown(document, { key: "A" });

    expect(screen.getByTestId("shortcut-error")).toHaveTextContent(
      i18n.t("options.shortcut.needsModifier")
    );
  });
});
