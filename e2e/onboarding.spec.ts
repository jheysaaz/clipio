/**
 * The single guided flow, from the popup through to the options page.
 *
 * Existing specs seed a completed tour through the auto fixture, so this file
 * opts into the first-run state explicitly. Every selector is a stable
 * `data-testid`; the tour's own `data-step` attribute is part of that contract.
 */

import type { Page } from "@playwright/test";
import { test, expect, readOnboardingState } from "./fixtures.js";

test.use({ onboardingState: "fresh" });

const POPUP_STEPS = [
  "snippet-search",
  "add-snippet",
  "snippet-label-input",
  "snippet-shortcut-input",
  "snippet-shortcut-tip",
  "snippet-content-editor",
  "snippet-placeholder-tip",
  "snippet-create-save",
  "snippet-library",
  "settings-button",
] as const;

async function expectPopupStep(
  popupPage: Page,
  index: number,
  target: string
): Promise<void> {
  const popover = popupPage.getByTestId("onboarding-popover");
  await expect(popover).toHaveAttribute("data-surface", "popup");
  await expect(popover).toHaveAttribute("data-step", String(index));
  await expect(popupPage.getByTestId(target)).toBeVisible();
}

test.describe("first-run onboarding", () => {
  test("walks every popup step, including creating a snippet draft", async ({
    popupPage,
  }) => {
    const popover = popupPage.getByTestId("onboarding-popover");

    await expect(popover).toBeVisible();
    await expect(popupPage.getByTestId("snippet-label-input")).toHaveCount(0);

    for (const [index, target] of POPUP_STEPS.entries()) {
      await expectPopupStep(popupPage, index, target);

      if (index === 1) {
        await popupPage.getByTestId("onboarding-next").click();
        await expect(
          popupPage.getByTestId("snippet-label-input")
        ).toBeVisible();
        continue;
      }

      if (index === 7) {
        await popupPage.getByTestId("onboarding-next").click();
        await expect(popupPage.getByTestId("snippet-label-input")).toHaveCount(
          0
        );
        continue;
      }

      if (index < POPUP_STEPS.length - 1) {
        await popupPage.getByTestId("onboarding-next").click();
      }
    }
  });

  test("skips without starting again on the next popup open", async ({
    context,
    popupPage,
  }) => {
    const popover = popupPage.getByTestId("onboarding-popover");
    await expect(popover).toBeVisible();

    await popupPage.getByTestId("onboarding-skip").click();

    await expect(popover).toHaveCount(0);
    expect(await readOnboardingState(context)).toEqual({ status: "skipped" });

    await popupPage.reload();
    await expect(popupPage.getByTestId("snippet-search")).toBeVisible();
    await expect(popover).toHaveCount(0);
  });

  test("hands off to Options and resumes the options portion", async ({
    context,
    popupPage,
  }) => {
    await expect(popupPage.getByTestId("onboarding-popover")).toBeVisible();

    const optionsOpened = context.waitForEvent("page");
    for (let step = 0; step < POPUP_STEPS.length; step += 1) {
      await popupPage.getByTestId("onboarding-next").click();
    }

    const optionsPage = await optionsOpened;
    const popover = optionsPage.getByTestId("onboarding-popover");
    await expect(popover).toBeVisible();
    await expect(popover).toHaveAttribute("data-surface", "options");
    await expect(popover).toHaveAttribute("data-step", "0");
    expect(await readOnboardingState(context)).toEqual({
      status: "in_progress",
      surface: "options",
      step: 0,
    });

    await optionsPage.getByTestId("onboarding-next").click();
    await expect(popover).toHaveAttribute("data-step", "1");
    await expect(optionsPage.getByTestId("options-nav")).toBeVisible();
  });
});

test.describe("completed onboarding", () => {
  test.use({ onboardingState: "completed" });

  test("has no tour or replay controls", async ({ popupPage, optionsPage }) => {
    await expect(popupPage.getByTestId("onboarding-popover")).toHaveCount(0);
    await expect(popupPage.getByTestId("onboarding-replay-popup")).toHaveCount(
      0
    );
    await expect(optionsPage.getByTestId("onboarding-popover")).toHaveCount(0);
    await expect(
      optionsPage.getByTestId("onboarding-replay-options")
    ).toHaveCount(0);
  });
});
