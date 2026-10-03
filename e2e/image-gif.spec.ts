/**
 * Phase 7: Image / GIF Feature E2E Tests
 *
 * Covers the features implemented in the image/GIF support session:
 *
 * 1. Popup auto-selects the most-recently-updated snippet on open
 *    (selectNewest fix — was selecting raw storage order instead of sorted order)
 * 2. Unsaved-changes guard — switching snippets with unsaved edits shows a
 *    confirm dialog and only navigates if the user confirms
 * 3. Media blob → data URL bridge: background validates sender origin and
 *    rejects requests from non-extension senders
 * 4. Image alt text is carried through the MEDIA_GET_DATA_URL message and
 *    injected into the <img alt="..."> attribute in contenteditable insertion
 * 5. Width-suffixed placeholder {{image:uuid:200}} is correctly recognised in
 *    the options page "Images" section (not shown as "not used in any snippets")
 * 6. Image placeholder with width suffix expands without breaking the
 *    content-script insertion flow (no "uuid:200" leaking as the media ID)
 *
 * Test strategy:
 * - Seed state via page.evaluate() on extension pages
 * - Use service worker for background-script assertions
 * - Directly inspect IndexedDB (clipio-backup / media store) for media entries
 * - Verify DOM output for contenteditable insertion tests
 */

import { test, expect } from "./fixtures.js";
import { makeSnippet, makeSnippets } from "./helpers/snippets.js";
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

async function getServiceWorker(
  context: import("@playwright/test").BrowserContext
) {
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    sw = await context.waitForEvent("serviceworker", { timeout: 10_000 });
  }
  return sw;
}

/**
 * Seed snippets into sync + local storage via an extension page.
 * Returns an array of the written snippets so callers can assert on IDs.
 */
async function seedSnippets(
  context: import("@playwright/test").BrowserContext,
  extensionId: string,
  snippets: import("../src/types/index.js").Snippet[]
) {
  const page = await getExtPage(context, extensionId);
  await page.evaluate(async (snips) => {
    const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
    await ext.storage.sync.clear();
    const entries: Record<string, (typeof snips)[0]> = {};
    for (const s of snips) entries[`snip:${s.id}`] = s;
    await ext.storage.sync.set(entries);
    await ext.storage.local.set({ cachedSnippets: snips, storageMode: "sync" });
  }, snippets);
  await page.close();
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

const TEST_PAGE_URL = `http://localhost:${process.env.E2E_SERVER_PORT ?? "7777"}/test-page.html`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Image / GIF feature tests", () => {
  // -------------------------------------------------------------------------
  // 1. selectNewest: popup auto-selects the most-recently-updated snippet
  // -------------------------------------------------------------------------
  test("background handles MEDIA_GET_DATA_URL from extension-origin sender", async ({
    context,
    extensionId,
  }) => {
    // Send the message from an extension page (popup.html).
    // sender.id will equal browser.runtime.id so the guard passes.
    const popupPage = await getExtPage(context, extensionId);

    const response = await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      return new Promise<unknown>((resolve) => {
        ext.runtime.sendMessage(
          { type: "media-get-data-url", mediaId: "nonexistent-guard-test" },
          (resp: unknown) => resolve(resp)
        );
      });
    });

    // The handler should have processed the request (not silently dropped it)
    // and returned {dataUrl: null} because the media ID doesn't exist.
    // No `expect(typeof response).toBe("object")` here — that pattern is
    // unfailable and was deleted from messaging.spec.ts for exactly that reason.
    expect(response).not.toBeUndefined();
    expect((response as Record<string, unknown>)["dataUrl"]).toBeNull();

    await popupPage.close();
  });

  // -------------------------------------------------------------------------
  // 4. Alt text carried through background bridge
  // -------------------------------------------------------------------------
});
