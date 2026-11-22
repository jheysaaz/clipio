/**
 * Progress for the single guided onboarding flow.
 *
 * The tour starts in the popup and hands off to the options page. The two
 * documents cannot share a live overlay — opening Options blurs and closes the
 * popup — so progress is persisted and each surface resumes its own portion.
 *
 * This module owns the decisions; the React component only renders them.
 */

export type OnboardingSurface = "popup" | "options";

export type InProgressOnboarding = {
  status: "in_progress";
  surface: OnboardingSurface;
  step: number;
};

export type OnboardingProgress =
  | { status: "not_started" }
  | InProgressOnboarding
  | { status: "completed" }
  | { status: "skipped" };

export type OnboardingPopoverSide = "top" | "right" | "bottom" | "left";

export type OnboardingCopyKey =
  | "onboarding.popup.search.title"
  | "onboarding.popup.search.description"
  | "onboarding.popup.add.title"
  | "onboarding.popup.add.description"
  | "onboarding.popup.name.title"
  | "onboarding.popup.name.description"
  | "onboarding.popup.shortcut.title"
  | "onboarding.popup.shortcut.description"
  | "onboarding.popup.content.title"
  | "onboarding.popup.content.description"
  | "onboarding.popup.library.title"
  | "onboarding.popup.library.description"
  | "onboarding.popup.settings.title"
  | "onboarding.popup.settings.description"
  | "onboarding.options.search.title"
  | "onboarding.options.search.description"
  | "onboarding.options.nav.title"
  | "onboarding.options.nav.description"
  | "onboarding.options.library.title"
  | "onboarding.options.library.description";

/**
 * A UI transition the tour performs when leaving a step. The other surface of
 * the tour (React) owns the DOM click; this registry only names the intention,
 * so the pure decisions stay testable without a document.
 */
export type OnboardingStepAction = "open-create";

export type OnboardingStep = {
  /** Stable selector of the element the step highlights. */
  element: string;
  /** Literal locale keys, so the locale gate can see them. */
  titleKey: OnboardingCopyKey;
  descriptionKey: OnboardingCopyKey;
  side: OnboardingPopoverSide;
  /** Optional transition needed before the next step's element can exist. */
  nextAction?: OnboardingStepAction;
};

export const ONBOARDING_STEPS: Record<
  OnboardingSurface,
  readonly OnboardingStep[]
> = {
  popup: [
    {
      element: '[data-testid="snippet-search"]',
      titleKey: "onboarding.popup.search.title",
      descriptionKey: "onboarding.popup.search.description",
      side: "bottom",
    },
    {
      element: '[data-testid="add-snippet"]',
      titleKey: "onboarding.popup.add.title",
      descriptionKey: "onboarding.popup.add.description",
      side: "top",
      nextAction: "open-create",
    },
    {
      element: '[data-testid="snippet-label-input"]',
      titleKey: "onboarding.popup.name.title",
      descriptionKey: "onboarding.popup.name.description",
      side: "right",
    },
    {
      element: '[data-testid="snippet-shortcut-input"]',
      titleKey: "onboarding.popup.shortcut.title",
      descriptionKey: "onboarding.popup.shortcut.description",
      side: "right",
    },
    {
      element: '[data-testid="snippet-content-editor"]',
      titleKey: "onboarding.popup.content.title",
      descriptionKey: "onboarding.popup.content.description",
      side: "left",
    },
    {
      element: '[data-testid="snippet-library"]',
      titleKey: "onboarding.popup.library.title",
      descriptionKey: "onboarding.popup.library.description",
      side: "right",
    },
    {
      element: '[data-testid="settings-button"]',
      titleKey: "onboarding.popup.settings.title",
      descriptionKey: "onboarding.popup.settings.description",
      side: "top",
    },
  ],
  options: [
    {
      element: '[data-testid="options-search"]',
      titleKey: "onboarding.options.search.title",
      descriptionKey: "onboarding.options.search.description",
      side: "right",
    },
    {
      element: '[data-testid="options-nav"]',
      titleKey: "onboarding.options.nav.title",
      descriptionKey: "onboarding.options.nav.description",
      side: "right",
    },
    {
      element: '[data-testid="options-nav-library"]',
      titleKey: "onboarding.options.library.title",
      descriptionKey: "onboarding.options.library.description",
      side: "right",
    },
  ],
};

export const NOT_STARTED_ONBOARDING: OnboardingProgress = {
  status: "not_started",
};

export function stepCountFor(surface: OnboardingSurface): number {
  return ONBOARDING_STEPS[surface].length;
}

/** A valid in-progress state for a surface and step, clamped to that surface. */
export function onboardingAtStep(
  surface: OnboardingSurface,
  step: number
): InProgressOnboarding {
  const lastStep = stepCountFor(surface) - 1;
  return {
    status: "in_progress",
    surface,
    step: Math.min(Math.max(step, 0), lastStep),
  };
}

/**
 * Read persisted progress without trusting it. Storage is user-editable and an
 * older build may have left a differently shaped value behind; a bad shape must
 * start over rather than crash the popup.
 */
export function normalizeOnboardingProgress(
  value: unknown
): OnboardingProgress {
  if (typeof value !== "object" || value === null) {
    return NOT_STARTED_ONBOARDING;
  }

  const candidate = value as Partial<{
    status: unknown;
    surface: unknown;
    step: unknown;
  }>;

  if (
    candidate.status === "in_progress" &&
    (candidate.surface === "popup" || candidate.surface === "options") &&
    typeof candidate.step === "number" &&
    Number.isInteger(candidate.step)
  ) {
    return onboardingAtStep(candidate.surface, candidate.step);
  }

  if (
    candidate.status === "completed" ||
    candidate.status === "skipped" ||
    candidate.status === "not_started"
  ) {
    return { status: candidate.status };
  }

  return NOT_STARTED_ONBOARDING;
}

/**
 * Whether a surface should start automatically on load.
 *
 * Only the popup can begin a fresh flow. The options page starts only after an
 * explicit handoff, so opening Options first does not skip the popup portion.
 */
export function autoStartOnboarding(
  progress: OnboardingProgress,
  surface: OnboardingSurface
): InProgressOnboarding | null {
  if (progress.status === "not_started") {
    return surface === "popup" ? onboardingAtStep("popup", 0) : null;
  }

  if (progress.status === "in_progress" && progress.surface === surface) {
    return onboardingAtStep(surface, progress.step);
  }

  return null;
}

/** Finishing the popup hands off; finishing Options completes the whole flow. */
export function finishOnboarding(
  surface: OnboardingSurface
): OnboardingProgress {
  return surface === "popup"
    ? onboardingAtStep("options", 0)
    : { status: "completed" };
}

export function skipOnboarding(): OnboardingProgress {
  return { status: "skipped" };
}

/** True when a finish result needs to open the options page. */
export function isOptionsHandoff(progress: OnboardingProgress): boolean {
  return (
    progress.status === "in_progress" &&
    progress.surface === "options" &&
    progress.step === 0
  );
}
