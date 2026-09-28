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
 * Type text into a field and return its locator.
 *
 * Expansion is debounced inside the content script by TYPING_TIMEOUT, so
 * callers must assert with an auto-retrying expectation (`toHaveValue`,
 * `toContainText`) instead of sleeping. A fixed sleep is a flake: it passed
 * 3/3 in isolation but failed under full-suite load once `retries` was set
 * to 0, which is exactly the failure mode the retry was hiding.
 */
async function typeIntoField(
  page: import("@playwright/test").Page,
  selector: string,
  text: string
) {
  const field = page.locator(selector);
  await field.click();
  await page.keyboard.type(text, { delay: 30 });
  return field;
}

/** Auto-retrying window for a debounced expansion to land. */
const EXPANSION_TIMEOUT = 5_000;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Content Script Expansion", () => {
  test("expands shortcut in text input", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const input = await typeIntoField(
      testPage,
      '[data-testid="text-input"]',
      "/hello"
    );
    await expect(input).toHaveValue(/Hello, World!/, {
      timeout: EXPANSION_TIMEOUT,
    });
    expect(await input.inputValue()).not.toContain("/hello");
  });

  test("expands shortcut in textarea", async ({ testPage, storageHelper }) => {
    await setupTestPage(testPage, storageHelper, [multilineSnippet()]);

    const textarea = await typeIntoField(
      testPage,
      '[data-testid="textarea-field"]',
      "/multi"
    );
    await expect(textarea).toHaveValue(/Line 1/, {
      timeout: EXPANSION_TIMEOUT,
    });
    const value = await textarea.inputValue();
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
    await expect(ce).toContainText("Hello, World!", {
      timeout: EXPANSION_TIMEOUT,
    });
    expect(await ce.innerText()).not.toContain("/hello");
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

    // Negative case: nothing may ever appear here, so wait out the debounce
    // before asserting. A fixed sleep is required — an auto-retrying
    // assertion cannot prove a negative.
    await testPage.waitForTimeout(TYPING_TIMEOUT + 400);

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
    // Wait for the async expansion, then read once. Not a negative assertion,
    // so `expect.poll` on the same read would be the stronger form; kept short
    // because the Tab path expands synchronously on the key event (see the note
    // above), so this only covers the promise settling.
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
    // Wait for the expansion to land before the one-shot read below.
    //
    // An earlier version of this comment claimed a poll "would not help here"
    // because the read is a single `inputValue()`. That is not a reason —
    // `expect.poll(() => input.inputValue())` works fine. What actually
    // justifies the sleep is that the assertion is a *negative*: `not.toContain`
    // cannot be proven by a retrying check, because one that never matches just
    // waits out its timeout and fails, which looks the same as "not yet".
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

    // Auto-retrying assertion instead of a sleep: it polls until the
    // debounce fires, so it is both faster and immune to load variance.
    await expect(input).toHaveValue(/Hello, World!/, {
      timeout: EXPANSION_TIMEOUT,
    });
  });

  test("positions cursor with {{cursor}} placeholder in input", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [cursorSnippet()]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/cursor", { delay: 30 });
    await expect(input).toHaveValue(/Dear /, { timeout: EXPANSION_TIMEOUT });
    const value = await input.inputValue();
    // Content is "Dear {{cursor}}, Thank you!" → cursor replaces {{cursor}}
    // The final text should have the placeholder removed
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
    await expect(ce).toContainText("Dear ", { timeout: EXPANSION_TIMEOUT });
    const innerText = await ce.innerText();
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
    await expect(input).toHaveValue(/Copied:/, { timeout: EXPANSION_TIMEOUT });
    const value = await input.inputValue();
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

    const input = await typeIntoField(
      testPage,
      '[data-testid="text-input"]',
      "/date"
    );
    await expect(input).toHaveValue(/Today is \d{4}-\d{2}-\d{2}/, {
      timeout: EXPANSION_TIMEOUT,
    });
    const value = await input.inputValue();
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
    // Markdown should be rendered as HTML in contenteditable.
    // Poll the rendered HTML rather than sleeping, since the debounce plus the
    // contenteditable insertion path is the slowest in the suite.
    await expect
      .poll(() => ce.innerHTML(), { timeout: EXPANSION_TIMEOUT })
      .toMatch(/<strong>Bold text<\/strong>/i);
    // _italic text_ → <em>italic text</em>
    expect(await ce.innerHTML()).toMatch(/<em>italic text<\/em>/i);
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
    await expect(input).toHaveValue(/Long shortcut content/, {
      timeout: EXPANSION_TIMEOUT,
    });
    // Should expand /hello (long), not /h (short)
    expect(await input.inputValue()).not.toContain("Short content");
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

    // Wait for the content script to re-index on the storage change.
    //
    // The sleep that stood here was not pointless, despite the next line merely
    // building a locator: it was waiting for the content script to pick up the
    // new snippet, and a locator construction waits for nothing. Typing before
    // the index is rebuilt finds no match, so the expansion silently does not
    // happen. Polling the cache states the actual condition.
    await expect
      .poll(
        async () => {
          const cached = await storageHelper.getLocal("cachedSnippets");
          return Array.isArray(cached) && cached.length > 0;
        },
        { timeout: 5_000, message: "cache never picked up the new snippet" }
      )
      .toBe(true);

    // Now try to expand in the test page
    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/dynamic", { delay: 30 });

    await expect(input).toHaveValue(/Dynamically added!/, {
      timeout: EXPANSION_TIMEOUT,
    });
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

    // Should still work without throwing
    await expect(input).toHaveValue(/Hello, World!/, {
      timeout: EXPANSION_TIMEOUT,
    });
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

    // The palette lives in a CLOSED shadow root, so Playwright cannot select
    // rows. The host mirrors non-content state instead — see
    // specs/preview-encapsulation.spec.md. Asserting the row count also proves
    // both seeded snippets were offered.
    const host = testPage.locator("#clipio-snippet-preview-host");
    await expect(host).toHaveAttribute("data-preview-visible", "true", {
      timeout: 5_000,
    });
    await expect(host).toHaveAttribute("data-preview-rows", "many");

    // The host is sized to the palette, so a non-zero box proves it laid out.
    const boundingBox = await host.boundingBox();
    expect(boundingBox).not.toBeNull();
    expect(boundingBox!.width).toBeGreaterThan(0);
    expect(boundingBox!.height).toBeGreaterThan(0);

    // The branding header and the rows live inside a CLOSED shadow root, so
    // neither is selectable from the page world. Their rendering is asserted
    // in src/lib/snippet-preview-ui.accessibility.test.ts, which runs as
    // extension code via the @internal getInternalShadowRoot() accessor.
    // Here we assert only what the host mirrors: open, with 2 rows.
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

    // Auto-retrying: poll until the filter has been applied.
    // With 2 seeded snippets (/hello and /date) a query of "hello" must leave
    // exactly 1 row. That is a stronger claim than the previous text match:
    // it proves the non-matching snippet was actually excluded.
    const host = testPage.locator("#clipio-snippet-preview-host");
    await expect(host).toHaveAttribute("data-preview-visible", "true", {
      timeout: 5_000,
    });
    await expect(host).toHaveAttribute("data-preview-rows", "1");
  });

  test("hides preview when no matches", async ({ testPage, storageHelper }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();

    // Type prefix with non-matching query
    await testPage.keyboard.type("/xyz123", { delay: 30 });

    // Preview should be hidden when nothing matches
    const host = testPage.locator("#clipio-snippet-preview-host");
    await expect(host).toHaveAttribute("data-preview-visible", "false", {
      timeout: 5_000,
    });
    await expect(host).toHaveAttribute("data-preview-rows", "0");
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

    const host = testPage.locator("#clipio-snippet-preview-host");
    await expect(host).toHaveAttribute("data-preview-rows", "many", {
      timeout: 5_000,
    });

    // First row is selected by default
    await expect(host).toHaveAttribute("data-preview-selected", "0");

    // ArrowDown moves the highlight to the second row
    await testPage.keyboard.press("ArrowDown");
    await expect(host).toHaveAttribute("data-preview-selected", "1");

    // ArrowUp moves it back
    await testPage.keyboard.press("ArrowUp");
    await expect(host).toHaveAttribute("data-preview-selected", "0");

    // The highlight must not run past the last row.
    await testPage.keyboard.press("ArrowUp");
    await expect(host).toHaveAttribute("data-preview-selected", "0");
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

    const previewContainer = testPage.locator("#clipio-snippet-preview-host");
    await expect(previewContainer).toBeVisible();

    // Press Enter to select the first snippet
    await testPage.keyboard.press("Enter");

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

    const previewContainer = testPage.locator("#clipio-snippet-preview-host");
    await expect(previewContainer).toBeVisible();

    // Press Escape to close
    await testPage.keyboard.press("Escape");

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

    // Manual trigger lists every snippet, unfiltered
    const host = testPage.locator("#clipio-snippet-preview-host");
    await expect(host).toHaveAttribute("data-preview-visible", "true", {
      timeout: 5_000,
    });
    await expect(host).toHaveAttribute("data-preview-rows", "many");
  });

  test("works in textarea elements", async ({ testPage, storageHelper }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const textarea = testPage.locator('[data-testid="textarea-field"]');
    await textarea.click();

    // Type the trigger prefix
    await testPage.keyboard.type("/", { delay: 30 });

    const previewContainer = testPage.locator("#clipio-snippet-preview-host");
    await expect(previewContainer).toBeVisible();

    // Select snippet with Enter
    // Let the Enter handler insert the snippet before the one-shot text read
    // below.
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

    const previewContainer = testPage.locator("#clipio-snippet-preview-host");
    await expect(previewContainer).toBeVisible();

    // Select snippet with Enter
    // Let the Enter handler insert the snippet before the one-shot text read
    // below.
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

    const previewContainer = testPage.locator("#clipio-snippet-preview-host");
    await expect(previewContainer).toBeVisible();

    // Select the snippet with Enter
    // Let the Enter handler insert the snippet before the one-shot text read
    // below.
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

    const previewContainer = testPage.locator("#clipio-snippet-preview-host");
    await expect(previewContainer).toBeVisible();

    // Click somewhere else to lose focus
    const textarea = testPage.locator('[data-testid="textarea-field"]');
    await textarea.click();

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

    // Assert on the host's mirrored state, not on row selectors: the shadow
    // root is closed, so ".clipio-preview-item" is never in the light DOM and
    // toHaveCount(0) would pass no matter what the extension did.
    await expect(
      testPage.locator("#clipio-snippet-preview-host")
    ).toHaveAttribute("data-preview-visible", "false", { timeout: 5_000 });
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

    // Mirrored state, not a row count: with a closed root a row selector
    // would always report 0 and assert nothing.
    await expect(
      testPage.locator("#clipio-snippet-preview-host")
    ).toHaveAttribute("data-preview-visible", "false", { timeout: 5_000 });
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

  test("page script cannot reach preview rows, so cannot click one", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    // Open the palette with trusted input, so a row genuinely exists.
    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.press("Control+Shift+Space");
    const host = testPage.locator("#clipio-snippet-preview-host");
    await expect(host).toHaveAttribute("data-preview-rows", "1", {
      timeout: 5_000,
    });

    // The shadow root is closed, so the page has no handle on the row at all.
    // This is the property that makes the row-click isTrusted guard
    // unreachable rather than merely unexercised.
    const reachable = await testPage.evaluate(() => {
      const el = document.getElementById("clipio-snippet-preview-host");
      return {
        shadowRoot: el ? el.shadowRoot : "no-host",
        rowsInLightDom: document.querySelectorAll(".clipio-preview-item")
          .length,
        bodyMentionsLabel:
          document.body.textContent?.includes("Hello World") ?? false,
      };
    });

    expect(reachable.shadowRoot).toBeNull();
    // The snippet label must not be readable from the page at all.
    expect(reachable.bodyMentionsLabel).toBe(false);

    // And no insertion happened, while the extension is demonstrably
    // functional in this same page: a trusted keystroke still expands.
    expect(await input.inputValue()).toBe("");
    await input.click();
    await testPage.keyboard.type("/hello");
    await expect(input).toHaveValue(/Hello, World!/, { timeout: 5_000 });
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
    await expect(
      testPage.locator("#clipio-snippet-preview-host")
    ).toHaveAttribute("data-preview-rows", "1", { timeout: 5_000 });

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
