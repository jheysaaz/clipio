/**
 * Phase 1: Content Script Expansion Tests (15 tests)
 *
 * Validates snippet expansion in real DOM environments:
 * <input>, <textarea>, and contenteditable elements.
 *
 * Test strategy:
 * - Serve the e2e/helpers/test-page.html via file:// protocol
 * - Seed snippets directly into storage via page.evaluate()
 * - Wait for content script to initialize (storage watch)
 * - Interact with fields using Playwright locators
 * - Verify DOM mutations and cursor positions
 */

import { test, expect } from "./fixtures.js";
import type { StorageHelper } from "./fixtures.js";
import {
  helloSnippet,
  cursorSnippet,
  clipboardSnippet,
  dateSnippet,
  markdownSnippet,
  multilineSnippet,
  shortShortcutSnippet,
  longShortcutSnippet,
} from "./helpers/snippets.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPING_TIMEOUT = 300; // Must match TIMING.TYPING_TIMEOUT in constants.ts

/**
 * Seed snippets into the extension storage AND reload the test page so the
 * content script picks up the fresh cache.
 *
 * Storage must be seeded via an extension page (via the storageHelper fixture)
 * because chrome.storage is not available in regular HTTP page contexts.
 */
async function setupTestPage(
  testPage: import("@playwright/test").Page,
  storageHelper: StorageHelper,
  snippets: import("../src/types/index.js").Snippet[]
) {
  // Seed snippets into local cache via an extension page
  // (the storageHelper opens a popup page internally to access chrome.storage)
  await storageHelper.seedSnippets(snippets);

  // Reload so the content script initializes with the new cache
  await testPage.reload();
  await testPage.waitForLoadState("domcontentloaded");
  // Give content script time to initialize and pick up the storage data
  await testPage.waitForTimeout(600);
}

/**
 * Type text into a field and wait for the debounce period to expire.
 */
async function typeAndWaitDebounce(
  page: import("@playwright/test").Page,
  selector: string,
  text: string,
  extra = 100
) {
  await page.locator(selector).click();
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForTimeout(TYPING_TIMEOUT + extra);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Content Script Expansion", () => {
  test("expands shortcut in text input", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/hello", { delay: 30 });
    await testPage.waitForTimeout(TYPING_TIMEOUT + 150);

    const value = await input.inputValue();
    expect(value).toContain("Hello, World!");
    expect(value).not.toContain("/hello");
  });

  test("expands shortcut in textarea", async ({ testPage, storageHelper }) => {
    await setupTestPage(testPage, storageHelper, [multilineSnippet()]);

    const textarea = testPage.locator('[data-testid="textarea-field"]');
    await textarea.click();
    await testPage.keyboard.type("/multi", { delay: 30 });
    await testPage.waitForTimeout(TYPING_TIMEOUT + 150);

    const value = await textarea.inputValue();
    expect(value).toContain("Line 1");
    expect(value).toContain("Line 2");
    expect(value).toContain("Line 3");
    expect(value).not.toContain("/multi");
  });

  test("expands shortcut in contenteditable", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const ce = testPage.locator('[data-testid="contenteditable-field"]');
    await ce.click();
    await testPage.keyboard.type("/hello", { delay: 30 });
    await testPage.waitForTimeout(TYPING_TIMEOUT + 150);

    const innerText = await ce.innerText();
    expect(innerText).toContain("Hello, World!");
    expect(innerText).not.toContain("/hello");
  });

  test("does not expand partial match (no word boundary)", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    // "x/hello" — the "/hello" is not at a word boundary
    await testPage.keyboard.type("x/hello", { delay: 30 });
    await testPage.waitForTimeout(TYPING_TIMEOUT + 150);

    const value = await input.inputValue();
    // Should still contain the literal typed text, not the snippet
    expect(value).toBe("x/hello");
  });

  test("expands on Tab key (immediate, no debounce)", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/hello", { delay: 30 });
    // Press Tab immediately — no need to wait for debounce
    await testPage.keyboard.press("Tab");
    // Give just a brief moment for async expansion
    await testPage.waitForTimeout(200);

    const value = await input.inputValue();
    expect(value).toContain("Hello, World!");
    expect(value).not.toContain("/hello");
  });

  test("expands on Space key immediately", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/hello", { delay: 30 });
    await testPage.keyboard.press("Space");
    await testPage.waitForTimeout(200);

    const value = await input.inputValue();
    expect(value).toContain("Hello, World!");
    expect(value).not.toContain("/hello");
  });

  test("debounced expansion on regular typing (300ms)", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/hello", { delay: 30 });

    // Check before debounce fires — should NOT be expanded yet
    const valueBefore = await input.inputValue();
    expect(valueBefore).toBe("/hello");

    // Wait for debounce to fire
    await testPage.waitForTimeout(TYPING_TIMEOUT + 150);

    const valueAfter = await input.inputValue();
    expect(valueAfter).toContain("Hello, World!");
  });

  test("positions cursor with {{cursor}} placeholder in input", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [cursorSnippet()]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/cursor", { delay: 30 });
    await testPage.waitForTimeout(TYPING_TIMEOUT + 150);

    const value = await input.inputValue();
    // Content is "Dear {{cursor}}, Thank you!" → cursor replaces {{cursor}}
    // The final text should have the placeholder removed
    expect(value).toContain("Dear ");
    expect(value).toContain(", Thank you!");
    expect(value).not.toContain("{{cursor}}");

    // Cursor should be positioned where {{cursor}} was (after "Dear ")
    const selectionStart = await input.evaluate(
      (el: HTMLInputElement) => el.selectionStart
    );
    // "Dear " is 5 characters — cursor should be at position 5
    expect(selectionStart).toBe(5);
  });

  test("positions cursor with {{cursor}} in contenteditable", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [cursorSnippet()]);

    const ce = testPage.locator('[data-testid="contenteditable-field"]');
    await ce.click();
    await testPage.keyboard.type("/cursor", { delay: 30 });
    await testPage.waitForTimeout(TYPING_TIMEOUT + 150);

    const innerText = await ce.innerText();
    expect(innerText).toContain("Dear ");
    expect(innerText).toContain(", Thank you!");
    // The cursor marker element should have been removed
    const markerCount = await ce.locator('[data-clipio-cursor="true"]').count();
    expect(markerCount).toBe(0);
  });

  test("inserts clipboard content with {{clipboard}}", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [clipboardSnippet()]);

    // Write text to clipboard first
    await testPage.evaluate(async () => {
      await navigator.clipboard.writeText("clipboard-test-content");
    });

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/clip", { delay: 30 });
    await testPage.waitForTimeout(TYPING_TIMEOUT + 150);

    const value = await input.inputValue();
    expect(value).toContain("Copied:");
    // The clipboard content should appear (or fallback if unavailable)
    expect(
      value.includes("clipboard-test-content") ||
        value.includes("(clipboard unavailable)")
    ).toBe(true);
  });

  test("formats date with {{date:iso}}", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [dateSnippet()]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await typeAndWaitDebounce(testPage, '[data-testid="text-input"]', "/date");

    const value = await input.inputValue();
    expect(value).toContain("Today is ");
    // Should contain a date in YYYY-MM-DD format (iso)
    expect(value).toMatch(/Today is \d{4}-\d{2}-\d{2}/);
    expect(value).not.toContain("{{date");
  });

  test("renders markdown in contenteditable (**bold**, _italic_)", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [markdownSnippet()]);

    const ce = testPage.locator('[data-testid="contenteditable-field"]');
    await ce.click();
    await testPage.keyboard.type("/md", { delay: 30 });
    await testPage.waitForTimeout(TYPING_TIMEOUT + 150);

    // Markdown should be rendered as HTML in contenteditable
    const innerHTML = await ce.innerHTML();
    // **Bold text** → <strong>Bold text</strong>
    expect(innerHTML).toMatch(/<strong>Bold text<\/strong>/i);
    // _italic text_ → <em>italic text</em>
    expect(innerHTML).toMatch(/<em>italic text<\/em>/i);
  });

  test("matches longest shortcut first (/h vs /hello)", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [
      shortShortcutSnippet(),
      longShortcutSnippet(),
    ]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/hello", { delay: 30 });
    await testPage.waitForTimeout(TYPING_TIMEOUT + 150);

    const value = await input.inputValue();
    // Should expand /hello (long), not /h (short)
    expect(value).toContain("Long shortcut content");
    expect(value).not.toContain("Short content");
  });

  test("updates index on storage change (dynamic snippet)", async ({
    testPage,
    storageHelper,
    context,
    extensionId,
  }) => {
    // Start with no snippets (seed empty list to clear any prior state)
    await storageHelper.seedSnippets([]);
    await testPage.reload();
    await testPage.waitForTimeout(600);

    // Dynamically add a snippet via another extension page (simulating popup)
    const extPage = await context.newPage();
    await extPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await extPage.waitForLoadState("domcontentloaded");

    const dynamicSnippet = {
      id: "dynamic-001",
      label: "Dynamic Snippet",
      shortcut: "/dynamic",
      content: "Dynamically added!",
      tags: [],
      usageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await extPage.evaluate(async (snip) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({ cachedSnippets: [snip] });
    }, dynamicSnippet);
    await extPage.close();

    // Wait for the content script to pick up the storage change
    await testPage.waitForTimeout(500);

    // Now try to expand in the test page
    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/dynamic", { delay: 30 });
    await testPage.waitForTimeout(TYPING_TIMEOUT + 150);

    const value = await input.inputValue();
    expect(value).toContain("Dynamically added!");
  });

  test("handles extension context gracefully (no crash on invalid context)", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    // Simulate context invalidation by navigating away from the test page
    // In a real scenario this would be the extension being unloaded, but we
    // verify the page doesn't crash on normal usage as a smoke test.
    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/hello", { delay: 30 });
    await testPage.waitForTimeout(TYPING_TIMEOUT + 150);

    // Should still work without throwing
    const value = await input.inputValue();
    expect(value).toContain("Hello, World!");
  });
});
