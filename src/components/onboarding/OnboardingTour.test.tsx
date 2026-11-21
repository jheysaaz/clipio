import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config, DestroyReason, HookOpts, PopoverDOM } from "driver.js";

import { OnboardingTour } from "./OnboardingTour";
import { ONBOARDING_REPLAY_EVENT } from "@/lib/onboarding-progress";
import { captureError } from "@/lib/sentry";
import { guidedOnboardingStateItem } from "@/storage/items";
import { resetBrowserMocks } from "../../../tests/mocks/browser";

const mocks = vi.hoisted(() => ({
  driver: vi.fn(),
  instance: {
    drive: vi.fn(),
    destroy: vi.fn(),
    moveNext: vi.fn(),
    movePrevious: vi.fn(),
  },
}));

vi.mock("driver.js", () => ({ driver: mocks.driver }));

async function storedProgress(): Promise<unknown> {
  const result = await browser.storage.local.get("guidedOnboarding");
  return result.guidedOnboarding;
}

function seedProgress(value: unknown): Promise<void> {
  return browser.storage.local.set({ guidedOnboarding: value });
}

function lastConfig(): Config {
  const config = mocks.driver.mock.calls.at(-1)?.[0];
  if (!config) throw new Error("driver() was not called");
  return config;
}

function hookOpts(index: number | undefined, reason?: DestroyReason): HookOpts {
  return {
    config: lastConfig(),
    state: {},
    driver: mocks.instance as never,
    index,
    reason,
  };
}

function fakePopover(): PopoverDOM {
  const popover: PopoverDOM = {
    wrapper: document.createElement("div"),
    arrow: document.createElement("div"),
    title: document.createElement("div"),
    description: document.createElement("div"),
    footer: document.createElement("div"),
    progress: document.createElement("div"),
    previousButton: document.createElement("button"),
    nextButton: document.createElement("button"),
    closeButton: document.createElement("button"),
    footerButtons: document.createElement("div"),
  };

  // Match Driver.js's real DOM: `decoratePopover` must extend these classes,
  // not replace them.
  popover.previousButton.className =
    "driver-popover-footer-btn driver-popover-prev-btn";
  popover.nextButton.className =
    "driver-popover-footer-btn driver-popover-next-btn";

  return popover;
}

describe("OnboardingTour", () => {
  let openOptionsPage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    resetBrowserMocks();
    vi.clearAllMocks();
    mocks.driver.mockReturnValue(mocks.instance);

    openOptionsPage = vi.fn(async () => {});
    (
      browser.runtime as unknown as { openOptionsPage: unknown }
    ).openOptionsPage = openOptionsPage;

    await seedProgress({ status: "not_started" });
  });

  afterEach(() => {
    delete (browser.runtime as unknown as { openOptionsPage?: unknown })
      .openOptionsPage;
    vi.restoreAllMocks();
  });

  it("auto-starts the first-run popup tour and persists its first step", async () => {
    const { unmount } = render(<OnboardingTour surface="popup" />);

    await waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(1));
    expect(lastConfig().steps).toHaveLength(3);
    expect(mocks.instance.drive).toHaveBeenCalledWith(0);
    expect(await storedProgress()).toEqual({
      status: "in_progress",
      surface: "popup",
      step: 0,
    });

    unmount();
    expect(mocks.instance.destroy).toHaveBeenCalledTimes(1);
  });

  it("does not auto-start a fresh flow on the options page", async () => {
    render(<OnboardingTour surface="options" />);

    await waitFor(() =>
      expect(guidedOnboardingStateItem.getValue).toHaveBeenCalled()
    );
    expect(mocks.driver).not.toHaveBeenCalled();
    expect(await storedProgress()).toEqual({ status: "not_started" });
  });

  it("resumes a handed-off options tour at its saved step", async () => {
    await seedProgress({
      status: "in_progress",
      surface: "options",
      step: 2,
    });

    render(<OnboardingTour surface="options" />);

    await waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(1));
    expect(mocks.instance.drive).toHaveBeenCalledWith(2);
    expect(lastConfig().popoverClass).toBe("clipio-onboarding-popover");
  });

  it("stamps stable test ids and themed button classes on the popover", async () => {
    render(<OnboardingTour surface="popup" />);
    await waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(1));

    const popover = fakePopover();
    act(() => {
      lastConfig().onPopoverRender?.(popover, hookOpts(1));
    });

    expect(popover.wrapper.dataset.testid).toBe("onboarding-popover");
    expect(popover.wrapper.dataset.surface).toBe("popup");
    expect(popover.wrapper.dataset.step).toBe("1");
    expect(popover.nextButton.dataset.testid).toBe("onboarding-next");
    expect(popover.previousButton.dataset.testid).toBe("onboarding-back");
    // Driver.js delegates clicks through these classes; theming must not remove
    // them or both navigation buttons silently stop working.
    expect(popover.nextButton.className).toContain("driver-popover-next-btn");
    expect(popover.nextButton.className).toContain("driver-popover-footer-btn");
    expect(popover.previousButton.className).toContain(
      "driver-popover-prev-btn"
    );
    expect(popover.nextButton.className).toContain("bg-primary");
    expect(
      popover.footerButtons.querySelector('[data-testid="onboarding-skip"]')
    ).not.toBeNull();
  });

  it("skips and stops the tour from the custom Skip button", async () => {
    render(<OnboardingTour surface="popup" />);
    await waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(1));

    const popover = fakePopover();
    act(() => {
      lastConfig().onPopoverRender?.(popover, hookOpts(0));
    });
    const skip = popover.footerButtons.querySelector<HTMLButtonElement>(
      '[data-testid="onboarding-skip"]'
    );
    if (!skip) throw new Error("Skip button was not rendered");

    act(() => skip.click());

    await waitFor(async () =>
      expect(await storedProgress()).toEqual({ status: "skipped" })
    );
    expect(mocks.instance.destroy).toHaveBeenCalled();
  });

  it("treats Escape and overlay dismissal as a skip but not API cleanup", async () => {
    render(<OnboardingTour surface="popup" />);
    await waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(1));

    act(() => {
      lastConfig().onDestroyStarted?.(undefined, {}, hookOpts(0, "api"));
    });
    expect(await storedProgress()).toEqual({
      status: "in_progress",
      surface: "popup",
      step: 0,
    });

    act(() => {
      lastConfig().onDestroyStarted?.(undefined, {}, hookOpts(0, "overlay"));
    });
    await waitFor(async () =>
      expect(await storedProgress()).toEqual({ status: "skipped" })
    );
    expect(mocks.instance.destroy).toHaveBeenCalled();
  });

  it("saves the highlighted step as the user moves in either direction", async () => {
    await seedProgress({
      status: "in_progress",
      surface: "options",
      step: 2,
    });
    render(<OnboardingTour surface="options" />);

    await waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(1));
    act(() => {
      lastConfig().onHighlightStarted?.(undefined, {}, hookOpts(1));
    });
    await waitFor(async () =>
      expect(await storedProgress()).toEqual({
        status: "in_progress",
        surface: "options",
        step: 1,
      })
    );

    act(() => {
      lastConfig().onNextClick?.(undefined, {}, hookOpts(1));
      lastConfig().onPrevClick?.(undefined, {}, hookOpts(1));
    });
    expect(mocks.instance.moveNext).toHaveBeenCalledTimes(1);
    expect(mocks.instance.movePrevious).toHaveBeenCalledTimes(1);
  });

  it("hands off from the popup to Options before opening the options page", async () => {
    render(<OnboardingTour surface="popup" />);
    await waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(1));

    act(() => {
      lastConfig().onDoneClick?.(undefined, {}, hookOpts(2));
    });

    await waitFor(async () =>
      expect(await storedProgress()).toEqual({
        status: "in_progress",
        surface: "options",
        step: 0,
      })
    );
    await waitFor(() => expect(openOptionsPage).toHaveBeenCalledTimes(1));
  });

  it("completes the flow on the options page without opening it again", async () => {
    await seedProgress({
      status: "in_progress",
      surface: "options",
      step: 2,
    });
    render(<OnboardingTour surface="options" />);

    await waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(1));
    act(() => {
      lastConfig().onDoneClick?.(undefined, {}, hookOpts(2));
    });

    await waitFor(async () =>
      expect(await storedProgress()).toEqual({ status: "completed" })
    );
    expect(openOptionsPage).not.toHaveBeenCalled();
  });

  it("replays only the surface named in the event", async () => {
    render(<OnboardingTour surface="popup" />);
    await waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(
        new CustomEvent(ONBOARDING_REPLAY_EVENT, {
          detail: { surface: "options" },
        })
      );
    });
    expect(mocks.driver).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(ONBOARDING_REPLAY_EVENT, {
          detail: { surface: "popup" },
        })
      );
    });

    await waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(2));
    expect(mocks.instance.drive).toHaveBeenLastCalledWith(0);
    expect(await storedProgress()).toEqual({
      status: "in_progress",
      surface: "popup",
      step: 0,
    });
  });

  it("reports a storage read failure instead of swallowing it", async () => {
    vi.spyOn(guidedOnboardingStateItem, "getValue").mockRejectedValueOnce(
      new Error("storage unavailable")
    );

    render(<OnboardingTour surface="popup" />);

    await waitFor(() =>
      expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
        action: "onboarding.load",
      })
    );
    expect(mocks.driver).not.toHaveBeenCalled();
  });

  it("reports a failed progress write instead of breaking the tour", async () => {
    vi.spyOn(guidedOnboardingStateItem, "setValue").mockRejectedValueOnce(
      new Error("storage full")
    );

    render(<OnboardingTour surface="popup" />);
    await waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(1));

    const popover = fakePopover();
    act(() => {
      lastConfig().onPopoverRender?.(popover, hookOpts(0));
      popover.footerButtons
        .querySelector<HTMLButtonElement>('[data-testid="onboarding-skip"]')
        ?.click();
    });

    await waitFor(() =>
      expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
        action: "onboarding.persist",
      })
    );
  });
});
