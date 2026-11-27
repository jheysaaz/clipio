import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FeedbackBanner,
  FeedbackProvider,
  useFeedback,
} from "./FeedbackProvider";

function Probe() {
  const { announce, announceError, showBanner } = useFeedback();
  return (
    <>
      <button
        type="button"
        onClick={() => announce("Saved", { key: "saved", throttleMs: 10_000 })}
      >
        announce saved
      </button>
      <button
        type="button"
        onClick={() =>
          announce("Different", { key: "saved", throttleMs: 10_000 })
        }
      >
        announce different
      </button>
      <button type="button" onClick={() => announceError("Disk full")}>
        announce error
      </button>
      <button type="button" onClick={() => showBanner({ message: "Imported" })}>
        info banner
      </button>
      <button
        type="button"
        onClick={() =>
          showBanner({ message: "Ping failed", severity: "error" })
        }
      >
        error banner
      </button>
      <button
        type="button"
        onClick={() =>
          showBanner({ message: "Backup failed", severity: "error" })
        }
      >
        newer error banner
      </button>
      <button
        type="button"
        onClick={() =>
          showBanner({
            message: "Copied",
            action: { label: "Retry", onClick: vi.fn() },
            onDismiss: vi.fn(),
          })
        }
      >
        banner with controls
      </button>
      <button
        type="button"
        onClick={() =>
          showBanner({
            message: "Library only",
            source: "library-import",
            scope: "library",
          })
        }
      >
        scoped banner
      </button>
    </>
  );
}

function renderProvider(scope?: string) {
  return render(
    <FeedbackProvider>
      <Probe />
      <FeedbackBanner testId="feedback-banner" scope={scope} />
    </FeedbackProvider>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("FeedbackProvider", () => {
  it("mounts exactly two live regions before any content changes", () => {
    const { container } = renderProvider();

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(
      container.querySelectorAll('[role="status"], [role="alert"], [aria-live]')
    ).toHaveLength(2);
  });

  it("throttles repeated polite announcements with the same key", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "announce saved" }));
    expect(screen.getByRole("status").textContent).toBe("Saved");

    fireEvent.click(screen.getByRole("button", { name: "announce different" }));
    expect(screen.getByRole("status").textContent).toBe("Saved");

    act(() => {
      vi.setSystemTime(10_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "announce different" }));
    expect(screen.getByRole("status").textContent).toBe("Different");
  });

  it("announces errors immediately and does not throttle them", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "announce error" }));
    expect(screen.getByRole("alert").textContent).toBe("Disk full");
    expect(screen.getByRole("status").textContent).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "announce error" }));
    expect(screen.getByRole("alert").textContent).toBe("Disk full");
  });

  it("keeps a single banner and never lets info displace an error", () => {
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "info banner" }));
    expect(screen.getByTestId("feedback-banner").textContent).toContain(
      "Imported"
    );

    fireEvent.click(screen.getByRole("button", { name: "error banner" }));
    expect(
      screen.getByTestId("feedback-banner").getAttribute("data-severity")
    ).toBe("error");

    fireEvent.click(screen.getByRole("button", { name: "info banner" }));
    expect(screen.getByTestId("feedback-banner").textContent).toContain(
      "Ping failed"
    );

    fireEvent.click(screen.getByRole("button", { name: "newer error banner" }));
    expect(screen.getAllByTestId("feedback-banner")).toHaveLength(1);
    expect(screen.getByTestId("feedback-banner").textContent).toContain(
      "Backup failed"
    );
  });

  it("keeps a section-scoped banner inside its own section", () => {
    const outside = renderProvider("diagnostics");
    fireEvent.click(screen.getByRole("button", { name: "scoped banner" }));
    expect(screen.queryByTestId("feedback-banner")).toBeNull();
    outside.unmount();

    renderProvider("library");
    fireEvent.click(screen.getByRole("button", { name: "scoped banner" }));
    const banner = screen.getByTestId("feedback-banner");
    expect(banner).toHaveTextContent("Library only");
    expect(banner).toHaveAttribute("data-scope", "library");
  });

  it("renders the banner as a compact caption rather than bold body copy", () => {
    renderProvider();
    fireEvent.click(screen.getByRole("button", { name: "info banner" }));

    const banner = screen.getByTestId("feedback-banner");
    expect(banner.className).toContain("text-ui-xs!");
    expect(banner.className).toContain("font-normal");
    expect(banner.querySelector("p")?.className).not.toContain("font-medium");
    expect(banner.querySelector("svg")?.getAttribute("class")).toContain(
      "size-3"
    );
  });

  it("renders banner actions as buttons and lets the user dismiss", () => {
    renderProvider();

    fireEvent.click(
      screen.getByRole("button", { name: "banner with controls" })
    );

    const action = screen.getByRole("button", { name: "Retry" });
    expect(action.tagName).toBe("BUTTON");
    // The action, icon, copy and dismiss control all inherit the banner's one
    // foreground colour; a primary-blue link inside a red error read as three
    // unrelated treatments in the same component.
    expect(action.className).toContain("text-inherit");

    const banner = screen.getByTestId("feedback-banner");
    expect(banner.getAttribute("role")).toBeNull();
    expect(banner.getAttribute("aria-live")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("feedback-banner")).toBeNull();
  });
});
