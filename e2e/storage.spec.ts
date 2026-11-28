/**
 * Storage durability under a real extension origin.
 *
 * The pure storage rules — quota fallback, IndexedDB shadow writes, lock
 * behaviour — are covered in src/storage/*.test.ts. The one thing that cannot
 * be proved there is that a snippet created through the popup is still there
 * when the popup closes and opens again.
 */

import { test, expect } from "./fixtures.js";

async function waitForPopupReady(
  page: import("@playwright/test").Page
): Promise<void> {
  await page.waitForSelector(
    '[data-testid="snippet-list"], [data-testid="empty-state"]',
    { timeout: 10_000 }
  );
}

test.describe("Storage durability", () => {
  test("persists snippets in sync storage across popup reloads", async ({
    popupPage,
  }) => {
    // Start from an empty library. Setting the mode explicitly keeps this test
    // about durability rather than about whichever backend a previous test left
    // behind.
    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.sync.clear();
      await ext.storage.local.set({
        cachedSnippets: [],
        storageMode: "sync",
        lastViewedSnippetId: null,
      });
    });
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    // Create through the app, not by writing `snip:` directly: the point is
    // that the popup's autosave writes a record that survives a fresh mount.
    await popupPage.getByTestId("add-snippet").click();
    await popupPage.getByTestId("snippet-label-input").fill("Durability Test");
    await popupPage.getByTestId("snippet-shortcut-input").fill("/durability");
    const editor = popupPage
      .getByTestId("snippet-content-editor")
      .locator('[contenteditable="true"]');
    await editor.click();
    await popupPage.keyboard.type("Survives a popup reopen");
    await expect(popupPage).toHaveURL(/#\/snippet\//, { timeout: 10_000 });
    await expect(popupPage.getByTestId("snippet-list-item")).toHaveCount(1);

    // Reopen as the toolbar does: a bare popup URL, with no remembered route.
    await popupPage.goto(popupPage.url().split("#")[0] ?? popupPage.url());
    await waitForPopupReady(popupPage);

    const rows = popupPage.getByTestId("snippet-list-item");
    await expect(rows).toHaveCount(1);
    // The one row is addressed by its option role and the label seeded above;
    // no positional pick, and the label is test data, not product copy.
    await expect(
      popupPage.getByRole("option", { name: /Durability Test/ })
    ).toContainText("Durability Test");
  });
});
