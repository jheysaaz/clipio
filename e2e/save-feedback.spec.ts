/**
 * Browser coverage for save failures in the popup.
 *
 * The unit tests own the state decisions. These two tests own the parts that
 * only exist in a real extension: a create draft surviving its own commit, and
 * a terminal queue outcome being retried by the background drain.
 */

import { expect, test } from "./fixtures.js";
import { makeSnippet } from "./helpers/snippets.js";

async function waitForPopupReady(page: import("@playwright/test").Page) {
  await page.waitForSelector(
    '[data-testid="snippet-list"], [data-testid="empty-state"]',
    { timeout: 10_000 }
  );
}

async function createSnippet(
  popupPage: import("@playwright/test").Page,
  label: string,
  shortcut: string,
  body: string
) {
  await popupPage.getByTestId("add-snippet").click();
  await popupPage.getByTestId("snippet-label-input").fill(label);
  await popupPage.getByTestId("snippet-shortcut-input").fill(shortcut);
  const editor = popupPage.locator('[contenteditable="true"]').first();
  await editor.click();
  await popupPage.keyboard.type(body);
  await expect(popupPage).toHaveURL(/#\/snippet\//, { timeout: 10_000 });
}

test("a create draft left behind by its own commit does not conflict", async ({
  popupPage,
  storageHelper,
}) => {
  await storageHelper.clearAll();
  await popupPage.reload();
  await waitForPopupReady(popupPage);

  await createSnippet(popupPage, "First", "/first", "first body");

  const [first] = await storageHelper.readSyncSnippets();
  expect(first).toBeDefined();
  await storageHelper.setLocal("editorDrafts", {
    [first.id]: {
      id: first.id,
      fields: {
        label: "First",
        shortcut: "/first",
        content: "first body, typed after the flush",
        tags: [],
      },
      baseRev: 0,
      updatedAt: new Date().toISOString(),
      isNew: true,
    },
  });
  await popupPage.reload();
  await waitForPopupReady(popupPage);

  await createSnippet(popupPage, "Second", "/second", "second body");
  await expect(popupPage.getByTestId("snippet-list-item")).toHaveCount(2);

  const editor = popupPage.locator('[contenteditable="true"]').first();
  await editor.click();
  await popupPage.keyboard.type(" and more");

  await expect(popupPage.getByTestId("inline-error")).toHaveCount(0);
  await expect(
    popupPage.getByTestId("snippet-sync-status").getByTestId("retry-save")
  ).toHaveCount(0);
});

test("a failed save retries from the status button without a banner", async ({
  popupPage,
  storageHelper,
}) => {
  const snippet = makeSnippet({ label: "Retry me", shortcut: "/retry" });
  await storageHelper.clearAll();
  await storageHelper.seedSnippets([snippet]);
  await storageHelper.setLocal("writeQueue", {
    operations: [
      {
        id: "op-failed",
        snippetId: snippet.id,
        kind: "upsert",
        fields: {
          label: snippet.label,
          content: snippet.content,
          shortcut: snippet.shortcut,
          tags: [],
        },
        baseRev: 0,
        updatedAt: new Date().toISOString(),
        updatedBy: "another-writer",
        reason: "edit",
        attempts: 6,
        nextAttemptAt: Date.now(),
        status: "failed",
        error: "conflict",
        createdAt: Date.now(),
        inFlight: false,
      },
    ],
    sentAt: [],
  });

  const consoleErrors: string[] = [];
  popupPage.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await popupPage.reload();
  await waitForPopupReady(popupPage);
  await popupPage.getByTestId("snippet-list-item").click();

  const status = popupPage.getByTestId("snippet-sync-status");
  const retry = status.getByTestId("retry-save");
  await expect(retry).toBeVisible();
  // The detail lives in a stable attribute so changing the human copy does not
  // break this test; the assertion still proves it reaches the hover title.
  const detail = await retry.getAttribute("data-error-detail");
  expect(detail).toBeTruthy();
  await expect
    .poll(async () =>
      (await retry.getAttribute("title"))?.includes(detail ?? "")
    )
    .toBe(true);
  await expect(popupPage.getByTestId("inline-error")).toHaveCount(0);
  await expect
    .poll(() => consoleErrors.join("\n"))
    .toContain("[Clipio] snippet save failed");

  await retry.click();

  await expect(retry).toHaveCount(0);
});
