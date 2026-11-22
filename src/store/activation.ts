/**
 * Persisted inputs to the first-success checklist.
 *
 * The checklist has almost no state of its own: whether the user created a
 * snippet comes from the library, whether they inserted one comes from the
 * insertion counter, and whether the tour is still talking comes from its
 * progress item. This store only makes those three values reactive wherever
 * the checklist is mounted, and owns the one thing that is genuinely an action
 * — dismissal.
 */

import { createStore } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";

import { captureError } from "@/lib/sentry";
import {
  NOT_STARTED_ONBOARDING,
  normalizeOnboardingProgress,
  type OnboardingProgress,
} from "@/lib/onboarding-progress";
import {
  activationDismissedItem,
  guidedOnboardingStateItem,
  totalSnippetInsertionsItem,
} from "@/storage/items";

export type ActivationState = {
  onboarding: OnboardingProgress;
  totalInsertions: number;
  dismissed: boolean;
  isLoaded: boolean;
};

export const activationStore = createStore<ActivationState>({
  onboarding: NOT_STARTED_ONBOARDING,
  totalInsertions: 0,
  dismissed: false,
  isLoaded: false,
});

function normalizeInsertions(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

export async function loadActivation(): Promise<void> {
  try {
    const [onboarding, insertions, dismissed] = await Promise.all([
      guidedOnboardingStateItem.getValue(),
      totalSnippetInsertionsItem.getValue(),
      activationDismissedItem.getValue(),
    ]);
    activationStore.setState(() => ({
      onboarding: normalizeOnboardingProgress(onboarding),
      totalInsertions: normalizeInsertions(insertions),
      dismissed: dismissed === true,
      isLoaded: true,
    }));
  } catch (error) {
    captureError(error, { action: "activation.load" });
    // Still mark loaded: leaving it false would keep the checklist invisible
    // for the life of the popup and turn a storage hiccup into a silent hole.
    activationStore.setState(() => ({
      onboarding: NOT_STARTED_ONBOARDING,
      totalInsertions: 0,
      dismissed: false,
      isLoaded: true,
    }));
  }
}

/** Dismiss once, permanently. The store reflects the click before storage does. */
export async function dismissActivation(): Promise<void> {
  activationStore.setState((prev) => ({ ...prev, dismissed: true }));
  try {
    await activationDismissedItem.setValue(true);
  } catch (error) {
    captureError(error, { action: "activation.dismiss" });
  }
}

// These items can change while the options page is open: the tour writes its
// state on skip, and a content script counts an insertion in a completely
// different document. Storage's own change event is the only way the card
// reacts to either without polling.
guidedOnboardingStateItem.watch((stored) => {
  const onboarding = normalizeOnboardingProgress(stored);
  activationStore.setState((prev) => ({ ...prev, onboarding }));
});

totalSnippetInsertionsItem.watch((stored) => {
  const totalInsertions = normalizeInsertions(stored);
  if (totalInsertions === activationStore.state.totalInsertions) return;
  activationStore.setState((prev) => ({ ...prev, totalInsertions }));
});

activationDismissedItem.watch((stored) => {
  const dismissed = stored === true;
  if (dismissed === activationStore.state.dismissed) return;
  activationStore.setState((prev) => ({ ...prev, dismissed }));
});

void loadActivation();

export function useActivation<T>(selector: (state: ActivationState) => T): T {
  return useStore(activationStore, selector);
}

/** Component tests leave the singleton mid-checklist; restore it each time. */
export function resetActivationForTests(): void {
  activationStore.setState(() => ({
    onboarding: NOT_STARTED_ONBOARDING,
    totalInsertions: 0,
    dismissed: false,
    isLoaded: false,
  }));
}
