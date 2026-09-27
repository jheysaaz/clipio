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
 * Read a locator's text, retrying until it is non-empty.
 *
 * `locator.inputValue()`, `innerText()` and `textContent()` are **one-shot**:
 * they read whatever is there at that instant and never retry. So a test that
 * reads one right after an action is asserting against a race, and the usual
 * "fix" is a sleep in front of it — which passes when the machine is fast and
 * fails when it is not.
 *
 * This polls instead. Combined with a following assertion, the wait is on the
 * value rather than on the clock, so it is both faster and stable.
 *
 * Only appropriate before a *positive* assertion. To prove a negative ("nothing
 * must ever appear"), you still have to wait out the debounce and then read
 * once — a retrying read can never prove that something never happened.
 */
