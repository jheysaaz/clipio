import { describe, expect, it } from "vitest";

import {
  NOT_STARTED_ONBOARDING,
  ONBOARDING_STEPS,
  autoStartOnboarding,
  finishOnboarding,
  isOptionsHandoff,
  normalizeOnboardingProgress,
  onboardingAtStep,
  skipOnboarding,
  stepCountFor,
} from "./onboarding-progress";

describe("onboarding step registry", () => {
  it("defines the expanded popup walkthrough and the options portion", () => {
    expect(ONBOARDING_STEPS.popup).toHaveLength(10);
    expect(ONBOARDING_STEPS.options).toHaveLength(3);
    expect(stepCountFor("popup")).toBe(10);
    expect(stepCountFor("options")).toBe(3);
  });

  it("opens and closes the create form where the walkthrough needs it", () => {
    expect(ONBOARDING_STEPS.popup[1]?.nextAction).toBe("open-create");
    expect(ONBOARDING_STEPS.popup[7]?.nextAction).toBe("close-create");
    expect(
      ONBOARDING_STEPS.popup.filter((step) => step.nextAction)
    ).toHaveLength(2);
  });

  it("uses distinct stable selectors for every step", () => {
    const selectors = [
      ...ONBOARDING_STEPS.popup.map((step) => step.element),
      ...ONBOARDING_STEPS.options.map((step) => step.element),
    ];

    expect(new Set(selectors).size).toBe(selectors.length);
  });
});

describe("onboardingAtStep", () => {
  it("clamps a step below zero to the first step", () => {
    expect(onboardingAtStep("popup", -5)).toEqual({
      status: "in_progress",
      surface: "popup",
      step: 0,
    });
  });

  it("clamps a step past the end to the last step", () => {
    expect(onboardingAtStep("options", 99)).toEqual({
      status: "in_progress",
      surface: "options",
      step: stepCountFor("options") - 1,
    });
  });

  it("keeps a valid step unchanged", () => {
    expect(onboardingAtStep("popup", 1)).toEqual({
      status: "in_progress",
      surface: "popup",
      step: 1,
    });
  });
});

describe("normalizeOnboardingProgress", () => {
  it("treats missing progress as not started", () => {
    expect(normalizeOnboardingProgress(undefined)).toEqual(
      NOT_STARTED_ONBOARDING
    );
    expect(normalizeOnboardingProgress(null)).toEqual(NOT_STARTED_ONBOARDING);
    expect(normalizeOnboardingProgress("completed")).toEqual(
      NOT_STARTED_ONBOARDING
    );
  });

  it("preserves valid in-progress state and clamps an out-of-range step", () => {
    expect(
      normalizeOnboardingProgress({
        status: "in_progress",
        surface: "popup",
        step: 2,
      })
    ).toEqual({ status: "in_progress", surface: "popup", step: 2 });
    expect(
      normalizeOnboardingProgress({
        status: "in_progress",
        surface: "options",
        step: 42,
      })
    ).toEqual({
      status: "in_progress",
      surface: "options",
      step: stepCountFor("options") - 1,
    });
  });

  it("rejects an in-progress state with an unknown surface or non-integer step", () => {
    expect(
      normalizeOnboardingProgress({
        status: "in_progress",
        surface: "dashboard",
        step: 0,
      })
    ).toEqual(NOT_STARTED_ONBOARDING);
    expect(
      normalizeOnboardingProgress({
        status: "in_progress",
        surface: "popup",
        step: 1.5,
      })
    ).toEqual(NOT_STARTED_ONBOARDING);
  });

  it("preserves the terminal states", () => {
    expect(normalizeOnboardingProgress({ status: "completed" })).toEqual({
      status: "completed",
    });
    expect(normalizeOnboardingProgress({ status: "skipped" })).toEqual({
      status: "skipped",
    });
    expect(normalizeOnboardingProgress({ status: "not_started" })).toEqual(
      NOT_STARTED_ONBOARDING
    );
  });

  it("rejects an unknown status", () => {
    expect(normalizeOnboardingProgress({ status: "paused" })).toEqual(
      NOT_STARTED_ONBOARDING
    );
  });
});

describe("autoStartOnboarding", () => {
  it("starts a fresh flow in the popup only", () => {
    expect(autoStartOnboarding(NOT_STARTED_ONBOARDING, "popup")).toEqual({
      status: "in_progress",
      surface: "popup",
      step: 0,
    });
    expect(autoStartOnboarding(NOT_STARTED_ONBOARDING, "options")).toBeNull();
  });

  it("resumes an interrupted tour on the same surface", () => {
    expect(
      autoStartOnboarding(
        { status: "in_progress", surface: "popup", step: 1 },
        "popup"
      )
    ).toEqual({ status: "in_progress", surface: "popup", step: 1 });
  });

  it("does not resume the other surface's portion", () => {
    expect(
      autoStartOnboarding(
        { status: "in_progress", surface: "popup", step: 1 },
        "options"
      )
    ).toBeNull();
  });

  it("does not auto-start after completion or skip", () => {
    expect(autoStartOnboarding({ status: "completed" }, "popup")).toBeNull();
    expect(autoStartOnboarding({ status: "skipped" }, "options")).toBeNull();
  });
});

describe("finishOnboarding", () => {
  it("hands off from the popup to Options", () => {
    const result = finishOnboarding("popup");
    expect(result).toEqual({
      status: "in_progress",
      surface: "options",
      step: 0,
    });
    expect(isOptionsHandoff(result)).toBe(true);
  });

  it("completes the flow from Options", () => {
    const result = finishOnboarding("options");
    expect(result).toEqual({ status: "completed" });
    expect(isOptionsHandoff(result)).toBe(false);
  });

  it("does not treat a later options step as a handoff", () => {
    expect(
      isOptionsHandoff({
        status: "in_progress",
        surface: "options",
        step: 1,
      })
    ).toBe(false);
  });
});

describe("skipOnboarding", () => {
  it("records a skipped flow", () => {
    expect(skipOnboarding()).toEqual({ status: "skipped" });
  });
});
