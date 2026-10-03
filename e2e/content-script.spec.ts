/**
 * Content script expansion — the tests that need a real browser.
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
  }); /**
   * Records whether the content script called `preventDefault()` on the
   * keydown it handled, by observing the event from the page's own listener.
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

  test("anchors the palette to the caret, not to the field bottom", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const textarea = testPage.locator('[data-testid="textarea-field"]');
    // A tall field makes the difference unambiguous: the caret is on line 1,
    // the fallback anchor is ~10 rows further down.
    await textarea.evaluate((el: HTMLTextAreaElement) => {
      el.rows = 10;
    });
    await textarea.click();
    await testPage.keyboard.type("/", { delay: 30 });

    const host = testPage.locator("#clipio-snippet-preview-host");
    await expect(host).toHaveAttribute("data-preview-visible", "true", {
      timeout: 5_000,
    });

    const palette = await host.boundingBox();
    const field = await textarea.boundingBox();
    expect(palette).not.toBeNull();
    expect(field).not.toBeNull();

    // Just below the caret on the first line.
    expect(palette!.y).toBeGreaterThan(field!.y);
    expect(palette!.y).toBeLessThan(field!.y + 60);

    // And nowhere near the bottom edge the fallback used.
    expect(palette!.y).toBeLessThan(field!.y + field!.height - 60);
  });

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
});
