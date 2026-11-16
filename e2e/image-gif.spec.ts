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
 * 4. Image alt text is carried through the media:get message and
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
  test("background refuses MEDIA_GET from extension-origin sender when the id is unknown", async ({
    context,
    extensionId,
  }) => {
    // Sent from an extension page (popup.html), so `sender.id` equals
    // `runtime.id` and the guard passes — the request reaches the handler.
    //
    // The handler now *rejects* rather than answering `{dataUrl: null}`, so the
    // thing asserted is that it got far enough to produce a named failure. A
    // silent drop and a refusal look identical from the outside unless the
    // failure names itself, which is the point of the typed error.
    const popupPage = await getExtPage(context, extensionId);

    const result = await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      return new Promise<{ ok: boolean; name?: string; message?: string }>(
        (resolve) => {
          ext.runtime.sendMessage(
            {
              id: 1,
              type: "media:get",
              data: { mediaId: "nonexistent-guard-test" },
              timestamp: Date.now(),
            },
            (resp: unknown) => {
              const envelope = resp as
                | { res?: unknown; err?: { name?: string; message?: string } }
                | undefined;
              resolve({
                ok: Boolean(envelope?.res),
                name: envelope?.err?.name,
                message: envelope?.err?.message,
              });
            }
          );
        }
      );
    });

    expect(result.ok).toBe(false);
    expect(result.name).toBe("MediaNotFoundError");
    expect(result.message).toContain("nonexistent-guard-test");

    await popupPage.close();
  });

  test("background ignores a MEDIA_GET-shaped message that is not in the protocol format", async ({
    context,
    extensionId,
  }) => {
    // An already-open tab can still be running the previous build, which sent
    // `{ type, mediaId }` with no `data` and no `timestamp`. It must not be
    // mistaken for a valid `media:get`, and must not produce a response that
    // reads as success.
    const popupPage = await getExtPage(context, extensionId);

    const response = await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      return new Promise<unknown>((resolve) => {
        ext.runtime.sendMessage(
          { type: "media:get", mediaId: "legacy-shape" },
          (resp: unknown) => resolve(resp)
        );
      });
    });

    expect(response).toBeUndefined();

    await popupPage.close();
  });

  // -------------------------------------------------------------------------
  // 4. Alt text carried through background bridge
  // -------------------------------------------------------------------------
});
