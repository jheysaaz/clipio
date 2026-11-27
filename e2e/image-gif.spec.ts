/**
 * Image / GIF browser coverage.
 *
 * Only one seam here needs a browser: an imported opaque media id must survive
 * the trip through IndexedDB and become a real rendered image after content
 * script expansion. Protocol validation, missing-blob labels and GIF fallbacks
 * are unit-tested in src/lib/ and src/storage/.
 */

import { test, expect } from "./fixtures.js";
import { makeSnippet } from "./helpers/snippets.js";
import { waitForContentScriptReady } from "./helpers/content-script.js";
import { writeBackupMedia } from "./helpers/storage.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getExtPage(
  context: import("@playwright/test").BrowserContext,
  extensionId: string
) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForLoadState("domcontentloaded");
  // Settle after the extension page loads so React has committed its first
  // paint before a test does a one-shot read. Genuine render settle, not a
  // stand-in for a condition: tests that wait for data poll for that data.
  await page.waitForTimeout(400);
  return page;
}

/**
 * Write a fake media entry (with alt text) directly into the extension's
 * IndexedDB media store, using an extension-origin page so IDB is accessible.
 */
async function seedMediaEntry(
  context: import("@playwright/test").BrowserContext,
  extensionId: string,
  entry: { id: string; alt?: string }
) {
  const page = await getExtPage(context, extensionId);
  // Minimal 1x1 PNG
  const png = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ];
  await writeBackupMedia(page, {
    id: entry.id,
    bytes: png,
    mimeType: "image/png",
    width: 1,
    height: 1,
    ...(entry.alt !== undefined ? { alt: entry.alt } : {}),
  });

  await page.close();
}

/** Reload after seeding so the content script sees the new cached snippets. */
async function reloadWithSnippets(
  testPage: import("@playwright/test").Page,
  storageHelper: import("./fixtures.js").StorageHelper,
  snippets: import("../src/types/index.js").Snippet[]
) {
  await storageHelper.seedSnippets(snippets);
  await testPage.reload();
  await testPage.waitForLoadState("domcontentloaded");
  await waitForContentScriptReady(testPage);
}

async function typeShortcut(
  testPage: import("@playwright/test").Page,
  shortcut: string
) {
  const field = testPage.getByTestId("contenteditable-field");
  await field.click();
  await testPage.keyboard.type(shortcut);
  return field;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Image / GIF feature tests", () => {
  // -------------------------------------------------------------------------
  // 1. selectNewest: popup auto-selects the most-recently-updated snippet
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // 3. Imported opaque ids and failure fallbacks
  // -------------------------------------------------------------------------

  test("expands an imported opaque image id into the stored blob", async ({
    context,
    extensionId,
    testPage,
    storageHelper,
  }) => {
    // ZIP imports accept ids such as `media_1`, but the placeholder grammar
    // used to accept only UUID-style hex. The blob restored and the snippet
    // still showed literal text; both boundaries now use one charset.
    const mediaId = "media_1";
    await seedMediaEntry(context, extensionId, { id: mediaId });
    await reloadWithSnippets(testPage, storageHelper, [
      makeSnippet({
        id: "imported-image-snippet",
        shortcut: "/imported-image",
        content: `{{image:${mediaId}}}`,
      }),
    ]);

    const field = await typeShortcut(testPage, "/imported-image");

    await expect(field.locator("img")).toHaveCount(1, { timeout: 5_000 });
    await expect(field.locator("img").first()).toHaveAttribute("src", /^data:/);
  });
});
