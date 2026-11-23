import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useControlConfirmation } from "./use-control-confirmation";

function Probe() {
  const { confirmed, show } = useControlConfirmation();
  return (
    <button type="button" onClick={show}>
      {confirmed ? "Copied" : "Copy"}
    </button>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useControlConfirmation", () => {
  it("shows the confirmation for about two seconds and then reverts", () => {
    vi.useFakeTimers();
    render(<Probe />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("restarts the window on a repeated confirmation", () => {
    vi.useFakeTimers();
    render(<Probe />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    fireEvent.click(screen.getByRole("button", { name: "Copied" }));
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("clears its timer when unmounted", () => {
    vi.useFakeTimers();
    const { unmount } = render(<Probe />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    unmount();

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(2000);
      });
    }).not.toThrow();
  });
});
