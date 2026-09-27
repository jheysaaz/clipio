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
import { waitForContentScriptReady } from "./helpers/content-script.js";

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
 *
 * Waits for the content script's real readiness signal (data-clipio-ready)
 * rather than a fixed sleep — typing before listeners attach silently drops
 * keystrokes, which caused intermittent expansion failures.
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
  await waitForContentScriptReady(testPage);
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
    await waitForContentScriptReady(testPage);

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

// ---------------------------------------------------------------------------
// Preview Feature Tests
// ---------------------------------------------------------------------------

test.describe("Snippet Preview Feature", () => {
  test("shows preview when typing trigger prefix", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [
      helloSnippet(),
      dateSnippet(),
    ]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();

    // Type the trigger prefix
    await testPage.keyboard.type("/", { delay: 30 });

    // Wait for preview host to attach (auto-retrying; avoids fixed sleeps)
    const previewContainer = testPage.locator("#clipio-snippet-preview-host");
    await expect(previewContainer).toBeAttached();

    // Get the bounding box to check if it has dimensions
    const boundingBox = await previewContainer.boundingBox();

    // Check if it has non-zero dimensions (alternative to toBeVisible for Shadow DOM)
    expect(boundingBox).not.toBeNull();
    expect(boundingBox!.width).toBeGreaterThan(0);
    expect(boundingBox!.height).toBeGreaterThan(0);

    // Branding header must render with the Clipio logo. The visible title was
    // shortened to "Snippets" in 81cd5e5 — the logo carries the branding, so
    // assert the logo rather than literal header copy.
    const header = previewContainer.locator(
      '[data-testid="clipio-preview-header"]'
    );
    await expect(header).toBeVisible();
    await expect(header.locator('img[alt="Clipio"]')).toBeVisible();

    // Check if snippets are listed (auto-retrying count avoids timing flakes)
    await expect(
      previewContainer.locator(".clipio-preview-item").first()
    ).toBeVisible();
  });

  test("filters snippets by query when typing after prefix", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [
      helloSnippet(),
      dateSnippet(),
    ]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();

    // Type the trigger prefix + query
    await testPage.keyboard.type("/hello", { delay: 30 });

    // Wait for preview to update
    await testPage.waitForTimeout(200);

    const previewContainer = testPage.locator("#clipio-snippet-preview-host");
    await expect(previewContainer).toBeVisible();

    // Should only show filtered results (hello snippet)
    const snippetItems = previewContainer.locator(".clipio-preview-item");
    const count = await snippetItems.count();
    expect(count).toBeLessThanOrEqual(2); // hello should match

    // Check that the snippet name or shortcut contains "hello"
    const firstItem = snippetItems.first();
    const itemText = await firstItem.textContent();
    expect(itemText?.toLowerCase()).toMatch(/hello/);
  });

  test("hides preview when no matches", async ({ testPage, storageHelper }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();

    // Type prefix with non-matching query
    await testPage.keyboard.type("/xyz123", { delay: 30 });

    // Wait for preview to process
    await testPage.waitForTimeout(200);

    // Preview should be hidden when no matches
    const previewContainer = testPage.locator("#clipio-snippet-preview-host");
    await expect(previewContainer).not.toBeVisible();
  });

  test("navigates preview with keyboard", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [
      helloSnippet(),
      dateSnippet(),
    ]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();

    // Type the trigger prefix to show preview
    await testPage.keyboard.type("/", { delay: 30 });
    await testPage.waitForTimeout(200);

    const previewContainer = testPage.locator("#clipio-snippet-preview-host");
    await expect(previewContainer).toBeVisible();

    // First item should be selected by default
    const firstItem = previewContainer.locator(".clipio-preview-item").first();
    await expect(firstItem).toHaveClass(/selected/);

    // Navigate down with arrow key
    await testPage.keyboard.press("ArrowDown");
    await testPage.waitForTimeout(100);

    // Second item should now be selected
    const secondItem = previewContainer.locator(".clipio-preview-item").nth(1);
    await expect(secondItem).toHaveClass(/selected/);

    // Navigate back up
    await testPage.keyboard.press("ArrowUp");
    await testPage.waitForTimeout(100);

    // First item should be selected again
    await expect(firstItem).toHaveClass(/selected/);
  });

  test("selects snippet with Enter key", async ({
    testPage,
    storageHelper,
  }) => {
    const helloSnip = helloSnippet();
    await setupTestPage(testPage, storageHelper, [helloSnip]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();

    // Type the trigger prefix
    await testPage.keyboard.type("/", { delay: 30 });
    await testPage.waitForTimeout(200);

    const previewContainer = testPage.locator("#clipio-snippet-preview-host");
    await expect(previewContainer).toBeVisible();

    // Press Enter to select the first snippet
    await testPage.keyboard.press("Enter");
    await testPage.waitForTimeout(200);

    // Preview should be hidden after selection
    await expect(previewContainer).not.toBeVisible();

    // Input should contain the expanded snippet content
    const value = await input.inputValue();
    expect(value).toContain(helloSnip.content);
  });

  test("closes preview with Escape key", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();

    // Type the trigger prefix
    await testPage.keyboard.type("/", { delay: 30 });
    await testPage.waitForTimeout(200);

    const previewContainer = testPage.locator("#clipio-snippet-preview-host");
    await expect(previewContainer).toBeVisible();

    // Press Escape to close
    await testPage.keyboard.press("Escape");
    await testPage.waitForTimeout(100);

    // Preview should be hidden
    await expect(previewContainer).not.toBeVisible();

    // Input should still contain the trigger prefix (not expanded)
    const value = await input.inputValue();
    expect(value).toBe("/");
  });

  test("shows manual preview with keyboard shortcut", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [
      helloSnippet(),
      dateSnippet(),
    ]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();

    // Use keyboard shortcut to manually trigger preview
    await testPage.keyboard.press("Control+Shift+Space");
    await testPage.waitForTimeout(200);

    const previewContainer = testPage.locator("#clipio-snippet-preview-host");
    await expect(previewContainer).toBeVisible();

    // Should show all snippets when manually triggered
    const snippetItems = previewContainer.locator(".clipio-preview-item");
    expect(await snippetItems.count()).toBeGreaterThanOrEqual(2);
  });

  test("works in textarea elements", async ({ testPage, storageHelper }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const textarea = testPage.locator('[data-testid="textarea-field"]');
    await textarea.click();

    // Type the trigger prefix
    await testPage.keyboard.type("/", { delay: 30 });
    await testPage.waitForTimeout(200);

    const previewContainer = testPage.locator("#clipio-snippet-preview-host");
    await expect(previewContainer).toBeVisible();

    // Select snippet with Enter
    await testPage.keyboard.press("Enter");
    await testPage.waitForTimeout(200);

    // Textarea should contain expanded content
    const value = await textarea.inputValue();
    expect(value).toContain("Hello, World!");
  });

  test("works in contenteditable elements", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const contenteditable = testPage.locator(
      '[data-testid="contenteditable-field"]'
    );
    await contenteditable.click();

    // Type the trigger prefix
    await testPage.keyboard.type("/", { delay: 30 });
    await testPage.waitForTimeout(200);

    const previewContainer = testPage.locator("#clipio-snippet-preview-host");
    await expect(previewContainer).toBeVisible();

    // Select snippet with Enter
    await testPage.keyboard.press("Enter");
    await testPage.waitForTimeout(200);

    // Contenteditable should contain expanded content
    const text = await contenteditable.textContent();
    expect(text).toContain("Hello, World!");
  });

  test("preserves line breaks when inserting multiline snippet via preview in contenteditable", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [multilineSnippet()]);

    const contenteditable = testPage.locator(
      '[data-testid="contenteditable-field"]'
    );
    await contenteditable.click();

    // Type the trigger prefix to open the preview popup
    await testPage.keyboard.type("/", { delay: 30 });
    await testPage.waitForTimeout(200);

    const previewContainer = testPage.locator("#clipio-snippet-preview-host");
    await expect(previewContainer).toBeVisible();

    // Select the snippet with Enter
    await testPage.keyboard.press("Enter");
    await testPage.waitForTimeout(200);

    // All three lines must be preserved (regression: line breaks were lost
    // because the old preview path assigned plain text via textContent).
    const innerText = await contenteditable.innerText();
    expect(innerText.trim()).toBe("Line 1\nLine 2\nLine 3");
    // Source HTML keeps the <br> separators
    const brCount = await contenteditable.locator("br").count();
    expect(brCount).toBeGreaterThanOrEqual(2);
  });

  test("hides preview when focus leaves input", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();

    // Type the trigger prefix
    await testPage.keyboard.type("/", { delay: 30 });
    await testPage.waitForTimeout(200);

    const previewContainer = testPage.locator("#clipio-snippet-preview-host");
    await expect(previewContainer).toBeVisible();

    // Click somewhere else to lose focus
    const textarea = testPage.locator('[data-testid="textarea-field"]');
    await textarea.click();
    await testPage.waitForTimeout(100);

    // Preview should be hidden when focus is lost
    await expect(previewContainer).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Untrusted event rejection
// spec: specs/content-script-trust.spec.md
//
// A Chrome isolated world shares the DOM event graph with the page, so a
// page-dispatched (synthetic) event still reaches the content script's
// capture-phase listeners. Before the isTrusted guard, a hostile page could
// force snippet expansion — and, via {{clipboard}}, force the user's
// clipboard into an attacker-controlled field.
// ---------------------------------------------------------------------------

test.describe("Untrusted event rejection", () => {
  /**
   * Install a document-capture probe that records whether the most recent
   * keydown had preventDefault() called on it.
   *
   * The content script registered its listener first, so by the time this
   * probe runs at the same node and phase, defaultPrevented already reflects
   * whatever the extension decided.
   */
  async function installDefaultPreventedProbe(
    page: import("@playwright/test").Page
  ) {
    await page.evaluate(() => {
      const w = window as unknown as { __clipioPrevented?: boolean };
      w.__clipioPrevented = false;
      document.addEventListener(
        "keydown",
        (event) => {
          w.__clipioPrevented = event.defaultPrevented;
        },
        true
      );
    });
  }

  async function readPreventedFlag(
    page: import("@playwright/test").Page
  ): Promise<boolean> {
    return page.evaluate(
      () =>
        (window as unknown as { __clipioPrevented?: boolean })
          .__clipioPrevented ?? false
    );
  }

  test("synthetic keydown does not expand a snippet in a text input", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);
    await installDefaultPreventedProbe(testPage);

    // Page-authored script creates a field it fully controls, parks the
    // caret after a valid shortcut, and dispatches a Space keydown.
    const value = await testPage.evaluate(async () => {
      const input = document.createElement("input");
      input.value = "/hello";
      document.body.appendChild(input);
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          code: "Space",
          bubbles: true,
          cancelable: true,
        })
      );
      // Outlive the 300ms expansion debounce before reading back.
      await new Promise((resolve) => setTimeout(resolve, 600));
      const result = input.value;
      input.remove();
      return result;
    });

    expect(value).toBe("/hello");
    expect(value).not.toContain("Hello, World!");
    // A page must not be able to swallow the host page's own default action.
    expect(await readPreventedFlag(testPage)).toBe(false);
  });

  test("synthetic keydown does not expand a snippet in a contenteditable", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const text = await testPage.evaluate(async () => {
      const el = document.createElement("div");
      el.contentEditable = "true";
      document.body.appendChild(el);
      const textNode = document.createTextNode("/hello");
      el.appendChild(textNode);
      el.focus();
      // The caret must land inside the TEXT node: handleKeyDown bails unless
      // range.startContainer is a text node, so selecting the element's
      // contents would return early for an unrelated reason.
      const range = document.createRange();
      range.setStart(textNode, textNode.data.length);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          code: "Space",
          bubbles: true,
          cancelable: true,
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 600));
      const result = el.textContent ?? "";
      el.remove();
      return result;
    });

    expect(text).toBe("/hello");
    expect(text).not.toContain("Hello, World!");
  });

  test("synthetic keydown does not open the preview palette", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    // Ctrl+Shift+Space is the default manual preview shortcut. If the guard
    // is missing, this opens the palette and renders every snippet label and
    // shortcut into the page DOM.
    await installDefaultPreventedProbe(testPage);
    await testPage.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>(
        '[data-testid="text-input"]'
      );
      if (!input) throw new Error("test input not found");
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          code: "Space",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    });

    // The host element is injected at init regardless of visibility, so its
    // presence proves nothing — assert on the rendered rows instead. A row
    // means snippet data (label + shortcut) reached the page DOM.
    await expect(testPage.locator(".clipio-preview-item")).toHaveCount(0);
    await expect(testPage.locator("#clipio-snippet-preview-host")).toBeHidden();
    // The page must not be able to swallow its own default action either.
    expect(await readPreventedFlag(testPage)).toBe(false);
  });

  test("synthetic input event does not expand or arm the debounce", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const value = await testPage.evaluate(async () => {
      const input = document.querySelector<HTMLInputElement>(
        '[data-testid="text-input"]'
      );
      if (!input) throw new Error("test input not found");
      input.value = "/hello";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 600));
      return input.value;
    });

    expect(value).toBe("/hello");
  });

  test("synthetic input event does not open the preview", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    // "/hello" ends with a slash-trigger prefix, so an untrusted input event
    // that reached the handler would render preview rows into the page.
    await testPage.locator('[data-testid="text-input"]').click();
    await testPage.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>(
        '[data-testid="text-input"]'
      );
      if (!input) throw new Error("test input not found");
      input.value = "/he";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await expect(testPage.locator(".clipio-preview-item")).toHaveCount(0);
  });

  test("synthetic input event does not expand a contenteditable", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    // Covers the input-listener branch that routes to
    // handleContentEditableInput, which is distinct from the keydown branch.
    const text = await testPage.evaluate(async () => {
      const el = document.createElement("div");
      el.contentEditable = "true";
      el.textContent = "/hello";
      document.body.appendChild(el);
      el.focus();
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 600));
      const result = el.textContent ?? "";
      el.remove();
      return result;
    });

    expect(text).toBe("/hello");
  });

  test("synthetic click on a preview row does not insert a snippet", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    // The user opens the preview legitimately (trusted input), so the row
    // exists in the page DOM. The shadow root is mode:"open", so page script
    // can then click it directly. That must not insert anything.
    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.press("Control+Shift+Space");
    await expect(testPage.locator(".clipio-preview-item").first()).toBeVisible({
      timeout: 5_000,
    });
    const value = await testPage.evaluate(async () => {
      const target = document.querySelector<HTMLInputElement>(
        '[data-testid="text-input"]'
      );
      if (!target) throw new Error("test input not found");
      // The rows live inside the host's shadow root, which plain
      // document.querySelector does NOT pierce (unlike Playwright locators).
      const host = document.querySelector("#clipio-snippet-preview-host");
      const shadowRoot = (host as HTMLElement | null)?.shadowRoot;
      if (!shadowRoot) throw new Error("preview shadow root not found");
      const row = shadowRoot.querySelector(".clipio-preview-item");
      if (!row) throw new Error("preview row not found");
      row.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      return target.value;
    });

    expect(value).toBe("");
  });

  test("trusted Enter on a preview row still inserts a snippet", async ({
    testPage,
    storageHelper,
  }) => {
    // Regression guard for the isTrusted guard on the row click handler and
    // for the preview selection path as a whole. Enter is the documented
    // primary way to accept a highlighted row.
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.press("Control+Shift+Space");
    await expect(testPage.locator(".clipio-preview-item").first()).toBeVisible({
      timeout: 5_000,
    });

    await testPage.keyboard.press("Enter");
    await expect(input).toHaveValue(/Hello, World!/, { timeout: 5_000 });
  });

  test("trusted keyboard input still expands a snippet", async ({
    testPage,
    storageHelper,
  }) => {
    // Regression guard: the isTrusted guard must not disable the extension.
    // Playwright's keyboard APIs dispatch trusted events.
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/hello");
    await expect(input).toHaveValue(/Hello, World!/, { timeout: 5_000 });
    expect(await input.inputValue()).not.toContain("/hello");
  });

  test("trusted Space keydown still expands a snippet immediately", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/hello");
    await testPage.keyboard.press("Space");

    await expect(input).toHaveValue(/Hello, World!/, { timeout: 5_000 });
  });
});
