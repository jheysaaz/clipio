/**
 * Phase 6: Cross-Context Communication Tests (5 tests)
 *
 * Tests message passing and state propagation between extension contexts:
 * background ↔ content script ↔ popup ↔ options page.
 *
 * Test strategy:
 * - Intercept Sentry network requests with page.route()
 * - Open multiple pages in the same context for multi-tab behavior
 * - Use page.waitForEvent() to listen for storage changes
 * - Verify message passing via service worker evaluation
 */

import { test, expect } from "./fixtures.js";
import { makeSnippet } from "./helpers/snippets.js";
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

  test("propagates storage changes to content script cache", async ({
    context,
    extensionId,
  }) => {
    // Open a page with content script
    const contentPage = await context.newPage();
    await contentPage.goto(TEST_PAGE_URL);
    await contentPage.waitForLoadState("domcontentloaded");
    await waitForContentScriptReady(contentPage);

    // Create a snippet via the popup (simulating real usage)
    const extPage = await context.newPage();
    await extPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await extPage.waitForLoadState("domcontentloaded");
    await waitForExtensionStorageApi(extPage);

    const newSnippet = makeSnippet({
      id: "propagate-test",
      label: "Propagation Test",
      shortcut: "/propagate",
      content: "Propagated content",
    });

    await extPage.evaluate(async (snip) => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      // Write to sync and update the cache (mimics StorageManager behavior)
      await ext.storage.sync.set({ [`snip:${snip.id}`]: snip });
      const cached =
        (await ext.storage.local.get("cachedSnippets")).cachedSnippets ?? [];
      await ext.storage.local.set({
        cachedSnippets: [...cached, snip],
      });
    }, newSnippet);

    await extPage.close();

    // Verify the cache was updated by reading from an extension page
    // (contentPage is an HTTP page and cannot access chrome.storage directly).
    // Retried, rather than preceded by a sleep: the write above is async and the
    // only thing that matters is when it lands.
    await expect
      .poll(
        async () => {
          const page = await context.newPage();
          try {
            await page.goto(`chrome-extension://${extensionId}/popup.html`);
            const ids = await page.evaluate(async () => {
              const ext =
                (globalThis as any).chrome ?? (globalThis as any).browser;
              const all = await ext.storage.local.get("cachedSnippets");
              return ((all.cachedSnippets ?? []) as { id: string }[]).map(
                (s) => s.id
              );
            });
            return ids.includes("propagate-test");
          } finally {
            await page.close();
          }
        },
        {
          timeout: 5_000,
          message: "cache never received the propagated snippet",
        }
      )
      .toBe(true);

    const verifyPage = await context.newPage();
    await verifyPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await verifyPage.waitForLoadState("domcontentloaded");

    const cacheAfter = await verifyPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const result = await ext.storage.local.get("cachedSnippets");
      return (result.cachedSnippets ?? []) as Array<{ id: string }>;
    });

    const found = cacheAfter.find((s) => s.id === "propagate-test");
    expect(found).toBeTruthy();

    await verifyPage.close();
    await contentPage.close();
  });

  test("shares snippet state across multiple tabs", async ({
    context,
    extensionId,
  }) => {
    // Open two content script pages
    const page1 = await context.newPage();
    await page1.goto(TEST_PAGE_URL);
    await page1.waitForLoadState("domcontentloaded");
    await waitForContentScriptReady(page1);

    const page2 = await context.newPage();
    await page2.goto(TEST_PAGE_URL);
    await page2.waitForLoadState("domcontentloaded");
    await waitForContentScriptReady(page2);

    const multiTabSnippet = makeSnippet({
      id: "multitab-test",
      label: "Multi-Tab Test",
      shortcut: "/multitab",
      content: "Multi-tab content",
    });

    // Seed via popup (single source of truth)
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.waitForLoadState("domcontentloaded");
    await waitForExtensionStorageApi(popupPage);

    await popupPage.evaluate(async (snip) => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.sync.set({ [`snip:${snip.id}`]: snip });
      await ext.storage.local.set({ cachedSnippets: [snip] });
    }, multiTabSnippet);
    await popupPage.close();

    // Both tabs should have the snippet accessible in the shared storage.
    // Read from an extension page (chrome.storage is not available in HTTP pages)
    const verifyPage = await context.newPage();
    await verifyPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await verifyPage.waitForLoadState("domcontentloaded");

    const cache1 = await verifyPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const r = await ext.storage.local.get("cachedSnippets");
      return (r.cachedSnippets ?? []) as Array<{ id: string }>;
    });

    // Both tabs share the same storage — verify the snippet is there
    expect(cache1.some((s: { id: string }) => s.id === "multitab-test")).toBe(
      true
    );

    await verifyPage.close();
    await page1.close();
    await page2.close();
  });

  test("background sets flag that popup reads on next open", async ({
    context,
    extensionId,
  }) => {
    // Simulate background setting a flag (e.g., sync wipe detection)
    const sw = await getServiceWorker(context);
    await sw.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({ __e2eBackgroundFlag: "set-by-background" });
    });

    // Open popup and verify it can read the flag
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.waitForLoadState("domcontentloaded");
    await waitForExtensionStorageApi(popupPage);

    const flagValue = await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const result = await ext.storage.local.get("__e2eBackgroundFlag");
      return result.__e2eBackgroundFlag;
    });

    expect(flagValue).toBe("set-by-background");

    // Clean up
    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.remove("__e2eBackgroundFlag");
    });

    await popupPage.close();
  });
});
