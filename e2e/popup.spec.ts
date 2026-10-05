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
import {
  getLocalItem,
  readSyncSnippets,
  writeBackupSnippets,
} from "./helpers/storage.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for the popup's main content to be visible (React has hydrated).
 */
async function waitForPopupReady(page: import("@playwright/test").Page) {
  // Wait for the stable hydration landmarks added under e2e coverage
  // (): either the snippet list or the empty state.
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

test.describe("Popup routing", () => {
  test("deep-linking a snippet id selects that snippet", async ({
    popupPage,
    extensionId,
  }) => {
    // The case that decided the routing: a selection has an address, so a future
    // "open this specific snippet" — a context-menu entry, a notification, a
    // keyboard shortcut — builds a location instead of inventing a side channel.
    const target = makeSnippet({ label: "Deep link target", shortcut: ";dl" });

    // Navigate first, then seed: the reload inside `seedAndReload` keeps the hash,
    // so this exercises the path a real deep link takes — a cold open at that URL.
    await popupPage.goto(
      `chrome-extension://${extensionId}/popup.html#/snippet/${target.id}`
    );
    await seedAndReload(popupPage, [target]);

    // Regex rather than the full URL: the extension id differs per run, and
    // asserting on it would make this test about the harness.
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${target.id}$`));

    // `aria-activedescendant` is the assertion that matters: it names which option
    // in the list is selected. Not the label input — that lives in the *create*
    // form, so asserting on it would have passed for a popup showing nothing.
    await expect(popupPage.getByTestId("snippet-list")).toHaveAttribute(
      "aria-activedescendant",
      `snippet-${target.id}`
    );
    await expect(popupPage.getByTestId("snippet-copy")).toBeVisible();
  });

  test("never overrules an explicit address with the newest snippet", async ({
    popupPage,
    extensionId,
  }) => {
    // Two snippets, addressed the older one. Auto-selecting the newest would make
    // every deep link open the same snippet whatever its id — a link that looks
    // right and is wrong.
    const older = makeSnippet({ label: "Addressed", shortcut: ";a" });
    const newer = makeSnippet({ label: "Newer", shortcut: ";n" });
    // `updatedAt` decides which is newest, so make it unambiguous.
    (newer as { updatedAt: string }).updatedAt = "2999-01-01T00:00:00.000Z";

    await popupPage.goto(
      `chrome-extension://${extensionId}/popup.html#/snippet/${older.id}`
    );
    await seedAndReload(popupPage, [older, newer]);

    await expect(popupPage.getByTestId("snippet-list")).toHaveAttribute(
      "aria-activedescendant",
      `snippet-${older.id}`
    );
  });

  test("keeps the popup's history from growing as the selection changes", async ({
    popupPage,
  }) => {
    // Navigation is `replace` only. The popup closes on blur, so a history entry
    // is something the user can never use — and a stray Back press would go
    // somewhere meaningless.
    await seedAndReload(popupPage, makeSnippets(3));

    const before = await popupPage.evaluate(() => window.history.length);
    for (let i = 0; i < 2; i++) {
      await popupPage
        .locator('[data-testid="snippet-list"] [role="option"]')
        .nth(i)
        .click();
    }
    const after = await popupPage.evaluate(() => window.history.length);

    expect(after).toBe(before);
    // The address did change — otherwise the test above would pass trivially.
    await expect(popupPage).toHaveURL(/#\/snippet\//);
  });

  test("keeps the create form open when a context-menu draft arrives", async ({
    popupPage,
  }) => {
    // The regression: right-click → "Save selection" → the form opens with the
    // pasted text, then the snippet load resolves and auto-select navigated to
    // `#/snippet/<id>`, closing the form and taking the draft with it.
    //
    // The existing background e2e missed this because it opens the popup against
    // an *empty* library, where auto-select returns early regardless. So the
    // draft is seeded alongside real snippets — the condition that exposes it.
    await seedAndReload(popupPage, makeSnippets(2));

    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({
        contextMenuDraft: "text the user selected",
      });
    });
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    // The form is showing, and it is showing *their* text.
    await expect(popupPage.getByTestId("snippet-label-input")).toBeVisible();
    await expect(popupPage).toHaveURL(/#\/new/);
    await expect(
      popupPage.locator('[contenteditable="true"]').first()
    ).toContainText("text the user selected");
  });

  test("addressing a newly created snippet moves the URL to it", async ({
    popupPage,
  }) => {
    // "Copy link to this snippet" needs no work to start working, because the id
    // is in the URL as soon as the snippet exists.
    await waitForPopupReady(popupPage);
    await popupPage.getByTestId("add-snippet").click();
    await popupPage.getByTestId("snippet-label-input").fill("Addressed");
    await popupPage.getByTestId("snippet-shortcut-input").fill(";ad");
    await popupPage.locator('[contenteditable="true"]').first().fill("hello");
    await popupPage.getByTestId("snippet-create-save").click();

    await expect(popupPage).toHaveURL(/#\/snippet\//);
  });
});

test.describe("Popup (Dashboard)", () => {
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
      // Exactly one. This was `toBeGreaterThanOrEqual(1)`, which is why a create
      // that produced two snippets passed: one is "at least one".
      .toBe(1);
    await expect(popupPage.getByTestId("snippet-list")).toBeVisible();

    // Rows, not keys. Storage holding exactly one `snip:` key is not the same
    // claim as the sidebar showing the snippet once, and the difference was the
    // whole bug: `addSnippet` appended optimistically *and* the change event its
    // own write fired drove a re-read, so one snippet in storage became two rows
    // on screen. Asserting only on storage is what let it through.
    await expect(popupPage.getByTestId("snippet-list-item")).toHaveCount(1);
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

// ---------------------------------------------------------------------------
// Save-path outcomes changed by Waves 9 and 10. Neither had e2e coverage, so
// both regressions below were invisible to the e2e suite.
// ---------------------------------------------------------------------------

test.describe("Popup (Dashboard) — oversized snippet is refused, not silently diverted", () => {});
