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
  await page.evaluate(async (e) => {
    await new Promise<void>((resolve, reject) => {
      const openReq = indexedDB.open("clipio-backup", 2);
      openReq.onupgradeneeded = (ev) => {
        const db = (ev.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains("media")) {
          db.createObjectStore("media", { keyPath: "id" });
        }
      };
      openReq.onsuccess = () => {
        const db = openReq.result;
        const tx = db.transaction("media", "readwrite");
        const store = tx.objectStore("media");
        // Minimal 1×1 PNG blob
        const png = new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
          0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
          0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63,
          0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21,
          0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
          0x42, 0x60, 0x82,
        ]);
        const blob = new Blob([png], { type: "image/png" });
        const record = {
          id: e.id,
          blob,
          mimeType: "image/png",
          width: 1,
          height: 1,
          size: png.length,
          originalSize: png.length,
          createdAt: new Date().toISOString(),
          ...(e.alt !== undefined ? { alt: e.alt } : {}),
        };
        store.put(record);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
      openReq.onerror = () => reject(openReq.error);
    });
  }, entry);
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
  test("popup auto-selects the most-recently-updated snippet on open", async ({
    context,
    extensionId,
  }) => {
    const old = makeSnippet({
      id: "old-snippet",
      label: "Old Snippet",
      shortcut: "/old",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    const newest = makeSnippet({
      id: "newest-snippet",
      label: "Newest Snippet",
      shortcut: "/newest",
      updatedAt: "2025-12-31T00:00:00.000Z",
    });
    const mid = makeSnippet({
      id: "mid-snippet",
      label: "Mid Snippet",
      shortcut: "/mid",
      updatedAt: "2025-06-01T00:00:00.000Z",
    });

    // Seed in a non-sorted order so that storage order ≠ newest-first
    await seedSnippets(context, extensionId, [old, mid, newest]);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.waitForLoadState("domcontentloaded");
    await popupPage.waitForTimeout(600);

    // The detail panel on the right should display the *newest* snippet's label
    const bodyText = await popupPage.textContent("body");
    expect(bodyText).toContain("Newest Snippet");

    await popupPage.close();
  });

  // -------------------------------------------------------------------------
  // 2. Unsaved-changes guard
  // -------------------------------------------------------------------------
  test("unsaved-changes guard shows confirm dialog before switching snippets", async ({
    context,
    extensionId,
  }) => {
    const s1 = makeSnippet({
      id: "guard-s1",
      label: "Snippet One",
      shortcut: "/s1",
      content: "Original content",
    });
    const s2 = makeSnippet({
      id: "guard-s2",
      label: "Snippet Two",
      shortcut: "/s2",
      content: "Second snippet content",
    });

    await seedSnippets(context, extensionId, [s1, s2]);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.waitForLoadState("domcontentloaded");
    await popupPage.waitForTimeout(600);

    // Make an edit in the rich-text editor to dirty the form.
    // The PlateJS editor renders a contenteditable — it must be present
    // (hard precondition, not a conditional branch).
    const editor = popupPage.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 5_000 });
    await editor.click();
    // Select all and type to replace current content
    await popupPage.keyboard.press("Control+a");
    await popupPage.keyboard.type("UNSAVED EDIT");

    // Try to click the OTHER snippet in the list
    const listItems = popupPage.locator('[data-testid="snippet-list-item"]');
    await expect(listItems).toHaveCount(2, { timeout: 5_000 });

    // Click the item that is NOT currently selected — aria-selected sits on
    // the item element itself, so this must be one combined selector
    // (chained locators match descendants only, never the element itself).
    await popupPage
      .locator('[data-testid="snippet-list-item"][aria-selected="false"]')
      .first()
      .click();

    // The confirm dialog must appear with its discard action —
    // auto-retrying expect (spec: no textContent("body") copy scans).
    const dialog = popupPage.locator('[role="dialog"], [role="alertdialog"]');
    await expect(dialog).toBeVisible({ timeout: 3_000 });
    await expect(dialog).toContainText(/Unsaved changes/);
    await expect(
      dialog.getByRole("button", { name: /Discard changes/ })
    ).toBeVisible();

    await popupPage.close();
  });

  // -------------------------------------------------------------------------
  // 3. MEDIA_GET_DATA_URL sender validation — extension origin is accepted
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
    expect(response).not.toBeUndefined();
    expect(typeof response).toBe("object");
    expect((response as Record<string, unknown>)["dataUrl"]).toBeNull();

    await popupPage.close();
  });

  // -------------------------------------------------------------------------
  // 4. Alt text carried through background bridge
  // -------------------------------------------------------------------------
  test("MEDIA_GET_DATA_URL response includes alt text from IDB entry", async ({
    context,
    extensionId,
  }) => {
    const mediaId = "e2e-alt-test-" + Date.now();
    const altText = "A red circle on white background";

    // Write a media entry with alt text into IDB via an extension page
    await seedMediaEntry(context, extensionId, { id: mediaId, alt: altText });

    // Now request the media via the background bridge from an extension page
    const popupPage = await getExtPage(context, extensionId);
    const response = await popupPage.evaluate(async (id: string) => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      return new Promise<{ dataUrl: string | null; alt?: string | null }>(
        (resolve) => {
          ext.runtime.sendMessage(
            { type: "media-get-data-url", mediaId: id },
            (resp: { dataUrl: string | null; alt?: string | null }) => {
              resolve(resp);
            }
          );
        }
      );
    }, mediaId);

    expect(response.dataUrl).toBeTruthy(); // got a data URL back
    expect(response.alt).toBe(altText); // alt text was included in response

    await popupPage.close();
  });

  // -------------------------------------------------------------------------
  // 5. Alt text absent when not set
  // -------------------------------------------------------------------------
  test("MEDIA_GET_DATA_URL response has null alt when entry has no alt text", async ({
    context,
    extensionId,
  }) => {
    const mediaId = "e2e-no-alt-" + Date.now();

    // Write a media entry WITHOUT alt text
    await seedMediaEntry(context, extensionId, { id: mediaId });

    const popupPage = await getExtPage(context, extensionId);
    const response = await popupPage.evaluate(async (id: string) => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      return new Promise<{ dataUrl: string | null; alt?: string | null }>(
        (resolve) => {
          ext.runtime.sendMessage(
            { type: "media-get-data-url", mediaId: id },
            (resp: { dataUrl: string | null; alt?: string | null }) => {
              resolve(resp);
            }
          );
        }
      );
    }, mediaId);

    expect(response.dataUrl).toBeTruthy();
    expect(response.alt).toBeNull();

    await popupPage.close();
  });

  // -------------------------------------------------------------------------
  // 6. Width-suffixed image placeholder is recognised as "in use" in options
  // -------------------------------------------------------------------------
  test("width-suffixed {{image:uuid:200}} placeholder is counted as media usage", async ({
    context,
    extensionId,
  }) => {
    const mediaId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    // Write the media entry
    await seedMediaEntry(context, extensionId, { id: mediaId });

    // Seed a snippet that uses the WIDTH-SUFFIXED form of the placeholder
    const snippet = makeSnippet({
      id: "width-suffix-snippet",
      label: "Width Suffix Snippet",
      shortcut: "/ws",
      content: `Here is an image: {{image:${mediaId}:200}}`,
    });
    await seedSnippets(context, extensionId, [snippet]);

    // Open the options page and navigate to Images by clicking the nav item.
    //
    // This used to load `options.html#images` and assume the hash routed there.
    // It does not: the page came up on the Dashboard, so the only "image" on
    // screen was the sidebar's own "Images" link — which is exactly what the old
    // `bodyText.includes("image")` assertion matched. The test passed without
    // ever opening the section it claimed to test.
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.waitForLoadState("domcontentloaded");
    await optionsPage.getByTestId("options-nav-images").click();
    await expect(optionsPage.getByTestId("options-nav-images")).toHaveAttribute(
      "aria-current",
      "page"
    );

    // Assert on THIS image's row, by its stable testid.
    //
    // This test previously asserted that the page's text contained "image",
    // which is true whenever the Images section renders anything at all — it
    // could not fail, and the comment above it conceded as much. The real claim
    // is that an image referenced only through the width-suffixed form is still
    // recognised as referenced, which needs a per-image handle.
    const row = optionsPage.getByTestId(`image-row-${mediaId}`);

    await expect(row).toBeVisible();
    // Rendered as "Used in: <label>", so the width suffix was parsed and the
    // snippet was matched to this image.
    await expect(row).toContainText("Used in: Width Suffix Snippet");
    // And explicitly not the orphaned state.
    // The real orphaned-state string, from options.images.noReferences.
    await expect(row).not.toContainText("Not used in any snippets");

    await optionsPage.close();
  });

  // -------------------------------------------------------------------------
  // 7. Image snippet with width suffix expands in contenteditable
  //    (ensures "uuid:200" is not passed as the media ID to the bridge)
  // -------------------------------------------------------------------------
  test("image placeholder with width suffix resolves correct media ID in contenteditable", async ({
    context,
    extensionId,
    storageHelper,
    testPage,
  }) => {
    const mediaId = "cccccccc-dddd-eeee-ffff-111111111111";

    // Seed media entry
    await seedMediaEntry(context, extensionId, {
      id: mediaId,
      alt: "width suffix test image",
    });

    // Seed snippet with width-suffixed placeholder
    const snippet = makeSnippet({
      id: "img-width-snippet",
      label: "Image Width Snippet",
      shortcut: "/imgw",
      content: `{{image:${mediaId}:150}}`,
    });
    await storageHelper.seedSnippets([snippet]);

    // Reload test page so content script picks up new snippet cache
    await testPage.reload();
    await testPage.waitForLoadState("domcontentloaded");
    await waitForContentScriptReady(testPage);

    // Type the shortcut into the contenteditable field
    const ce = testPage.locator('[data-testid="contenteditable-field"]');
    await ce.click();
    await testPage.keyboard.type("/imgw", { delay: 30 });

    // Auto-retry until expansion replaces the shortcut (300ms input debounce
    // + async image resolution — never a fixed sleep, AGENTS.md Testing Standards §6)
    await expect(ce).not.toContainText("/imgw", { timeout: 5_000 });

    // The raw placeholder should be fully resolved — no leftover token
    await expect(ce).not.toContainText("{{image:", { timeout: 5_000 });

    // Expansion has completed — read the HTML once (deterministic post-state)
    const innerHTML = await ce.innerHTML();
    // Either an img tag (successful resolution) or empty/blank (media resolved to blob)
    // We verify no "uuid:150" leak as the src attribute
    expect(innerHTML).not.toContain(`${mediaId}:150`);
  });

  // -------------------------------------------------------------------------
  // 8. Alt text injection — angle brackets and single quotes are escaped
  // -------------------------------------------------------------------------
  test("alt text with special characters is safely escaped in contenteditable", async ({
    context,
    extensionId,
    storageHelper,
    testPage,
  }) => {
    const mediaId = "dddddddd-eeee-ffff-0000-222222222222";
    const dangerousAlt = "<script>alert('xss')</script>";

    // Seed media with dangerous alt text
    await seedMediaEntry(context, extensionId, {
      id: mediaId,
      alt: dangerousAlt,
    });

    const snippet = makeSnippet({
      id: "alt-escape-snippet",
      label: "Alt Escape Snippet",
      shortcut: "/altesc",
      content: `{{image:${mediaId}}}`,
    });
    await storageHelper.seedSnippets([snippet]);

    await testPage.reload();
    await testPage.waitForLoadState("domcontentloaded");
    await waitForContentScriptReady(testPage);

    const ce = testPage.locator('[data-testid="contenteditable-field"]');
    await ce.click();
    await testPage.keyboard.type("/altesc", { delay: 30 });

    // Auto-retry until expansion replaces the shortcut — no fixed sleep
    // (reading innerHTML before expansion would be a vacuous pass)
    await expect(ce).not.toContainText("/altesc", { timeout: 5_000 });

    // Expansion completed — read the HTML once (deterministic post-state)
    const innerHTML = await ce.innerHTML();

    // The raw <script> tag must NOT appear literally in the DOM
    // (it should be escaped or the alt attribute should contain &lt;script&gt;)
    expect(innerHTML).not.toContain("<script>");
  });

  // -------------------------------------------------------------------------
  // 9. Popup selectNewest after cancel-create returns to newest snippet
  // -------------------------------------------------------------------------
  test("cancelling new-snippet creation reselects the newest snippet", async ({
    context,
    extensionId,
  }) => {
    const older = makeSnippet({
      id: "cancel-older",
      label: "Older Snippet",
      shortcut: "/older",
      updatedAt: "2024-03-01T00:00:00.000Z",
    });
    const newer = makeSnippet({
      id: "cancel-newer",
      label: "Newer Snippet",
      shortcut: "/newer",
      updatedAt: "2025-09-01T00:00:00.000Z",
    });

    // Seed with older first so it's at index 0 in raw storage order
    await seedSnippets(context, extensionId, [older, newer]);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.waitForLoadState("domcontentloaded");
    await popupPage.waitForTimeout(600);

    // Click the "Add Snippet" button (stable testid)
    const newButton = popupPage.getByTestId("add-snippet");
    await expect(newButton).toBeVisible({ timeout: 5_000 });
    await newButton.click();

    // Cancel the creation — NewSnippetView's X has aria-label from i18n
    // newSnippet.cancel (English default: "Cancel")
    const cancelButton = popupPage
      .locator('button[aria-label*="cancel" i]')
      .first();
    await expect(cancelButton).toBeVisible({ timeout: 5_000 });
    await cancelButton.click();
    await popupPage.waitForTimeout(300);

    // After cancel, the detail/list returns to the NEWER snippet
    await expect(
      popupPage
        .getByTestId("snippet-list-item")
        .filter({ hasText: "Newer Snippet" })
    ).toBeVisible();

    await popupPage.close();
  });
});
