/**
 * The first-success loop that follows the guided tour.
 *
 * The checklist lives in the options rail, never across the top of popup
 * views. Selectors are contracts: the checklist's own testids and the stable
 * `options-search` readiness handle. No assertion depends on copy.
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

async function waitForOptionsReady(page: Page): Promise<void> {
  await expect(page.getByTestId("options-search")).toBeVisible();
}

function step(page: Page, id: string) {
  return page.getByTestId(`activation-step-${id}`);
}

test.describe("activation after onboarding", () => {
  test("tracks creation, placeholder and first insertion in the options rail", async ({
    popupPage,
    optionsPage,
    storageHelper,
  }) => {
    await waitForOptionsReady(optionsPage);
    await setLocalItem(optionsPage, "totalSnippetInsertions", 0);
    await setLocalItem(optionsPage, "snippetUsageCount", {});
    await setLocalItem(optionsPage, "activationDismissed", false);
    await optionsPage.reload();
    await waitForOptionsReady(optionsPage);

    const checklist = optionsPage.getByTestId("activation-checklist");
    await expect(checklist).toBeVisible();
    await expect(step(optionsPage, "create")).toHaveAttribute(
      "data-done",
      "false"
    );
    await expect(step(optionsPage, "placeholder")).toHaveAttribute(
      "data-done",
      "false"
    );
    await expect(step(optionsPage, "placeholder")).toContainText(
      "Use a placeholder"
    );

    // The popup is the surface the card was removed from. Wait for it to be
    // ready first, or an assertion before hydration would prove nothing.
    await waitForPopupReady(popupPage);
    await expect(popupPage.getByTestId("activation-checklist")).toHaveCount(0);

    await storageHelper.seedSnippets([
      {
        id: "s1",
        label: "Signature",
        content: "Regards {{cursor}}",
        shortcut: "sig",
        tags: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    await optionsPage.reload();
    await waitForOptionsReady(optionsPage);

    await expect(step(optionsPage, "create")).toHaveAttribute(
      "data-done",
      "true"
    );
    await expect(step(optionsPage, "placeholder")).toHaveAttribute(
      "data-done",
      "true"
    );
    await expect(step(optionsPage, "insert")).toHaveAttribute(
      "data-done",
      "false"
    );

    await setLocalItem(optionsPage, "totalSnippetInsertions", 1);
    await setLocalItem(optionsPage, "snippetUsageCount", { s1: 1 });
    await optionsPage.reload();
    await waitForOptionsReady(optionsPage);

    await expect(checklist).toHaveCount(0);
  });

  test("starts over when the used snippet has been deleted", async ({
    optionsPage,
    storageHelper,
  }) => {
    // clearAll restores the completed tour but removes the library and its
    // usage counts. Re-seed only the orphaned signals from the old setup: a
    // lifetime insertion total and a usage count for a snippet that no longer
    // exists. Neither may leave "use it on a page" checked.
    await storageHelper.clearAll();
    await setLocalItem(optionsPage, "activationDismissed", false);
    await setLocalItem(optionsPage, "totalSnippetInsertions", 1);
    await setLocalItem(optionsPage, "snippetUsageCount", {
      "deleted-snippet": 1,
    });
    await optionsPage.reload();
    await waitForOptionsReady(optionsPage);

    const checklist = optionsPage.getByTestId("activation-checklist");
    await expect(checklist).toBeVisible();
    await expect(step(optionsPage, "create")).toHaveAttribute(
      "data-done",
      "false"
    );
    await expect(step(optionsPage, "placeholder")).toHaveAttribute(
      "data-done",
      "false"
    );
    await expect(step(optionsPage, "insert")).toHaveAttribute(
      "data-done",
      "false"
    );
  });

  test("dismissal survives a reload", async ({ optionsPage }) => {
    await waitForOptionsReady(optionsPage);
    await setLocalItem(optionsPage, "activationDismissed", false);
    await optionsPage.reload();
    await waitForOptionsReady(optionsPage);

    const checklist = optionsPage.getByTestId("activation-checklist");
    await expect(checklist).toBeVisible();
    await optionsPage.getByTestId("activation-dismiss").click();
    await expect(checklist).toHaveCount(0);
    expect(await getLocalItem(optionsPage, "activationDismissed")).toBe(true);

    await optionsPage.reload();
    await waitForOptionsReady(optionsPage);
    await expect(checklist).toHaveCount(0);
  });
});

test.describe("activation during onboarding", () => {
  test.use({ onboardingState: "fresh" });

  test("waits for the tour, then appears in the options rail when it is skipped", async ({
    popupPage,
    optionsPage,
  }) => {
    // A first-run tour starts in the popup and writes its progress to shared
    // storage. The options rail must stay quiet until that tour is over.
    await expect(popupPage.getByTestId("onboarding-popover")).toBeVisible();
    await expect(optionsPage.getByTestId("activation-checklist")).toHaveCount(
      0
    );

    await popupPage.getByTestId("onboarding-skip").click();

    await expect(optionsPage.getByTestId("activation-checklist")).toBeVisible();
  });
});
