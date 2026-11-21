/**
 * The first-success loop that follows the guided tour.
 *
 * Selectors are contracts: the checklist's own testids, and the same stable
 * create-form ids the onboarding tour uses. No assertion depends on copy.
 */

import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures.js";
import { getLocalItem, setLocalItem } from "./helpers/storage.js";

async function waitForPopupReady(page: Page): Promise<void> {
  await page.waitForSelector(
    '[data-testid="snippet-list"], [data-testid="empty-state"]',
    { timeout: 10_000 }
  );
}

function step(page: Page, id: string) {
  return page.getByTestId(`activation-step-${id}`);
}

test.describe("activation after onboarding", () => {
  test("tracks creation, shortcut and first insertion", async ({
    popupPage,
  }) => {
    await waitForPopupReady(popupPage);
    await setLocalItem(popupPage, "totalSnippetInsertions", 0);
    await setLocalItem(popupPage, "activationDismissed", false);
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    const checklist = popupPage.getByTestId("activation-checklist");
    await expect(checklist).toBeVisible();
    await expect(step(popupPage, "create")).toHaveAttribute(
      "data-done",
      "false"
    );
    await expect(step(popupPage, "shortcut")).toHaveAttribute(
      "data-done",
      "false"
    );

    await popupPage.getByTestId("add-snippet").click();
    await popupPage.getByTestId("snippet-label-input").fill("Signature");
    await popupPage.getByTestId("snippet-shortcut-input").fill("sig");
    await popupPage.locator('[contenteditable="true"]').first().fill("Regards");
    await popupPage.getByTestId("snippet-create-save").click();

    await expect(step(popupPage, "create")).toHaveAttribute(
      "data-done",
      "true"
    );
    await expect(step(popupPage, "shortcut")).toHaveAttribute(
      "data-done",
      "true"
    );
    await expect(step(popupPage, "insert")).toHaveAttribute(
      "data-done",
      "false"
    );

    await setLocalItem(popupPage, "totalSnippetInsertions", 1);
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    await expect(checklist).toHaveCount(0);
  });

  test("dismissal survives a reload", async ({ popupPage }) => {
    await waitForPopupReady(popupPage);
    await setLocalItem(popupPage, "activationDismissed", false);
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    await expect(popupPage.getByTestId("activation-checklist")).toBeVisible();
    await popupPage.getByTestId("activation-dismiss").click();
    await expect(popupPage.getByTestId("activation-checklist")).toHaveCount(0);
    expect(await getLocalItem(popupPage, "activationDismissed")).toBe(true);

    await popupPage.reload();
    await waitForPopupReady(popupPage);
    await expect(popupPage.getByTestId("activation-checklist")).toHaveCount(0);
  });
});

test.describe("activation during onboarding", () => {
  test.use({ onboardingState: "fresh" });

  test("waits for the tour, then appears when it is skipped", async ({
    popupPage,
  }) => {
    await waitForPopupReady(popupPage);

    await expect(popupPage.getByTestId("onboarding-popover")).toBeVisible();
    await expect(popupPage.getByTestId("activation-checklist")).toHaveCount(0);

    await popupPage.getByTestId("onboarding-skip").click();

    await expect(popupPage.getByTestId("activation-checklist")).toBeVisible();
  });
});
