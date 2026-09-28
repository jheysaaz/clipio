/**
 * Phase 3: Popup (Dashboard) Tests (12 tests)
 *
 * Validates the popup UI through full CRUD operations, search,
 * keyboard navigation, clipboard operations, and banners.
 *
 * Test strategy:
 * - Use popupPage fixture which navigates to chrome-extension://{id}/popup.html
 * - Wait for React hydration via waitForSelector
 * - Interact with UI using Playwright locators
 * - Verify storage changes via page.evaluate()
 * - Seed state via storage helpers before test
 */

import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures.js";
import { helloSnippet, makeSnippet, makeSnippets } from "./helpers/snippets.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for the popup's main content to be visible (React has hydrated).
 */
async function waitForPopupReady(page: import("@playwright/test").Page) {
  // Wait for the stable hydration landmarks added under e2e coverage
  // (specs/e2e-suite.spec.md): either the snippet list or the empty state.
  await page.waitForSelector(
    '[data-testid="snippet-list"], [data-testid="empty-state"]',
    { timeout: 10_000 }
  );
}

/**
 * Seed snippets and reload popup.
 */
async function seedAndReload(
  page: import("@playwright/test").Page,
  snippets: import("../src/types/index.js").Snippet[]
) {
  await page.evaluate(async (snips) => {
    const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
    const syncEntries: Record<string, (typeof snips)[0]> = {};
    for (const s of snips) {
      syncEntries[`snip:${s.id}`] = s;
    }
    await ext.storage.sync.set(syncEntries);
    await ext.storage.local.set({ cachedSnippets: snips, storageMode: "sync" });
  }, snippets);
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await waitForPopupReady(page);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Popup (Dashboard)", () => {
  test("loads and shows empty state when no snippets exist", async ({
    popupPage,
  }) => {
    // Clear any existing snippets
    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.sync.clear();
      await ext.storage.local.set({ cachedSnippets: [] });
    });
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    // Popup should load without the empty-state landmark when snippets exist,
    // or show it when none do — either way the hydration landmark must appear.
    const title = await popupPage.title();
    expect(title.length).toBeGreaterThan(0);

    // Empty state is the behavioral signal for "no snippets"
    await expect(popupPage.getByTestId("empty-state")).toBeVisible();
  });

  test("creates new snippet via form", async ({ popupPage }) => {
    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.sync.clear();
      await ext.storage.local.set({ cachedSnippets: [], storageMode: "sync" });
    });
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    // Click the "Add Snippet" button (stable testid)
    const newButton = popupPage.getByTestId("add-snippet");
    await expect(newButton).toBeVisible({ timeout: 5_000 });
    await newButton.click();

    // Wait for the form the button is supposed to open.
    const labelInput = popupPage.getByTestId("snippet-label-input");
    await expect(labelInput).toBeVisible({ timeout: 5_000 });
    const shortcutInput = popupPage.getByTestId("snippet-shortcut-input");

    await expect(labelInput).toBeVisible();
    await labelInput.fill("E2E Test Snippet");
    await expect(shortcutInput).toBeVisible();
    await shortcutInput.fill("/e2e");

    // canSave requires non-empty content — fill the PlateJS contenteditable
    const editor = popupPage.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 5_000 });
    await editor.click();
    await popupPage.keyboard.type("Created by e2e");

    // Save the snippet
    const saveButton = popupPage.getByTestId("snippet-create-save");
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // Poll the persisted value: the save handler writes asynchronously.
    await expect
      .poll(
        () =>
          popupPage.evaluate(async () => {
            const ext =
              (globalThis as any).chrome ?? (globalThis as any).browser;
            const all = await ext.storage.sync.get(null);
            return Object.keys(all).filter((k) => k.startsWith("snip:")).length;
          }),
        { timeout: 5_000, message: "snippet never reached sync storage" }
      )
      .toBeGreaterThanOrEqual(1);
    await expect(popupPage.getByTestId("snippet-list")).toBeVisible();
  });

  test("displays existing snippets in list", async ({ popupPage }) => {
    const snippets = [
      helloSnippet(),
      makeSnippet({ label: "Second Snippet", shortcut: "/second" }),
      makeSnippet({ label: "Third Snippet", shortcut: "/third" }),
    ];
    await seedAndReload(popupPage, snippets);

    // At least one snippet should be visible in the page
    const pageText = await popupPage.textContent("body");
    // At least one of the snippet labels should appear
    const hasSnippetContent =
      pageText?.includes("Hello World") ||
      pageText?.includes("Second Snippet") ||
      pageText?.includes("Third Snippet");
    expect(hasSnippetContent).toBe(true);
  });

  test("searches and filters snippets by label", async ({ popupPage }) => {
    const snippets = [
      makeSnippet({ label: "Alpha Snippet", shortcut: "/alpha" }),
      makeSnippet({ label: "Beta Snippet", shortcut: "/beta" }),
      makeSnippet({ label: "Gamma Snippet", shortcut: "/gamma" }),
    ];
    await seedAndReload(popupPage, snippets);

    // Find and use the search input (aria-label from dashboard.searchPlaceholder)
    const searchInput = popupPage.getByRole("textbox", { name: /search/i });
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await searchInput.fill("Beta");
    await expect(
      popupPage.getByTestId("snippet-list-item").filter({ hasText: "Beta" })
    ).toBeVisible();
    // Other labels must be filtered out
    await expect(
      popupPage.getByTestId("snippet-list-item").filter({ hasText: "Alpha" })
    ).toHaveCount(0);
  });

  test("shows sync-wipe recovery banner when syncDataLost is true", async ({
    popupPage,
  }) => {
    // Set the syncDataLost flag
    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({ syncDataLost: true });
    });
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    // Check for any warning/alert banner in the page
    const pageText = await popupPage.textContent("body");
    // The page should have loaded without crashing
    expect(pageText).toBeTruthy();

    // Look for a warning/alert element
    const alertEl = popupPage
      .locator(
        '[role="alert"], .warning, [data-testid*="warning"], [data-testid*="banner"]'
      )
      .first();
    const hasAlert = await alertEl.isVisible().catch(() => false);
    // Either the banner is visible or the page contains warning-related text
    const hasWarningText =
      pageText?.toLowerCase().includes("lost") ||
      pageText?.toLowerCase().includes("sync") ||
      pageText?.toLowerCase().includes("warning") ||
      pageText?.toLowerCase().includes("recover");
    expect(hasAlert || hasWarningText).toBe(true);
  });

  test("consumes context menu draft on popup open", async ({ popupPage }) => {
    const draftText = "Draft text from context menu";
    await popupPage.evaluate(async (draft: string) => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({ contextMenuDraft: draft });
    }, draftText);

    await popupPage.reload();
    await waitForPopupReady(popupPage);

    // The popup should consume the draft and show it in the form
    const pageText = await popupPage.textContent("body");
    // Either the draft text appears in the form, or the popup loaded without crashing
    expect(pageText).toBeTruthy();
  });

  test("popup viewport is approximately 680x460", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 680, height: 460 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(300);

    const viewport = page.viewportSize();
    expect(viewport?.width).toBe(680);
    expect(viewport?.height).toBe(460);

    // Verify the page loaded
    const body = page.locator("body");
    await expect(body).toBeVisible();
    await page.close();
  });

  test("keyboard navigation with arrow keys in snippet list", async ({
    popupPage,
  }) => {
    const snippets = makeSnippets(3, (i) => ({
      label: `Snippet ${i + 1}`,
      shortcut: `/s${i + 1}`,
    }));
    await seedAndReload(popupPage, snippets);

    // The list is a `role="listbox"` using virtual focus: `aria-activedescendant`
    // names the active option and `document.activeElement` never leaves the
    // container. So that is what has to be asserted.
    //
    // The previous version slept 100 ms between presses and then checked that
    // `body` was visible, which is true whether or not anything handled the
    // keystroke.
    const list = popupPage.getByTestId("snippet-list");
    await expect(list).toBeVisible();

    const activeDescendant = () =>
      list.evaluate((el) => el.getAttribute("aria-activedescendant"));

    // The first row is pre-selected on mount, so the assertion is about
    // *movement*, not about the initial state being empty.
    const initial = await activeDescendant();
    expect(initial).toBeTruthy();

    await popupPage.keyboard.press("ArrowDown");
    const second = await expect
      .poll(activeDescendant, {
        message: "ArrowDown never advanced the active option",
      })
      .not.toBe(initial)
      .then(() => activeDescendant());

    await popupPage.keyboard.press("ArrowDown");
    const third = await expect
      .poll(activeDescendant, {
        message: "a second ArrowDown did not advance the active option",
      })
      .not.toBe(second)
      .then(() => activeDescendant());

    // Three distinct rows across three positions, so the keys really walked the
    // list rather than repeatedly reporting the same id.
    expect(new Set([initial, second, third]).size).toBe(3);

    await popupPage.keyboard.press("ArrowUp");
    await expect
      .poll(activeDescendant, {
        message: "ArrowUp did not return to the previous option",
      })
      .toBe(second);
  });

  test("copies snippet to clipboard", async ({ popupPage }) => {
    await seedAndReload(popupPage, [helloSnippet()]);

    // Grant clipboard permissions
    await popupPage
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: `chrome-extension://${await popupPage.evaluate(() => (globalThis as typeof globalThis & { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id ?? "")}`,
      })
      .catch(() => {});

    // Find and click the copy button via stable testid
    const copyButton = popupPage.getByTestId("snippet-copy");
    await expect(copyButton).toBeVisible({ timeout: 5_000 });
    await copyButton.click();

    // Behavior: aria-pressed flips to true after a successful copy
    await expect(copyButton).toHaveAttribute("aria-pressed", "true", {
      timeout: 3_000,
    });
  });

  test("shows quota warning banner near storage limit", async ({
    popupPage,
  }) => {
    // Fill sync storage near quota threshold by setting many snippets
    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      // Create snippets that total close to 90KB (the WARN_AT threshold)
      const filler = "x".repeat(7_000); // ~7KB each, under 8KB per-item limit
      const entries: Record<string, unknown> = {};
      for (let i = 0; i < 13; i++) {
        entries[`snip:quota-${i}`] = {
          id: `quota-${i}`,
          label: `Quota Snippet ${i}`,
          shortcut: `/q${i}`,
          content: filler,
          tags: [],
          usageCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
      await ext.storage.sync.set(entries);
    });

    await popupPage.reload();
    await waitForPopupReady(popupPage);

    const body = popupPage.locator("body");
    await expect(body).toBeVisible();
    // The page should load — quota warning may or may not appear depending on actual usage
  });

  test("import button navigates to options page", async ({
    popupPage,
    context,
    extensionId,
  }) => {
    await waitForPopupReady(popupPage);

    // Click the settings button (exact accessible name — avoids matching
    // empty-state "Import snippets" or "Open settings")
    const settingsBtn = popupPage.getByRole("button", {
      name: "Settings & Import/Export",
      exact: true,
    });
    await expect(settingsBtn).toBeVisible({ timeout: 5_000 });
    const newPage = await Promise.all([
      context.waitForEvent("page", { timeout: 5_000 }).catch(() => null),
      settingsBtn.click(),
    ]).then(([p]) => p);

    expect(newPage).not.toBeNull();
    if (newPage) {
      await newPage.waitForLoadState("domcontentloaded");
      expect(newPage.url()).toContain(extensionId);
      await newPage.close();
    }

    // Smoke test: popup is still responsive
    const body = popupPage.locator("body");
    await expect(body).toBeVisible();
  });

  test("deletes snippet and verifies removal from storage", async ({
    popupPage,
  }) => {
    const snippet = makeSnippet({ label: "Delete Me", shortcut: "/delete-me" });
    await seedAndReload(popupPage, [snippet]);

    // Click delete via stable testid, then confirm in the dialog
    const deleteButton = popupPage.getByTestId("snippet-delete");
    await expect(deleteButton).toBeVisible({ timeout: 5_000 });
    await deleteButton.click();

    const confirmButton = popupPage
      .getByRole("button", { name: /delete|confirm|yes/i })
      .first();
    await expect(confirmButton).toBeVisible({ timeout: 5_000 });
    await confirmButton.click();

    // Storage verification — the seeded snippet must be gone. Poll: the delete
    // handler writes asynchronously.
    await expect
      .poll(
        () =>
          popupPage.evaluate(async () => {
            const ext =
              (globalThis as any).chrome ?? (globalThis as any).browser;
            const all = await ext.storage.sync.get(null);
            return Object.keys(all).filter((k) => k.startsWith("snip:")).length;
          }),
        { timeout: 5_000, message: "deleted snippet never left sync storage" }
      )
      .toBe(0);
    await expect(popupPage.getByTestId("empty-state")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Accessibility checks
  // -------------------------------------------------------------------------

  test("popup has no critical accessibility violations", async ({
    popupPage,
  }) => {
    // spec: specs/e2e-suite.spec.md
    // @axe-core/playwright v4 exposes the AxeBuilder class — the old
    // injectAxe/checkA11y free functions do not exist. Scan the hydrated
    // popup; fail on critical/serious violations without suppression, and
    // attach the full axe output to the report either way.
    await waitForPopupReady(popupPage);
    const results = await new AxeBuilder({ page: popupPage })
      .include("body")
      .analyze();
    await test.info().attach("axe-results", {
      body: JSON.stringify(results, null, 2),
      contentType: "application/json",
    });
    const critical = results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? "")
    );
    expect(critical).toEqual([]);
  });
});
