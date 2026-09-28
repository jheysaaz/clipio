/**
 * Shared content-script readiness helpers for e2e tests.
 *
 * The content script attaches its input/keydown listeners only AFTER its
 * async initialize() completes (storage reads, snippet index build, preview
 * init). Typing before that moment is silently dropped — no listeners are
 * bound, so no debounce timer is ever set. Tests must wait for the
 * `data-clipio-ready` attribute on <html> instead of using fixed sleeps,
 * which are flaky when init occasionally exceeds the sleep duration.
 */

import type { Page } from "@playwright/test";

export const CONTENT_SCRIPT_READY_SELECTOR = 'html[data-clipio-ready="true"]';

export async function waitForContentScriptReady(page: Page): Promise<void> {
  await page.waitForSelector(CONTENT_SCRIPT_READY_SELECTOR, {
    state: "attached",
    timeout: 10_000,
  });
}

/**
 * Wait until an extension page has the `chrome.storage` API available.
 *
 * Several messaging tests do `page.evaluate(() => chrome.storage.local.get(…))`
 * straight after navigating to popup.html or options.html. A `waitForTimeout`
 * in front of that is guessing how long the extension context takes to come up.
 *
 * This polls the actual precondition instead, so the wait ends as soon as the API
 * is there rather than always costing the full interval.
 */
export async function waitForExtensionStorageApi(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof chrome !== "undefined" &&
      chrome?.storage?.local !== undefined &&
      typeof chrome?.storage?.local?.get === "function",
    undefined,
    { timeout: 10_000 }
  );
}
