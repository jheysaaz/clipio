/**
 * Content-script cache coherence.
 *
 * The popup reads browser.storage.sync directly, but the content script reads
 * only `local:cachedSnippets`. Nothing in the extension refreshes that cache
 * when the browser populates storage.sync on its own — which is exactly what
 * happens when the user signs into a Google account, or when another device
 * syncs. The result is a snippet that is listed in the popup and refuses to
 * insert on any page.
 *
 * spec: specs/cache-coherence.spec.md
 */

import { test, expect } from "./fixtures.js";
import type { StorageHelper } from "./fixtures.js";
import { helloSnippet } from "./helpers/snippets.js";
import { waitForContentScriptReady } from "./helpers/content-script.js";

test.describe("Content-script cache coherence", () => {
  // Reproduces the reported bug: sign in / another device syncs snippets into
  // storage.sync without any extension code running.
  test("inserts a snippet that arrived via storage.sync alone", async ({
    testPage,
    storageHelper,
  }) => {
    await storageHelper.setLocal("cachedSnippets", []);
    await storageHelper.seedSyncOnly([helloSnippet()]);

    // The popup would show it: sync is authoritative for the UI.
    const syncSnippets = await storageHelper.readSyncSnippets();
    expect(syncSnippets.map((s) => s.id)).toContain("hello-snippet");

    await testPage.reload();
    await testPage.waitForLoadState("domcontentloaded");
    await waitForContentScriptReady(testPage);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/hello");

    // This is the failure the user reported.
    await expect(input).toHaveValue(/Hello, World!/, { timeout: 5_000 });
  });

  test("propagates a snippet added to sync after the page loaded", async ({
    testPage,
    storageHelper,
  }) => {
    await storageHelper.setLocal("cachedSnippets", []);
    await storageHelper.seedSyncOnly([]);
    await testPage.reload();
    await testPage.waitForLoadState("domcontentloaded");
    await waitForContentScriptReady(testPage);

    // Sync arrives while the tab is open.
    await storageHelper.seedSyncOnly([helloSnippet()]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/hello");

    await expect(input).toHaveValue(/Hello, World!/, { timeout: 8_000 });
  });

  test("the cache is refreshed rather than left divergent", async ({
    testPage,
    storageHelper,
  }) => {
    // Direct observation of the projection, independent of insertion.
    await storageHelper.setLocal("cachedSnippets", []);
    await storageHelper.seedSyncOnly([helloSnippet()]);

    await testPage.reload();
    await testPage.waitForLoadState("domcontentloaded");
    await waitForContentScriptReady(testPage);

    await expect
      .poll(async () => (await readCache(storageHelper)).length, {
        timeout: 8_000,
      })
      .toBeGreaterThan(0);
  });
});

async function readCache(storageHelper: StorageHelper): Promise<unknown[]> {
  const value = await storageHelper.getLocal("cachedSnippets");
  return Array.isArray(value) ? value : [];
}
