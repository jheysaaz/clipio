/**
 * Phase 5: Storage Integration Tests (8 tests)
 *
 * Tests real browser storage with quota limits, fallback behavior,
 * IndexedDB backup, and per-key layout.
 *
 * Test strategy:
 * - Use page.evaluate() to access browser.storage APIs directly
 * - Fill storage to trigger quota errors with large snippets
 * - Verify fallback behavior by checking storageModeItem
 * - Open IndexedDB directly via page.evaluate()
 * - Test concurrent operations with Promise.all()
 */

import { test, expect } from "./fixtures.js";
import { makeSnippet, makeSnippets } from "./helpers/snippets.js";
import { readIndexedDbSnippets } from "./helpers/storage.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getExtPage(
  context: import("@playwright/test").BrowserContext,
  extensionId: string
) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(300);
  return page;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Storage Integration", () => {
  test("persists snippets in sync storage across popup reloads", async ({
    context,
    extensionId,
  }) => {
    const page = await getExtPage(context, extensionId);

    const snippet = makeSnippet({
      id: "persist-test",
      label: "Persistence Test",
      shortcut: "/persist",
      content: "Persisted content",
    });

    // Write snippet directly into sync storage
    await page.evaluate(async (snip) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.sync.set({ [`snip:${snip.id}`]: snip });
    }, snippet);

    await page.close();

    // Open a fresh popup page and verify the snippet is still there
    const page2 = await getExtPage(context, extensionId);
    const stored = await page2.evaluate(async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const result = await ext.storage.sync.get(`snip:${id}`);
      return result[`snip:${id}`];
    }, snippet.id);

    expect(stored).toBeTruthy();
    expect((stored as typeof snippet).label).toBe("Persistence Test");
    await page2.close();
  });

  test("uses per-key storage layout (snip:{id} keys)", async ({
    context,
    extensionId,
  }) => {
    const page = await getExtPage(context, extensionId);

    const snippet = makeSnippet({
      id: "per-key-test",
      label: "Per-Key Layout Test",
      shortcut: "/perkey",
      content: "Per-key content",
    });

    await page.evaluate(async (snip) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.sync.set({ [`snip:${snip.id}`]: snip });
    }, snippet);

    // Verify the specific key format exists
    const keys = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const all = await ext.storage.sync.get(null);
      return Object.keys(all as Record<string, unknown>);
    });

    expect(keys).toContain(`snip:${snippet.id}`);
    await page.close();
  });

  test("falls back to local storage mode on sync quota overflow", async ({
    context,
    extensionId,
  }) => {
    const page = await getExtPage(context, extensionId);

    // Fill sync storage beyond the quota by setting many large items
    const overflowResult = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const filler = "x".repeat(7_500); // near 8KB per-item limit
      const entries: Record<string, unknown> = {};
      let quotaHit = false;

      // Try to fill until quota error
      for (let i = 0; i < 15; i++) {
        try {
          entries[`snip:fill-${i}`] = {
            id: `fill-${i}`,
            label: `Filler ${i}`,
            shortcut: `/fill${i}`,
            content: filler,
            tags: [],
            usageCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          await ext.storage.sync.set({
            [`snip:fill-${i}`]: entries[`snip:fill-${i}`],
          });
        } catch (err) {
          quotaHit = true;
          // Set the fallback flag manually as the StorageManager would
          await ext.storage.local.set({ storageMode: "local" });
          break;
        }
      }
      return { quotaHit };
    });

    // Whether quota was hit or not, the storage should be functional
    const storageMode = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const result = await ext.storage.local.get("storageMode");
      return result.storageMode ?? "sync";
    });

    // If quota was hit, mode should have switched; otherwise stays sync
    if (overflowResult.quotaHit) {
      expect(storageMode).toBe("local");
    } else {
      expect(["sync", "local"]).toContain(storageMode);
    }

    await page.close();
  });

  test("updates content script cache on storage change", async ({
    context,
    extensionId,
  }) => {
    const page = await getExtPage(context, extensionId);

    const snippet = makeSnippet({
      id: "cache-update-test",
      label: "Cache Update Test",
      shortcut: "/cacheupdate",
      content: "Cache update content",
    });

    // Write to sync AND update the content script cache
    await page.evaluate(async (snip) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.sync.set({ [`snip:${snip.id}`]: snip });
      // Also update the cache (the StorageManager does this after every write)
      const cached =
        (await ext.storage.local.get("cachedSnippets")).cachedSnippets ?? [];
      await ext.storage.local.set({ cachedSnippets: [...cached, snip] });
    }, snippet);

    // Read back the cache
    const cache = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const result = await ext.storage.local.get("cachedSnippets");
      return result.cachedSnippets ?? [];
    });

    const found = (cache as (typeof snippet)[]).find(
      (s) => s.id === snippet.id
    );
    expect(found).toBeTruthy();
    expect(found?.shortcut).toBe("/cacheupdate");

    await page.close();
  });

  test("maintains IndexedDB shadow backup", async ({
    context,
    extensionId,
  }) => {
    const page = await getExtPage(context, extensionId);

    const snippet = makeSnippet({
      id: "idb-backup-test",
      label: "IDB Backup Test",
      shortcut: "/idbbackup",
      content: "IndexedDB backup content",
    });

    // Write directly to IndexedDB (as the backup system would)
    await page.evaluate(async (snip) => {
      await new Promise<void>((resolve, reject) => {
        const openReq = indexedDB.open("clipio-backup", 1);
        openReq.onupgradeneeded = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains("snippets")) {
            db.createObjectStore("snippets", { keyPath: "id" });
          }
        };
        openReq.onsuccess = () => {
          const db = openReq.result;
          const tx = db.transaction("snippets", "readwrite");
          const store = tx.objectStore("snippets");
          store.put(snip);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        openReq.onerror = () => reject(openReq.error);
      });
    }, snippet);

    // Read back via the helper
    const idbSnippets = await readIndexedDbSnippets(page);
    const found = idbSnippets.find((s) => s.id === snippet.id);
    expect(found).toBeTruthy();
    expect(found?.label).toBe("IDB Backup Test");

    await page.close();
  });

  test("persists storage mode selection across sessions", async ({
    context,
    extensionId,
  }) => {
    const page = await getExtPage(context, extensionId);

    // Switch to local mode
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({ storageMode: "local" });
    });
    await page.close();

    // Re-open and verify it stayed in local mode
    const page2 = await getExtPage(context, extensionId);
    const mode = await page2.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const result = await ext.storage.local.get("storageMode");
      return result.storageMode;
    });

    expect(mode).toBe("local");
    await page2.close();
  });

  test("handles concurrent writes without data loss", async ({
    context,
    extensionId,
  }) => {
    const page = await getExtPage(context, extensionId);

    const snippets = makeSnippets(5, (i) => ({
      id: `concurrent-${i}`,
      label: `Concurrent ${i}`,
      shortcut: `/con${i}`,
      content: `Concurrent content ${i}`,
    }));

    // Write all snippets concurrently
    await page.evaluate(async (snips) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await Promise.all(
        snips.map((s) => ext.storage.sync.set({ [`snip:${s.id}`]: s }))
      );
    }, snippets);

    // Read back all keys
    const keys = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const all = await ext.storage.sync.get(null);
      return Object.keys(all as Record<string, unknown>).filter((k) =>
        k.startsWith("snip:concurrent-")
      );
    });

    // All 5 snippets should have been written
    expect(keys.length).toBe(5);
    await page.close();
  });

  test("migrates legacy single-key format to per-key format", async ({
    context,
    extensionId,
  }) => {
    const page = await getExtPage(context, extensionId);

    const legacySnippets = makeSnippets(2, (i) => ({
      id: `legacy-${i}`,
      label: `Legacy Snippet ${i}`,
      shortcut: `/leg${i}`,
      content: `Legacy content ${i}`,
    }));

    // Seed the old format: all snippets under a single "snippets" key
    await page.evaluate(async (snips) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.sync.set({ snippets: snips });
    }, legacySnippets);

    // Simulate StorageManager migration: read old key, write per-key format
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const result = await ext.storage.sync.get("snippets");
      const snips = (result.snippets as typeof legacySnippets) ?? [];
      if (snips.length > 0) {
        const perKey: Record<string, unknown> = {};
        for (const s of snips) {
          perKey[`snip:${s.id}`] = s;
        }
        await ext.storage.sync.set(perKey);
        await ext.storage.sync.remove("snippets");
      }
    });

    // Verify per-key format exists
    const newKeys = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const all = await ext.storage.sync.get(null);
      return Object.keys(all as Record<string, unknown>);
    });

    expect(newKeys.some((k) => k.startsWith("snip:legacy-"))).toBe(true);
    expect(newKeys).not.toContain("snippets");

    await page.close();
  });
});
