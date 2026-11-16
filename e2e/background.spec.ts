/**
 * Background script tests — the thin slice that is observable from a browser.
 *
 * ── What used to be here, and why it is not ─────────────────────────────────
 *
 * The header claimed "8 tests", including "Sync-wipe detection" and "Uninstall URL
 * registration". There were two, and neither tested the background script.
 *
 * `creates context menu items on install` evaluated a hardcoded array of five menu
 * ids and then asserted that array contained those five ids. It imported nothing
 * from `background.ts` and would have passed with `registerContextMenus` deleted
 * outright. AGENTS.md rule 1: "A test must import the code it claims to test.
 * Asserting on a value the test built itself proves nothing." It was deleted
 * rather than repaired because it cannot be repaired — `chrome.contextMenus` has
 * no `getAll()`, so there is nothing in the page to assert against.
 *
 * What replaced it is `src/lib/context-menu.test.ts`, which asserts something
 * stronger and actually reachable: that every id the router handles is distinct,
 * that every clickable id in `CONTEXT_MENU` has a handler, and that "Give
 * feedback" opens a real route. That last one was a shipped bug — it pointed at
 * `options.html#feedback`, which was never a section id, so the user landed on
 * Library while every layer reported success.
 *
 * Sync-wipe detection was likewise untested anywhere. It is now
 * `src/lib/sync-change.ts`, which is unit-tested — and which is how a defect in
 * `tests/mocks/browser.ts` was found: the mock reported a removal as having a
 * `newValue` taken from the other storage area, and this logic branches on exactly
 * that field.
 *
 * ── What remains untested, deliberately ─────────────────────────────────────
 *
 * `src/entrypoints/**` stays on the coverage exclusion list. `background.ts` is
 * 564 lines of listener registration whose logic now lives in `src/lib/`, and
 * `content.ts` is 1479 lines of timers and DOM insertion. Un-excluding the
 * directory would put the flat-80 `perFile` ratchet behind code that is awkward to
 * reach, and the pressure at the end of that is the pressure AGENTS.md forbids
 * answering with a lower number. The exclusion comment says so rather than
 * claiming e2e coverage it does not have.
 *
 * ── What is genuinely worth a browser ───────────────────────────────────────
 *
 * The service worker lifecycle, and the popup's consumption of a context-menu
 * draft — a real cross-context round trip through storage, which the unit layer
 * cannot reach.
 */

import { test, expect } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the first available service worker, waiting if necessary.
 */
async function getServiceWorker(
  context: import("@playwright/test").BrowserContext
) {
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    sw = await context.waitForEvent("serviceworker", { timeout: 10_000 });
  }
  return sw;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Background Script", () => {
  test("the popup consumes a saved-selection draft from storage", async ({
    context,
    extensionId,
  }) => {
    const sw = await getServiceWorker(context);

    // The draft is seeded straight into storage rather than by invoking the
    // context-menu handler, and the handler's own decision — trim, reject an
    // empty selection — is unit-tested in `src/lib/context-menu.test.ts`.
    //
    // What is genuinely worth a browser is the half that crosses contexts: the
    // background writes to storage, the popup reads it, and the popup consumes
    // it. The previous version of this test reimplemented the handler's write
    // inside `sw.evaluate` and then asserted on it, so the write path it named
    // was never executed by the code under test.
    await sw.evaluate(async (selectedText: string) => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({ contextMenuDraft: selectedText });
    }, "selected test text");

    const extPage = await context.newPage();
    await extPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await extPage.waitForLoadState("domcontentloaded");
    // The popup pre-fills from the draft in a useEffect, so poll for the value
    // rather than sleeping past it.
    //
    // The draft lands in a Plate.js rich-text editor, which renders into a
    // `contenteditable` element — not a textarea or an input. The previous
    // version queried `textarea, input[type="text"]`, which therefore never
    // matched anything, and the assertion it fed into could not fail either.
    await expect
      .poll(
        () =>
          extPage
            .locator('[contenteditable="true"]')
            .first()
            .textContent()
            .catch(() => null),
        { timeout: 5_000, message: "draft was never pre-filled into the popup" }
      )
      .toContain("selected test text");

    // The draft is also consumed from storage, so it does not reappear on reopen.
    await expect
      .poll(
        () =>
          sw.evaluate(async () => {
            const ext =
              (globalThis as any).chrome ?? (globalThis as any).browser;
            const result = await ext.storage.local.get("contextMenuDraft");
            return result.contextMenuDraft ?? null;
          }),
        { timeout: 5_000, message: "draft was never consumed" }
      )
      .toBeNull();

    await extPage.close();
  });
});
