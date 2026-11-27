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

test("a shortcut edit after a committed save does not conflict with us", async ({
  popupPage,
  storageHelper,
}) => {
  const snippet = makeSnippet({
    id: "stale-draft-shortcut",
    label: "Shortcut",
    shortcut: "/short",
    content: "body",
    rev: 2,
    updatedBy: "writer-1",
  });
  await storageHelper.clearAll();
  await storageHelper.seedSnippets([snippet]);
  // Model the instant after our own commit: the snippet has advanced but the
  // background has not yet removed the draft that was built from the old rev.
  await storageHelper.setLocal("editorDrafts", {
    [snippet.id]: {
      id: snippet.id,
      fields: {
        label: snippet.label,
        shortcut: snippet.shortcut,
        content: snippet.content,
        tags: [],
      },
      baseRev: 1,
      updatedAt: new Date().toISOString(),
      isNew: false,
    },
  });

  const consoleErrors: string[] = [];
  popupPage.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await popupPage.reload();
  await waitForPopupReady(popupPage);
  await popupPage.getByTestId("snippet-list-item").click();

  const input = popupPage.getByTestId("snippet-shortcut-input");
  await input.click();
  await input.press("End");
  await popupPage.keyboard.type(" more");

  // The space is rewritten to a dash before autosave. The write must use the
  // revision the popup already knows about, not the stale draft's revision.
  await expect
    .poll(async () => (await storageHelper.readSyncSnippets())[0]?.shortcut, {
      timeout: 10_000,
    })
    .toBe("/short-more");
  await expect(
    popupPage.getByTestId("snippet-sync-status").getByTestId("retry-save")
  ).toHaveCount(0);
  expect(
    consoleErrors.filter((line) => line.includes("snippet save failed"))
  ).toEqual([]);
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
