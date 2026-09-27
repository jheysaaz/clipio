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
 *
 * Two things about running these reliably, both learned the hard way:
 *
 * - All spec files share ONE browser context (playwright.config.ts pins
 *   workers: 1 because extensions share a context), so snippets seeded by other
 *   files are still in storage.sync and get projected into the cache too. The
 *   tests use shortcuts under `/zzq-`, which no other spec uses, because the
 *   content script prefix-matches and a leftover shorter shortcut would win.
 *   An earlier version of this file cleared storage to get a clean slate; that
 *   was hermetic but it tripped the background's sign-out detector, and the leak
 *   broke unrelated specs.
 * - Each test waits for the cache to be projected BEFORE typing. The refresh is
 *   debounced and asynchronous, and the content script evaluates a shortcut as
 *   its characters arrive: if its index is still empty when the last character
 *   lands, it decides there is no match and never looks again, leaving the raw
 *   text in the field. Retrying the value assertion cannot recover from that.
 */

import { test, expect } from "./fixtures.js";
import type { StorageHelper } from "./fixtures.js";
import type { Page } from "@playwright/test";
import { makeSnippet } from "./helpers/snippets.js";
import { waitForContentScriptReady } from "./helpers/content-script.js";

const SHORTCUT = "/zzq-coherence-hello";
const LATE_SHORTCUT = "/zzq-coherence-late";

const helloSnippet = () =>
  makeSnippet({
    id: "coherence-hello",
    label: "Hello",
    shortcut: SHORTCUT,
    content: "Hello, World!",
  });

/**
 * A second, distinct snippet.
 *
 * The "arrives while the tab is open" test must seed something storage has not
 * seen before. Re-seeding the same id with the same body is a no-op — the
 * browser does not fire `storage.onChanged` for a byte-identical value — so the
 * background has no change to observe, never refreshes, and the test fails.
 * That only surfaced when another test in the shared context had already
 * written the snippet.
 */
const lateSnippet = () =>
  makeSnippet({
    id: "coherence-late",
    label: "Late",
    shortcut: LATE_SHORTCUT,
    content: "Arrived Late!",
  });

/**
 * Wait until the background has projected a snippet into the content cache.
 * Scoped to one id, since the cache legitimately holds other specs' snippets.
 */
async function waitForCacheToContain(
  storageHelper: StorageHelper,
  id: string
): Promise<void> {
  await expect
    .poll(
      async () => {
        const cached = (await storageHelper.getLocal("cachedSnippets")) as
          Record<string, unknown>[] | undefined;
        return (cached ?? []).some((s) => s.id === id);
      },
      { timeout: 8_000, message: `cache never picked up ${id}` }
    )
    .toBe(true);
}

/** Reload the page and wait for the content script to index the cache. */
async function reloadAndWait(testPage: Page): Promise<void> {
  await testPage.reload();
  await testPage.waitForLoadState("domcontentloaded");
  await waitForContentScriptReady(testPage);
}

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
    expect(syncSnippets.map((s) => s.id)).toContain("coherence-hello");

    await waitForCacheToContain(storageHelper, "coherence-hello");
    await reloadAndWait(testPage);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type(SHORTCUT);

    // This is the failure the user reported.
    await expect(input).toHaveValue(/Hello, World!/, { timeout: 8_000 });
  });

  test("propagates a snippet added to sync after the page loaded", async ({
    testPage,
    storageHelper,
  }) => {
    await storageHelper.setLocal("cachedSnippets", []);
    await reloadAndWait(testPage);

    // Sync arrives while the tab is open, with no reload and no user action.
    await storageHelper.seedSyncOnly([lateSnippet()]);
    await waitForCacheToContain(storageHelper, "coherence-late");

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type(LATE_SHORTCUT);

    await expect(input).toHaveValue(/Arrived Late!/, { timeout: 8_000 });
  });

  test("the cache is refreshed rather than left divergent", async ({
    testPage,
    storageHelper,
  }) => {
    // Direct observation of the projection, independent of insertion.
    await storageHelper.setLocal("cachedSnippets", []);
    await storageHelper.seedSyncOnly([helloSnippet()]);

    await waitForCacheToContain(storageHelper, "coherence-hello");
    await reloadAndWait(testPage);

    // Nothing was typed: the assertion is purely that the cache is coherent.
    await expect
      .poll(async () => {
        const cached = (await storageHelper.getLocal("cachedSnippets")) as
          Record<string, unknown>[] | undefined;
        return (cached ?? []).some((s) => s.id === "coherence-hello");
      })
      .toBe(true);
  });
});
