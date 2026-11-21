/**
 * Cheap gate in front of the guided tour.
 *
 * Both entrypoints render this instead of importing `OnboardingTour` directly.
 * It reads only the small progress item during an ordinary popup/options load;
 * Driver.js and the tour component are fetched in a separate chunk only when
 * there is a tour to show. Once the tour closes, the component is removed and
 * its overlay and listeners are torn down.
 */

import { useCallback, useEffect, useState, type ComponentType } from "react";

import { captureError } from "@/lib/sentry";
import {
  autoStartOnboarding,
  normalizeOnboardingProgress,
  type InProgressOnboarding,
  type OnboardingSurface,
} from "@/lib/onboarding-progress";
import { guidedOnboardingStateItem } from "@/storage/items";
import type { OnboardingTourProps } from "./OnboardingTour";

type TourComponent = ComponentType<OnboardingTourProps>;
type TourModule = { OnboardingTour: TourComponent };

function loadOnboardingTour(): Promise<TourModule> {
  return import("./OnboardingTour");
}

export type OnboardingLoaderProps = {
  surface: OnboardingSurface;
  /** Injectable for tests; production always uses the dynamic import above. */
  loadTour?: () => Promise<TourModule>;
};

export function OnboardingLoader({
  surface,
  loadTour = loadOnboardingTour,
}: OnboardingLoaderProps) {
  const [start, setStart] = useState<InProgressOnboarding | null>(null);
  const [Tour, setTour] = useState<TourComponent | null>(null);

  const handleClose = useCallback(() => {
    setTour(null);
    setStart(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void guidedOnboardingStateItem
      .getValue()
      .then((stored) => {
        const next = autoStartOnboarding(
          normalizeOnboardingProgress(stored),
          surface
        );
        if (!next || cancelled) return;

        setStart(next);
        void loadTour()
          .then((module) => {
            if (!cancelled) setTour(() => module.OnboardingTour);
          })
          .catch((error: unknown) => {
            captureError(error, { action: "onboarding.import" });
          });
      })
      .catch((error: unknown) => {
        captureError(error, { action: "onboarding.load" });
      });

    return () => {
      cancelled = true;
    };
  }, [surface, loadTour]);

  if (!Tour || !start) return null;

  return <Tour surface={surface} start={start} onClose={handleClose} />;
}
