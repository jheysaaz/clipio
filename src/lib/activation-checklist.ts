/**
 * The first-success checklist shown after the guided tour.
 *
 * The tour explains the product; this decides whether the user has actually
 * done the three things that make Clipio useful. It is deliberately derived
 * from state the extension already keeps — the library, per-snippet usage
 * counts and the tour progress — so there is no second set of "did they?" flags
 * to drift out of sync with reality.
 *
 * The insertion step is tied to a snippet that is still in the library. A
 * lifetime counter would stay true after every snippet was deleted, leaving a
 * lone checked step above two unchecked ones.
 */

import type { Snippet } from "@/types";
import type { OnboardingProgress } from "./onboarding-progress";

export type ActivationStepId = "create" | "placeholder" | "insert";

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
  /** Per-snippet insertion counts from local usage tracking. */
  usageCounts: Readonly<Record<string, number>>;
  onboarding: OnboardingProgress;
  dismissed: unknown;
  /** False until the persisted state has been read, to avoid a flash. */
  isLoaded: boolean;
};

/**
 * The user-facing dynamic placeholders taught in the editor tip. Media tokens
 * (`{{image:…}}`, `{{gif:…}}`) and the internal raw-HTML token are deliberately
 * excluded: they are storage details, not the "make a reusable snippet dynamic"
 * idea this step is checking for.
 */
const DYNAMIC_PLACEHOLDER =
  /\{\{(?:clipboard|cursor|date:[a-z]+|datepicker:\d{4}-\d{2}-\d{2})\}\}/;

function hasPlaceholder(snippet: Snippet): boolean {
  return (
    typeof snippet.content === "string" &&
    DYNAMIC_PLACEHOLDER.test(snippet.content)
  );
}

function isPositiveCount(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasInserted(
  snippets: readonly Snippet[],
  usageCounts: Readonly<Record<string, number>>
): boolean {
  return snippets.some((snippet) => {
    // Current insertions are recorded in `usageCountsItem`; older backups carry
    // the count on the snippet itself. Either source counts only while the
    // snippet it describes is still in the library.
    return (
      isPositiveCount(usageCounts[snippet.id]) ||
      isPositiveCount(snippet.usageCount)
    );
  });
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
      id: "placeholder",
      done: input.snippets.some(hasPlaceholder),
    },
    {
      id: "insert",
      done: hasInserted(input.snippets, input.usageCounts),
    },
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
