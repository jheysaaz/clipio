/**
 * The in-extension guided tour.
 *
 * Driver.js owns the overlay and the popover DOM; this component owns the
 * decisions and persistence. A loader decides whether a surface needs a tour,
 * then mounts this component only for as long as the tour is active. Closing it
 * tears down the overlay and its listeners immediately.
 */

import { useCallback, useEffect, useRef } from "react";
import {
  driver,
  type Config,
  type DriveStep,
  type PopoverDOM,
} from "driver.js";

import { i18n } from "#i18n";
import { buttonVariants } from "@/components/ui/button";
import { captureError } from "@/lib/sentry";
import {
  ONBOARDING_STEPS,
  finishOnboarding,
  isOptionsHandoff,
  onboardingAtStep,
  skipOnboarding,
  type InProgressOnboarding,
  type OnboardingProgress,
  type OnboardingStepAction,
  type OnboardingSurface,
} from "@/lib/onboarding-progress";
import { guidedOnboardingStateItem } from "@/storage/items";

export type OnboardingTourProps = {
  surface: OnboardingSurface;
  /** The resume point chosen by the loader, already normalised. */
  start: InProgressOnboarding;
  /** Unmount the tour after it has been skipped or completed. */
  onClose: () => void;
};

type DriverInstance = ReturnType<typeof driver>;

export function OnboardingTour({
  surface,
  start,
  onClose,
}: OnboardingTourProps) {
  const instanceRef = useRef<DriverInstance | null>(null);
  const closedRef = useRef(false);

  const closeTour = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose();
  }, [onClose]);

  const skipTour = useCallback(() => {
    void persistOnboarding(skipOnboarding()).then(closeTour);
  }, [closeTour]);

  useEffect(() => {
    void persistOnboarding(start);
  }, [start]);

  useEffect(() => {
    const instance = driver(
      buildConfig(surface, instanceRef, closeTour, skipTour)
    );
    instanceRef.current = instance;
    instance.drive(start.step);

    return () => {
      instanceRef.current = null;
      instance.destroy();
    };
  }, [surface, start.step, closeTour, skipTour]);

  return null;
}

function stepsFor(
  surface: OnboardingSurface,
  instanceRef: { current: DriverInstance | null }
): DriveStep[] {
  const definitions = ONBOARDING_STEPS[surface];

  return definitions.map((step, index) => {
    const popover: NonNullable<DriveStep["popover"]> = {
      title: i18n.t(step.titleKey),
      description: i18n.t(step.descriptionKey),
      side: step.side,
    };

    const action = step.nextAction;
    if (action) {
      popover.onNextClick = () => {
        runStepAction(action);
        instanceRef.current?.moveNext();
      };
    }

    // The popup's last button hands off to Options; Options gets a plain Done.
    if (surface === "popup" && index === definitions.length - 1) {
      popover.doneBtnText = i18n.t("onboarding.continue");
    }

    return { element: step.element, popover };
  });
}

function runStepAction(action: OnboardingStepAction): void {
  const selector =
    action === "open-create"
      ? '[data-testid="add-snippet"]'
      : '[data-testid="snippet-create-cancel"]';
  document.querySelector<HTMLElement>(selector)?.click();
}

function buildConfig(
  surface: OnboardingSurface,
  instanceRef: { current: DriverInstance | null },
  closeTour: () => void,
  skipTour: () => void
): Config {
  return {
    steps: stepsFor(surface, instanceRef),
    popoverClass: "clipio-onboarding-popover",
    popoverOffset: 8,
    stagePadding: 4,
    stageRadius: 8,
    overlayColor: "#09090b",
    overlayOpacity: 0.45,
    animate: false,
    scrollIntoView: false,
    waitForElement: 5_000,
    showButtons: ["previous", "next"],
    showProgress: true,
    // Driver replaces `{{current}}` / `{{total}}`; pass them through i18n as
    // substitutions so the surrounding sentence stays translated.
    progressText: i18n.t("onboarding.progress", ["{{current}}", "{{total}}"]),
    nextBtnText: i18n.t("onboarding.next"),
    prevBtnText: i18n.t("onboarding.back"),
    doneBtnText: i18n.t("onboarding.done"),
    onPopoverRender: (popover, opts) => {
      decoratePopover(popover, surface, opts.index, skipTour);
    },
    onHighlightStarted: (_element, _step, opts) => {
      if (typeof opts.index === "number") {
        void persistOnboarding(onboardingAtStep(surface, opts.index));
      }
    },
    onNextClick: () => {
      instanceRef.current?.moveNext();
    },
    onPrevClick: () => {
      instanceRef.current?.movePrevious();
    },
    onDoneClick: () => {
      const next = finishOnboarding(surface);
      void persistOnboarding(next).then(() => {
        if (isOptionsHandoff(next)) {
          void Promise.resolve(browser.runtime.openOptionsPage()).catch(
            (error: unknown) => {
              captureError(error, { action: "onboarding.openOptions" });
            }
          );
        }
        closeTour();
      });
    },
    onDestroyStarted: (_element, _step, opts) => {
      // Escape and overlay clicks are a skip, not an interruption. `api` is our
      // own teardown, which runs after the loader has already closed the tour.
      if (
        opts.reason === "escape" ||
        opts.reason === "overlay" ||
        opts.reason === "close"
      ) {
        skipTour();
      }
    },
  };
}

function decoratePopover(
  popover: PopoverDOM,
  surface: OnboardingSurface,
  step: number | undefined,
  onSkip: () => void
) {
  popover.wrapper.dataset.testid = "onboarding-popover";
  popover.wrapper.dataset.surface = surface;
  popover.wrapper.dataset.step = String(step ?? 0);

  popover.nextButton.dataset.testid = "onboarding-next";
  popover.previousButton.dataset.testid = "onboarding-back";
  // Add the shadcn classes rather than replacing `className`: Driver.js binds
  // its click handlers to `.driver-popover-next-btn` and
  // `.driver-popover-prev-btn`. Dropping those classes makes both buttons inert.
  popover.nextButton.classList.add(
    ...buttonVariants({ variant: "default", size: "xs" }).split(/\s+/)
  );
  popover.previousButton.classList.add(
    ...buttonVariants({ variant: "ghost", size: "xs" }).split(/\s+/)
  );

  const skipButton =
    popover.footerButtons.querySelector<HTMLButtonElement>(
      '[data-testid="onboarding-skip"]'
    ) ?? document.createElement("button");
  skipButton.type = "button";
  skipButton.dataset.testid = "onboarding-skip";
  skipButton.className = buttonVariants({ variant: "ghost", size: "xs" });
  skipButton.textContent = i18n.t("onboarding.skip");
  skipButton.onclick = onSkip;
  popover.footerButtons.prepend(skipButton);
}

async function persistOnboarding(next: OnboardingProgress): Promise<void> {
  try {
    await guidedOnboardingStateItem.setValue(next);
  } catch (error: unknown) {
    captureError(error, { action: "onboarding.persist" });
  }
}
