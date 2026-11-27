/**
 * Image / GIF end-to-end coverage.
 *
 * Covers the browser-only seams that unit tests cannot:
 *
 * 1. `media:get` refuses requests that are not in the protocol format
 * 2. `media:get` names an unknown id rather than silently answering null
 * 3. an imported opaque id (`media_1`) expands to a real data URL image
 * 4. a placeholder whose blob is gone expands to a visible [image] label
 * 5. a GIF expands to an image wrapped in a usable link when the host blocks
 *    the remote CDN image
 *
 * Test strategy:
 * - Seed snippets through the storage fixture, then reload so the content
 *   script rebuilds its cache before typing
 * - Seed media through the extension's IndexedDB while on an extension page
 * - Assert on stable test ids and rendered DOM, never on debounce timings
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

  test("expands a placeholder with no stored blob to a visible label", async ({
    testPage,
    storageHelper,
  }) => {
    await reloadWithSnippets(testPage, storageHelper, [
      makeSnippet({
        id: "missing-image-snippet",
        shortcut: "/missing-image",
        content: "before {{image:missing-media-id}} after",
      }),
    ]);

    const field = await typeShortcut(testPage, "/missing-image");

    // A missing blob must not make the whole expansion disappear.
    await expect(field).toContainText("before [image] after", {
      timeout: 5_000,
    });
    await expect(field.locator("img")).toHaveCount(0);
  });

  test("expands a GIF into an image with a usable link fallback", async ({
    testPage,
    storageHelper,
  }) => {
    await reloadWithSnippets(testPage, storageHelper, [
      makeSnippet({
        id: "gif-fallback-snippet",
        shortcut: "/gif-fallback",
        content: "{{gif:abc123}}",
      }),
    ]);

    const field = await typeShortcut(testPage, "/gif-fallback");

    const link = field.locator('a[data-clipio-gif="abc123"]');
    // The host's CSP may block the remote image. The link is what keeps the
    // placeholder usable in that case, so it is the contract under test.
    await expect(link).toHaveCount(1, { timeout: 5_000 });
    await expect(link).toHaveAttribute(
      "href",
      "https://media.giphy.com/media/abc123/giphy.gif"
    );
    await expect(link.locator("img")).toHaveAttribute("alt", "GIF");
  });
});
