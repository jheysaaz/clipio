/**
 * The first-success checklist shown after the guided tour.
 *
 * The tour explains the product; this decides whether the user has actually
 * done the three things that make Clipio useful. It is deliberately derived
 * from state the extension already keeps — the library, the insertion counter
 * and the tour progress — so there is no second set of "did they?" flags to
 * drift out of sync with reality.
 */

import type { Snippet } from "@/types";
import type { OnboardingProgress } from "./onboarding-progress";

export type ActivationStepId = "create" | "shortcut" | "insert";

export type ActivationStep = {
  id: ActivationStepId;
  done: boolean;
};

export type ActivationChecklist = {
  /** Whether the options rail should render the checklist right now. */
  visible: boolean;
  complete: boolean;
  doneCount: number;
  total: number;
  steps: readonly ActivationStep[];
};

export type ActivationInput = {
  snippets: readonly Snippet[];
  totalInsertions: unknown;
  onboarding: OnboardingProgress;
  dismissed: unknown;
  /** False until the persisted state has been read, to avoid a flash. */
  isLoaded: boolean;
};

function hasShortcut(snippet: Snippet): boolean {
  return typeof snippet.shortcut === "string" && snippet.shortcut.trim() !== "";
}

function hasInserted(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Derive the checklist from current state.
 *
 * Hidden while the tour is still running: an overlay explaining the search box
 * and a card asking the user to use it are two voices making the same request.
 * Hidden before the tour has started too, because the tour auto-starts on both
 * surfaces and showing the checklist for the few milliseconds before that
 * resolves would be a flash of UI that immediately disappears.
 */
export function activationChecklist(
  input: ActivationInput
): ActivationChecklist {
  const steps: readonly ActivationStep[] = [
    { id: "create", done: input.snippets.length > 0 },
    {
      id: "shortcut",
      done: input.snippets.some(hasShortcut),
    },
    { id: "insert", done: hasInserted(input.totalInsertions) },
  ];

  const doneCount = steps.filter((step) => step.done).length;
  const complete = doneCount === steps.length;
  const tourActive = input.onboarding.status === "in_progress";
  const tourFinished =
    input.onboarding.status === "completed" ||
    input.onboarding.status === "skipped";

  return {
    visible:
      input.isLoaded &&
      input.dismissed !== true &&
      !complete &&
      !tourActive &&
      tourFinished,
    complete,
    doneCount,
    total: steps.length,
    steps,
  };
}
