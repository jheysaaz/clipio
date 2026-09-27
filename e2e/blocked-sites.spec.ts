/**
 * spec: specs/blocked-sites.spec.md
 *
 * "Hide on this site" must suppress snippet expansion *and* preview rendering
 * on a blocked host. The unit suite in src/lib/blocked-sites.test.ts covers the
 * matching function; this spec proves the enforcement is actually wired into
 * the content script, because those three call sites previously had no
 * isBlocked check and the mismatch was invisible from unit tests alone.
 *
 * The test page is served from http://localhost:7777, so the hostname under
 * test is "localhost".
 */

import { test, expect } from "./fixtures.js";
import { helloSnippet } from "./helpers/snippets.js";
import { waitForContentScriptReady } from "./helpers/content-script.js";

const TYPING_TIMEOUT = 300; // Must match TIMING.TYPING_TIMEOUT in constants.ts
const BLOCKED_HOST = "localhost";

/** Seed snippets, optionally block the test host, then (re)load the page. */
async function setup(
  testPage: import("@playwright/test").Page,
  storageHelper: import("./fixtures.js").StorageHelper,
  options: { blocked: boolean }
) {
  await storageHelper.seedSnippets([helloSnippet()]);
  await storageHelper.setLocal(
    "blockedSites",
    options.blocked ? [BLOCKED_HOST] : []
  );
  await testPage.reload();
  await testPage.waitForLoadState("domcontentloaded");
  await waitForContentScriptReady(testPage);
}

test.describe("Blocked sites", () => {
  test.beforeEach(async ({ storageHelper }) => {
    // Start every test from a known blocklist so ordering cannot leak state.
    await storageHelper.setLocal("blockedSites", []);
  });

  // -------------------------------------------------------------------------
  // Expansion must be suppressed
  // -------------------------------------------------------------------------

  test("does not expand a shortcut on a blocked host", async ({
    testPage,
    storageHelper,
  }) => {
    await setup(testPage, storageHelper, { blocked: true });

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/hello");
    // Outlive the debounce, then assert nothing was replaced.
    await testPage.waitForTimeout(TYPING_TIMEOUT + 200);

    expect(await input.inputValue()).toBe("/hello");
    expect(await input.inputValue()).not.toContain("Hello, World!");
  });

  test("does not expand on Space in a blocked host", async ({
    testPage,
    storageHelper,
  }) => {
    // The Space/Tab immediate-expansion path is a separate handler from the
    // debounce path, so it needs its own case.
    await setup(testPage, storageHelper, { blocked: true });

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/hello");
    await testPage.keyboard.press("Space");
    await testPage.waitForTimeout(TYPING_TIMEOUT + 200);

    expect(await input.inputValue()).not.toContain("Hello, World!");
  });

  // -------------------------------------------------------------------------
  // Preview must not render — this is the gap that was actually exploitable
  // -------------------------------------------------------------------------

  test("does not inject the preview host element on a blocked host", async ({
    testPage,
    storageHelper,
  }) => {
    await setup(testPage, storageHelper, { blocked: true });

    // init() appends the host to the document unconditionally, so on a
    // blocked host nothing at all should have been injected.
    await expect(testPage.locator("#clipio-snippet-preview-host")).toHaveCount(
      0
    );
  });

  test("does not render snippet rows for the manual shortcut on a blocked host", async ({
    testPage,
    storageHelper,
  }) => {
    await setup(testPage, storageHelper, { blocked: true });

    // Ctrl+Shift+Space rendered the entire snippet list — labels, shortcuts
    // and previews — into the blocked page. That is the behaviour under test.
    await testPage.locator('[data-testid="text-input"]').click();
    await testPage.keyboard.press("Control+Shift+Space");
    await testPage.waitForTimeout(200);

    // On a blocked host previewUI.init() is never called, so the host element
    // does not exist at all. Asserting its absence is the stronger claim — and
    // unlike a ".clipio-preview-item" count it is not vacuous, because the
    // shadow root is closed and rows are never in the light DOM anywhere.
    await expect(testPage.locator("#clipio-snippet-preview-host")).toHaveCount(
      0,
      { timeout: 5_000 }
    );
  });

  test("does not render snippet rows for a slash trigger on a blocked host", async ({
    testPage,
    storageHelper,
  }) => {
    await setup(testPage, storageHelper, { blocked: true });

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/he");
    await testPage.waitForTimeout(200);

    // On a blocked host previewUI.init() is never called, so the host element
    // does not exist at all. Asserting its absence is the stronger claim — and
    // unlike a ".clipio-preview-item" count it is not vacuous, because the
    // shadow root is closed and rows are never in the light DOM anywhere.
    await expect(testPage.locator("#clipio-snippet-preview-host")).toHaveCount(
      0,
      { timeout: 5_000 }
    );
  });

  // -------------------------------------------------------------------------
  // Regression guards: the unblocked path must be untouched
  // -------------------------------------------------------------------------

  test("still expands a shortcut on an unblocked host", async ({
    testPage,
    storageHelper,
  }) => {
    await setup(testPage, storageHelper, { blocked: false });

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/hello");

    await expect(input).toHaveValue(/Hello, World!/, { timeout: 5_000 });
  });

  test("still renders the preview for the manual shortcut on an unblocked host", async ({
    testPage,
    storageHelper,
  }) => {
    await setup(testPage, storageHelper, { blocked: false });

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.press("Control+Shift+Space");

    // The manual shortcut lists every snippet, so at least one row must render.
    await expect(
      testPage.locator("#clipio-snippet-preview-host")
    ).toHaveAttribute("data-preview-count", "1", { timeout: 5_000 });
  });

  test("still renders the preview for a slash trigger on an unblocked host", async ({
    testPage,
    storageHelper,
  }) => {
    await setup(testPage, storageHelper, { blocked: false });

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/he");

    await expect(
      testPage.locator("#clipio-snippet-preview-host")
    ).toHaveAttribute("data-preview-count", "1", { timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // Wildcard matching reaches the content script, not just the pure function
  // -------------------------------------------------------------------------

  test("a wildcard blocklist entry blocks subdomains but not the apex", async ({
    testPage,
    storageHelper,
  }) => {
    // "*.localhost" must not match the bare "localhost" the test page uses.
    await storageHelper.seedSnippets([helloSnippet()]);
    await storageHelper.setLocal("blockedSites", ["*.localhost"]);
    await testPage.reload();
    await testPage.waitForLoadState("domcontentloaded");
    await waitForContentScriptReady(testPage);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/hello");

    await expect(input).toHaveValue(/Hello, World!/, { timeout: 5_000 });
  });
});
