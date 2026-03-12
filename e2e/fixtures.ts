/**
 * Custom Playwright fixtures for Clipio browser extension testing.
 *
 * Provides:
 *   - `context`       — persistent Chromium context with the extension loaded
 *   - `extensionId`   — extracted from the service worker URL
 *   - `popupPage`     — navigates to chrome-extension://{id}/popup.html
 *   - `optionsPage`   — navigates to chrome-extension://{id}/options.html
 *   - `testPage`      — a controlled page with <input>, <textarea>, contenteditable
 *   - `storageHelper` — utilities to seed/read extension storage
 */

import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import path from "path";
import type { Snippet } from "../src/types/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StorageHelper = {
  /** Seed a list of snippets into both sync (per-key) and local cache. */
  seedSnippets: (snippets: Snippet[]) => Promise<void>;
  /** Read all snip:* keys from sync storage. */
  readSyncSnippets: () => Promise<Snippet[]>;
  /** Read cachedSnippets from local storage. */
  readCachedSnippets: () => Promise<Snippet[]>;
  /** Clear all extension storage. */
  clearAll: () => Promise<void>;
  /** Set a specific local storage item by key. */
  setLocal: (key: string, value: unknown) => Promise<void>;
  /** Get a specific local storage item by key. */
  getLocal: (key: string) => Promise<unknown>;
};

export type ClipioFixtures = {
  context: BrowserContext;
  extensionId: string;
  popupPage: Page;
  optionsPage: Page;
  testPage: Page;
  storageHelper: StorageHelper;
};

// ---------------------------------------------------------------------------
// Extension path
// ---------------------------------------------------------------------------

const EXTENSION_PATH = path.resolve(".output/chrome-mv3");

// ---------------------------------------------------------------------------
// Helper: extract extension ID from service worker
// ---------------------------------------------------------------------------

async function getExtensionId(context: BrowserContext): Promise<string> {
  // Service workers for the extension appear in the context's service workers list.
  // We wait for one to register, then extract the extension ID from its URL.
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker", {
      timeout: 10_000,
    });
  }
  const url = serviceWorker.url();
  // URL format: chrome-extension://<id>/...
  const match = url.match(/chrome-extension:\/\/([^/]+)/);
  if (!match) {
    throw new Error(`Could not extract extension ID from URL: ${url}`);
  }
  return match[1];
}

// ---------------------------------------------------------------------------
// Test fixture definition
// ---------------------------------------------------------------------------

export const test = base.extend<ClipioFixtures>({
  // Persistent Chromium context with the extension loaded.
  // We create a fresh context per test to guarantee isolation.
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userDataDir = path.resolve(
      `test-results/.playwright-user-data/${Date.now()}`
    );
    const ctx = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--use-fake-ui-for-media-stream",
        "--disable-features=VizDisplayCompositor",
        // Required for clipboard tests
        "--allow-file-access-from-files",
      ],
    });

    // Grant clipboard permissions for the extension origin
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);

    await use(ctx);
    await ctx.close();
  },

  // Extension ID extracted from the service worker URL.
  extensionId: async ({ context }, use) => {
    const id = await getExtensionId(context);
    await use(id);
  },

  // Popup page: chrome-extension://{id}/popup.html
  popupPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    // Wait for React to hydrate
    await page.waitForLoadState("domcontentloaded");
    await use(page);
    await page.close();
  },

  // Options page: chrome-extension://{id}/options.html
  optionsPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState("domcontentloaded");
    await use(page);
    await page.close();
  },

  // Controlled test page: serves test-page.html with form fields.
  // We navigate to the HTTP server (started via playwright.config.ts webServer)
  // so the content script injects correctly — Chrome does not inject content
  // scripts into file:// URLs without explicit user permission.
  testPage: async ({ context }, use) => {
    const port = process.env.E2E_SERVER_PORT ?? "7777";
    const page = await context.newPage();
    await page.goto(`http://localhost:${port}/test-page.html`);
    await page.waitForLoadState("domcontentloaded");
    // Give the content script time to initialize
    await page.waitForTimeout(500);
    await use(page);
    await page.close();
  },

  // Storage helper utilities
  storageHelper: async ({ context, extensionId }, use) => {
    // Get a background page or open the popup temporarily to access storage
    // We execute storage operations via an extension page which has full access
    const getExtPage = async (): Promise<Page> => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/popup.html`);
      await page.waitForLoadState("domcontentloaded");
      return page;
    };

    const helper: StorageHelper = {
      seedSnippets: async (snippets: Snippet[]) => {
        const page = await getExtPage();
        try {
          await page.evaluate(async (snips: Snippet[]) => {
            // Write each snippet as snip:{id} in sync storage
            const syncEntries: Record<string, Snippet> = {};
            for (const s of snips) {
              syncEntries[`snip:${s.id}`] = s;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ext =
              (globalThis as any).chrome ?? (globalThis as any).browser;
            await ext.storage.sync.set(syncEntries);
            // Also update the local cache used by the content script
            await ext.storage.local.set({ cachedSnippets: snips });
          }, snippets);
        } finally {
          await page.close();
        }
      },

      readSyncSnippets: async (): Promise<Snippet[]> => {
        const page = await getExtPage();
        try {
          return await page.evaluate(async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ext =
              (globalThis as any).chrome ?? (globalThis as any).browser;
            const all = await ext.storage.sync.get(null);
            return Object.entries(all as Record<string, unknown>)
              .filter(([key]) => key.startsWith("snip:"))
              .map(([, value]) => value as Snippet);
          });
        } finally {
          await page.close();
        }
      },

      readCachedSnippets: async (): Promise<Snippet[]> => {
        const page = await getExtPage();
        try {
          return await page.evaluate(async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ext =
              (globalThis as any).chrome ?? (globalThis as any).browser;
            const result = await ext.storage.local.get("cachedSnippets");
            return (result.cachedSnippets as Snippet[]) ?? [];
          });
        } finally {
          await page.close();
        }
      },

      clearAll: async () => {
        const page = await getExtPage();
        try {
          await page.evaluate(async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ext =
              (globalThis as any).chrome ?? (globalThis as any).browser;
            await ext.storage.sync.clear();
            await ext.storage.local.clear();
          });
        } finally {
          await page.close();
        }
      },

      setLocal: async (key: string, value: unknown) => {
        const page = await getExtPage();
        try {
          await page.evaluate(
            async ([k, v]: [string, unknown]) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const ext =
                (globalThis as any).chrome ?? (globalThis as any).browser;
              await ext.storage.local.set({ [k]: v });
            },
            [key, value] as [string, unknown]
          );
        } finally {
          await page.close();
        }
      },

      getLocal: async (key: string): Promise<unknown> => {
        const page = await getExtPage();
        try {
          return await page.evaluate(async (k: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ext =
              (globalThis as any).chrome ?? (globalThis as any).browser;
            const result = await ext.storage.local.get(k);
            return result[k];
          }, key);
        } finally {
          await page.close();
        }
      },
    };

    await use(helper);
  },
});

export { expect } from "@playwright/test";
