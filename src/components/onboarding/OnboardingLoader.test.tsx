import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingLoader } from "./OnboardingLoader";
import { captureError } from "@/lib/sentry";
import { guidedOnboardingStateItem } from "@/storage/items";
import { resetBrowserMocks } from "../../../tests/mocks/browser";

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  close: vi.fn(),
}));

vi.mock("./OnboardingTour", async () => {
  const React = await import("react");
  return {
    OnboardingTour: (props: {
      surface: string;
      start: { step: number };
      onClose: () => void;
    }) => {
      mocks.render({ surface: props.surface, step: props.start.step });
      return React.createElement(
        "button",
        {
          type: "button",
          "data-testid": "fake-tour",
          onClick: () => {
            mocks.close();
            props.onClose();
          },
        },
        "Close tour"
      );
    },
  };
});

function seedProgress(value: unknown): Promise<void> {
  return browser.storage.local.set({ guidedOnboarding: value });
}

describe("OnboardingLoader", () => {
  beforeEach(async () => {
    resetBrowserMocks();
    vi.clearAllMocks();
    await seedProgress({ status: "not_started" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not render a tour after the flow is finished", async () => {
    await seedProgress({ status: "completed" });

    const { getByTestId, queryByTestId } = render(
      <OnboardingLoader surface="popup" />
    );

    await waitFor(() =>
      expect(guidedOnboardingStateItem.getValue).toHaveBeenCalled()
    );
    expect(() => getByTestId("fake-tour")).toThrow();
    expect(queryByTestId("fake-tour")).toBeNull();
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("loads the tour for a fresh popup flow", async () => {
    const { getByTestId } = render(<OnboardingLoader surface="popup" />);

    await waitFor(() => expect(getByTestId("fake-tour")).toBeVisible());
    expect(mocks.render).toHaveBeenCalledWith({ surface: "popup", step: 0 });
  });

  it("does not load a fresh flow on the options page", async () => {
    const { queryByTestId } = render(<OnboardingLoader surface="options" />);

    await waitFor(() =>
      expect(guidedOnboardingStateItem.getValue).toHaveBeenCalled()
    );
    expect(queryByTestId("fake-tour")).toBeNull();
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("loads a handed-off options tour at its saved step", async () => {
    await seedProgress({
      status: "in_progress",
      surface: "options",
      step: 2,
    });

    const { getByTestId } = render(<OnboardingLoader surface="options" />);

    await waitFor(() => expect(getByTestId("fake-tour")).toBeVisible());
    expect(mocks.render).toHaveBeenCalledWith({ surface: "options", step: 2 });
  });

  it("unmounts the tour when it closes", async () => {
    const { getByTestId, queryByTestId } = render(
      <OnboardingLoader surface="popup" />
    );

    await waitFor(() => expect(getByTestId("fake-tour")).toBeVisible());
    await act(async () => getByTestId("fake-tour").click());

    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(queryByTestId("fake-tour")).toBeNull();
  });

  it("reports a storage read failure without loading anything", async () => {
    vi.spyOn(guidedOnboardingStateItem, "getValue").mockRejectedValueOnce(
      new Error("storage unavailable")
    );

    const { queryByTestId } = render(<OnboardingLoader surface="popup" />);

    await waitFor(() =>
      expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
        action: "onboarding.load",
      })
    );
    expect(queryByTestId("fake-tour")).toBeNull();
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("reports a failed dynamic import without loading anything", async () => {
    const loadTour = vi.fn(() => Promise.reject(new Error("chunk failed")));

    const { queryByTestId } = render(
      <OnboardingLoader surface="popup" loadTour={loadTour} />
    );

    await waitFor(() =>
      expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
        action: "onboarding.import",
      })
    );
    expect(loadTour).toHaveBeenCalledTimes(1);
    expect(queryByTestId("fake-tour")).toBeNull();
  });

  it("does not render a tour whose storage read finished after unmount", async () => {
    let resolveRead: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveRead = resolve;
    });
    vi.spyOn(guidedOnboardingStateItem, "getValue").mockReturnValueOnce(
      pending as never
    );

    const { unmount, queryByTestId } = render(
      <OnboardingLoader surface="popup" />
    );
    unmount();

    await act(async () => {
      resolveRead({ status: "not_started" });
      await pending;
    });

    expect(queryByTestId("fake-tour")).toBeNull();
    expect(mocks.render).not.toHaveBeenCalled();
  });
});
