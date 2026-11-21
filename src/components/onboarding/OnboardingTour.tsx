/**
 * The in-extension guided tour.
 *
 * Driver.js owns the overlay and the popover DOM; this component owns the
 * decisions and persistence. The popup and the options page each mount their own
 * instance, and the persisted progress tells the second one where to resume.
 */

import { useEffect, useRef, useState } from "react";
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
  ONBOARDING_REPLAY_EVENT,
  ONBOARDING_STEPS,
  autoStartOnboarding,
  finishOnboarding,
  isOptionsHandoff,
  normalizeOnboardingProgress,
  onboardingAtStep,
  replayOnboarding,
  skipOnboarding,
  type OnboardingProgress,
  type OnboardingReplayDetail,
  type OnboardingSurface,
} from "@/lib/onboarding-progress";
import { guidedOnboardingStateItem } from "@/storage/items";

type ActiveTour = { step: number; run: number };

export function OnboardingTour({ surface }: { surface: OnboardingSurface }) {
  const instanceRef = useRef<ReturnType<typeof driver> | null>(null);
  const startedRef = useRef(false);
  const [active, setActive] = useState<ActiveTour | null>(null);

  useEffect(() => {
    // StrictMode mounts effects twice in development; the second mount must not
    // start a second tour over the first one.
    if (startedRef.current) return;
    startedRef.current = true;

    void guidedOnboardingStateItem
      .getValue()
      .then((stored) => {
        const start = autoStartOnboarding(
          normalizeOnboardingProgress(stored),
          surface
        );
        if (!start) return;

        void persistOnboarding(start);
        setActive({ step: start.step, run: 1 });
      })
      .catch((error: unknown) => {
        captureError(error, { action: "onboarding.load" });
      });
  }, [surface]);

  useEffect(() => {
    function handleReplay(event: Event) {
      const detail = (event as CustomEvent<OnboardingReplayDetail>).detail;
      if (!detail || detail.surface !== surface) return;

      const next = replayOnboarding(surface);
      void persistOnboarding(next);
      setActive((current) => ({
        step: next.step,
        run: (current?.run ?? 0) + 1,
      }));
    }

    window.addEventListener(ONBOARDING_REPLAY_EVENT, handleReplay);
    return () =>
      window.removeEventListener(ONBOARDING_REPLAY_EVENT, handleReplay);
  }, [surface]);

  useEffect(() => {
    if (!active) return;

    const instance = driver(buildConfig(surface, instanceRef));
    instanceRef.current = instance;
    instance.drive(active.step);

    return () => {
      instanceRef.current = null;
      instance.destroy();
    };
  }, [active, surface]);

  return null;
}

function stepsFor(surface: OnboardingSurface): DriveStep[] {
  const definitions = ONBOARDING_STEPS[surface];

  return definitions.map((step, index) => {
    const popover: NonNullable<DriveStep["popover"]> = {
      title: i18n.t(step.titleKey),
      description: i18n.t(step.descriptionKey),
      side: step.side,
    };

    // The popup's last button hands off to Options; Options gets a plain Done.
    if (surface === "popup" && index === definitions.length - 1) {
      popover.doneBtnText = i18n.t("onboarding.continue");
    }

    return { element: step.element, popover };
  });
}

function buildConfig(
  surface: OnboardingSurface,
  instanceRef: { current: ReturnType<typeof driver> | null }
): Config {
  return {
    steps: stepsFor(surface),
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
      decoratePopover(popover, surface, opts.index, instanceRef.current);
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
      });
      instanceRef.current?.destroy();
    },
    onDestroyStarted: (_element, _step, opts) => {
      // Escape and overlay clicks are a skip, not an interruption. `api` is
      // our own cleanup, and `replaced` is a replay starting a fresh instance.
      if (
        opts.reason === "escape" ||
        opts.reason === "overlay" ||
        opts.reason === "close"
      ) {
        void persistOnboarding(skipOnboarding());
        instanceRef.current?.destroy();
      }
    },
  };
}

function decoratePopover(
  popover: PopoverDOM,
  surface: OnboardingSurface,
  step: number | undefined,
  instance: ReturnType<typeof driver> | null
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
  skipButton.onclick = () => {
    void persistOnboarding(skipOnboarding());
    instance?.destroy();
  };
  popover.footerButtons.prepend(skipButton);
}

async function persistOnboarding(next: OnboardingProgress): Promise<void> {
  try {
    await guidedOnboardingStateItem.setValue(next);
  } catch (error: unknown) {
    captureError(error, { action: "onboarding.persist" });
  }
}
