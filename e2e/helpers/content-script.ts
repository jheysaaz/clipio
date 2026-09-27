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
