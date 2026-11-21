import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config, DestroyReason, HookOpts, PopoverDOM } from "driver.js";

import { OnboardingTour, type OnboardingTourProps } from "./OnboardingTour";
import { captureError } from "@/lib/sentry";
import { guidedOnboardingStateItem } from "@/storage/items";
import type { InProgressOnboarding } from "@/lib/onboarding-progress";
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

const POPUP_START: InProgressOnboarding = {
  status: "in_progress",
  surface: "popup",
  step: 0,
};

const OPTIONS_START: InProgressOnboarding = {
  status: "in_progress",
  surface: "options",
  step: 2,
};

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

function addAnchor(testId: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.dataset.testid = testId;
  document.body.append(button);
  return button;
}

function renderTour(
  overrides: Partial<OnboardingTourProps> = {}
): ReturnType<typeof render> & { onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn();
  const result = render(
    <OnboardingTour
      surface={overrides.surface ?? "popup"}
      start={overrides.start ?? POPUP_START}
      onClose={overrides.onClose ?? onClose}
    />
  );
  return { ...result, onClose };
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
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("drives the supplied start and persists it", async () => {
    const { unmount } = renderTour();

    await waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(1));
    expect(lastConfig().steps).toHaveLength(10);
    expect(mocks.instance.drive).toHaveBeenCalledWith(0);
    expect(await storedProgress()).toEqual(POPUP_START);

    unmount();
    expect(mocks.instance.destroy).toHaveBeenCalledTimes(1);
  });

  it("resumes a handed-off options tour at its saved step", async () => {
    renderTour({ surface: "options", start: OPTIONS_START });

    await waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(1));
    expect(mocks.instance.drive).toHaveBeenCalledWith(2);
    expect(lastConfig().popoverClass).toBe("clipio-onboarding-popover");
  });

  it("stamps stable test ids and themed button classes on the popover", async () => {
    renderTour();
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

  it("opens the create form before advancing to its first field", async () => {
    const addButton = addAnchor("add-snippet");
    const click = vi.spyOn(addButton, "click");
    renderTour();
    await waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(1));

    act(() => {
      lastConfig().steps?.[1]?.popover?.onNextClick?.(
        undefined,
        {},
        hookOpts(1)
      );
    });

    expect(click).toHaveBeenCalledTimes(1);
    expect(mocks.instance.moveNext).toHaveBeenCalledTimes(1);
  });

  it("closes the create form before returning to the library", async () => {
    const cancelButton = addAnchor("snippet-create-cancel");
    const click = vi.spyOn(cancelButton, "click");
    renderTour();
    await waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(1));

    act(() => {
      lastConfig().steps?.[7]?.popover?.onNextClick?.(
        undefined,
        {},
        hookOpts(7)
      );
    });

    expect(click).toHaveBeenCalledTimes(1);
    expect(mocks.instance.moveNext).toHaveBeenCalledTimes(1);
  });

  it("skips and closes the tour from the custom Skip button", async () => {
    const { onClose } = renderTour();
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
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("treats Escape and overlay dismissal as a skip but not API cleanup", async () => {
    const { onClose } = renderTour();
    await waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(1));

    act(() => {
      lastConfig().onDestroyStarted?.(undefined, {}, hookOpts(0, "api"));
    });
    expect(await storedProgress()).toEqual(POPUP_START);
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      lastConfig().onDestroyStarted?.(undefined, {}, hookOpts(0, "overlay"));
    });
    await waitFor(async () =>
      expect(await storedProgress()).toEqual({ status: "skipped" })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("saves the highlighted step as the user moves in either direction", async () => {
    renderTour({ surface: "options", start: OPTIONS_START });

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

  it("hands off from the popup to Options before closing the tour", async () => {
    const { onClose } = renderTour();
    await waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(1));

    act(() => {
      lastConfig().onDoneClick?.(undefined, {}, hookOpts(9));
    });

    await waitFor(async () =>
      expect(await storedProgress()).toEqual({
        status: "in_progress",
        surface: "options",
        step: 0,
      })
    );
    await waitFor(() => expect(openOptionsPage).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("completes the flow on the options page without opening it again", async () => {
    const { onClose } = renderTour({
      surface: "options",
      start: OPTIONS_START,
    });
    await waitFor(() => expect(mocks.driver).toHaveBeenCalledTimes(1));
    act(() => {
      lastConfig().onDoneClick?.(undefined, {}, hookOpts(2));
    });

    await waitFor(async () =>
      expect(await storedProgress()).toEqual({ status: "completed" })
    );
    expect(openOptionsPage).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reports a failed progress write instead of breaking the tour", async () => {
    vi.spyOn(guidedOnboardingStateItem, "setValue").mockRejectedValueOnce(
      new Error("storage full")
    );

    const { onClose } = renderTour();
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
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
