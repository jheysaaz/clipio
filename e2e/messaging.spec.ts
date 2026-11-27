/**
 * Cross-context messaging that only a real extension can prove: a content
 * script reaching the background, and an extension page reaching a content
 * script in a tab. Tests that only wrote and then read their own storage values
 * were deleted — they proved `chrome.storage`, not Clipio.
 */

import { test, expect } from "./fixtures.js";
import {
  waitForContentScriptReady,
  waitForExtensionStorageApi,
} from "./helpers/content-script.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getServiceWorker(
  context: import("@playwright/test").BrowserContext
) {
  let sw = context.serviceWorkers()[0];
  if (!sw) {
    sw = await context.waitForEvent("serviceworker", { timeout: 10_000 });
  }
  return sw;
}

const TEST_PAGE_URL = `http://localhost:${process.env.E2E_SERVER_PORT ?? "7777"}/test-page.html`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Cross-Context Communication", () => {
  test("relays runtime message from content script to background", async ({
    context,
    extensionId,
  }) => {
    const sw = await getServiceWorker(context);

    // Set up a message listener on the service worker side
    const messageReceivedPromise = sw.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
        const timeout = setTimeout(() => resolve(false), 3_000);
        ext.runtime.onMessage.addListener((msg: unknown) => {
          if (
            typeof msg === "object" &&
            msg !== null &&
            (msg as Record<string, unknown>)["__e2eTest"] === true
          ) {
            clearTimeout(timeout);
            resolve(true);
          }
          return false;
        });
      });
    });

    // Open a page and send a message from the content script context
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.waitForLoadState("domcontentloaded");
    await waitForExtensionStorageApi(page);

    await page.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      ext.runtime.sendMessage({ __e2eTest: true });
    });

    // The listener must actually see the message. The previous assertion was
    // `expect(typeof received).toBe("boolean")`, which is unfailable — `received`
    // is typed `Promise<boolean>`, so it is always a boolean, including when the
    // listener never matched and the promise resolved to `false` on timeout.
    const received = await messageReceivedPromise;
    expect(received).toBe(true);

    await page.close();
  });

  test("options page reaches the content script in a tab", async ({
    context,
    extensionId,
  }) => {
    // An extension page talking to a content script, across contexts, with a
    // real answer — the direction the options page's content-script health check
    // depends on.
    //
    // This was previously a test of the dev-only `dev:sentry-test` message, and
    // it asserted only that `tabs.sendMessage` did not throw. That handler is
    // compiled out of a production build, so *nothing* listens for it in CI and
    // the assertion could not distinguish "delivered" from "posted into the
    // void". `content:ping` is registered in every build and answers, so the
    // round trip is now actually observed.
    const contentPage = await context.newPage();
    await contentPage.goto(TEST_PAGE_URL);
    await contentPage.waitForLoadState("domcontentloaded");
    await waitForContentScriptReady(contentPage);

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.waitForLoadState("domcontentloaded");
    await waitForExtensionStorageApi(optionsPage);

    const result = await optionsPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const tabWithScript = (await ext.tabs.query({})).find(
        (tab: { url?: string }) =>
          tab.url?.startsWith("http://localhost:7777/") === true
      );
      if (!tabWithScript?.id) return { pong: false, reason: "no test tab" };

      return new Promise<{ pong: boolean; reason?: string }>((resolve) => {
        ext.tabs.sendMessage(
          tabWithScript.id,
          { id: 1, type: "content:ping", timestamp: Date.now() },
          (resp: unknown) => {
            const envelope = resp as
              { res?: { pong?: boolean }; err?: unknown } | undefined;
            resolve({ pong: envelope?.res?.pong === true });
          }
        );
      });
    });

    expect(result.pong).toBe(true);

    await contentPage.close();
    await optionsPage.close();
  });
});
