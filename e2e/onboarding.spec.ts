/**
 * The single guided flow, from the popup through to the options page.
 *
 * Existing specs seed a completed tour through the auto fixture, so this file
 * opts into the first-run state explicitly. Every selector is a stable
 * `data-testid`; the tour's own `data-step` attribute is part of that contract.
 */

import { test, expect, readOnboardingState } from "./fixtures.js";

test.use({ onboardingState: "fresh" });

test.describe("first-run onboarding", () => {
  test("auto-starts in the popup and walks its three steps", async ({
    popupPage,
  }) => {
    const popover = popupPage.getByTestId("onboarding-popover");

    await expect(popover).toBeVisible();
    await expect(popover).toHaveAttribute("data-surface", "popup");
    await expect(popover).toHaveAttribute("data-step", "0");
    await expect(popupPage.getByTestId("snippet-search")).toBeVisible();

    await popupPage.getByTestId("onboarding-next").click();
    await expect(popover).toHaveAttribute("data-step", "1");
    await expect(popupPage.getByTestId("add-snippet")).toBeVisible();

    await popupPage.getByTestId("onboarding-next").click();
    await expect(popover).toHaveAttribute("data-step", "2");
    await expect(popupPage.getByTestId("settings-button")).toBeVisible();
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
    await popupPage.getByTestId("onboarding-next").click();
    await popupPage.getByTestId("onboarding-next").click();
    await popupPage.getByTestId("onboarding-next").click();

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

test.describe("onboarding replay", () => {
  test.use({ onboardingState: "completed" });

  test("restarts the popup portion from its replay button", async ({
    popupPage,
  }) => {
    await expect(popupPage.getByTestId("onboarding-popover")).toHaveCount(0);

    await popupPage.getByTestId("onboarding-replay-popup").click();

    const popover = popupPage.getByTestId("onboarding-popover");
    await expect(popover).toBeVisible();
    await expect(popover).toHaveAttribute("data-surface", "popup");
    await expect(popover).toHaveAttribute("data-step", "0");
  });

  test("restarts the options portion from its replay button", async ({
    optionsPage,
  }) => {
    await expect(optionsPage.getByTestId("onboarding-popover")).toHaveCount(0);

    await optionsPage.getByTestId("onboarding-replay-options").click();

    const popover = optionsPage.getByTestId("onboarding-popover");
    await expect(popover).toBeVisible();
    await expect(popover).toHaveAttribute("data-surface", "options");
    await expect(popover).toHaveAttribute("data-step", "0");
    await expect(optionsPage.getByTestId("options-search")).toBeVisible();
  });
});
