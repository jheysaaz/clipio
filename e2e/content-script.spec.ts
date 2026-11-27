/**
 * Content script expansion — the tests that need a real browser.
 *
 * Covers the seams that cannot be reproduced in happy-dom: real injection into
 * a page, caret/selection state, palette geometry, isTrusted event handling and
 * the shadow-root boundary that keeps page scripts out of the preview rows.
 *
 * Converter and placeholder rules are covered in src/lib/*.test.ts, so they are
 * deliberately not re-proved here.
 */

import { test, expect } from "./fixtures.js";
import type { StorageHelper } from "./fixtures.js";
import {
  blockMarkdownSnippet,
  helloSnippet,
  cursorSnippet,
  makeSnippet,
} from "./helpers/snippets.js";
import { waitForContentScriptReady } from "./helpers/content-script.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

  test("renders block markdown as elements in a contenteditable", async ({
    testPage,
    storageHelper,
  }) => {
    // The reported bug: `# Heading`, `- item` and `> quote` were inserted as their
    // own source. Asserted on real elements in a real browser, because the unit
    // tests could only prove the converter's output shape.
    await setupTestPage(testPage, storageHelper, [blockMarkdownSnippet()]);

    const ce = testPage.locator('[data-testid="contenteditable-field"]');
    await ce.click();
    await testPage.keyboard.type("/bm", { delay: 30 });

    await expect(ce.locator("h1")).toHaveText("Heading");
    await expect(ce.locator("ul li")).toHaveCount(2);
    await expect(ce.locator("blockquote")).toHaveText("a blockquote");

    // Not one marker may reach the field. This is the assertion that fails on a
    // regression — the element checks above would pass against a renderer that
    // emitted the tags *and* left the source behind.
    await expect(ce).not.toContainText("# Heading");
    await expect(ce).not.toContainText("> a blockquote");

    // The insertion check runs against this snippet too, and this snippet is the
    // only fixture that produces a `<li>` — so it is the one that exposes whether
    // the renderer and the check agree about what a list renders as.
    //
    // They did not, for one commit: the check injected a `•` before every item on
    // the premise that `innerText` renders one. It does not (`::marker` is not
    // text), so every list-bearing snippet stopped firing confetti *and* reported
    // a phantom reverted insertion to Sentry. Asserting the rendered elements and
    // the confetti run in the same test is what stops the two modules drifting
    // apart again — either assertion alone passes while the pair is broken.
    await expect
      .poll(
        () =>
          testPage.evaluate(() => document.querySelectorAll("canvas").length),
        { timeout: 5000 }
      )
      .toBeGreaterThan(0);
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

  test("places the caret at the end without a cursor placeholder", async ({
    testPage,
    storageHelper,
  }) => {
    // The {{cursor}} path has a marker to position the selection. A snippet
    // without one still has to leave the caret after the inserted text — the
    // auto-expansion contenteditable path never had that fallback.
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const ce = testPage.locator('[data-testid="contenteditable-field"]');
    await ce.click();
    await testPage.keyboard.type("/hello", { delay: 30 });
    await expect(ce).toContainText("Hello, World!", {
      timeout: EXPANSION_TIMEOUT,
    });

    const caretOffset = await ce.evaluate((el) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return -1;
      const range = selection.getRangeAt(0);
      if (!el.contains(range.endContainer)) return -2;
      const before = range.cloneRange();
      before.selectNodeContents(el);
      before.setEnd(range.endContainer, range.endOffset);
      return before.toString().length;
    });

    expect(caretOffset).toBe("Hello, World!".length);
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

  test("keeps the palette next to a caret in a field low on the page", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    // A field near the viewport bottom used to flip the palette using the
    // available space *above* as its height. The panel then rendered at y=20
    // while the caret was hundreds of pixels below it.
    await testPage.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "700px";
      document.body.appendChild(spacer);

      const input = document.createElement("input");
      input.type = "text";
      input.dataset.testid = "low-input";
      input.style.width = "320px";
      document.body.appendChild(input);
      input.scrollIntoView({ block: "end" });
    });

    const input = testPage.getByTestId("low-input");
    await input.click();
    await testPage.keyboard.type("/", { delay: 30 });

    const host = testPage.locator("#clipio-snippet-preview-host");
    await expect(host).toHaveAttribute("data-preview-visible", "true", {
      timeout: 5_000,
    });

    const palette = await host.boundingBox();
    const inputBox = await input.boundingBox();
    expect(palette).not.toBeNull();
    expect(inputBox).not.toBeNull();

    const caretY = inputBox!.y + inputBox!.height / 2;
    const distance = Math.min(
      Math.abs(palette!.y - caretY),
      Math.abs(palette!.y + palette!.height - caretY)
    );
    expect(distance).toBeLessThan(90);
    expect(palette!.y).toBeGreaterThan(caretY - 200);
  });

  test("anchors a long single-line input's palette to the visible caret", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    // `<input>` scrolls horizontally; a wrapping mirror put the marker on a
    // later line and collapsed its x to the clamped left margin.
    const input = testPage.locator('[data-testid="text-input"]');
    await input.fill("a long value before the shortcut ".repeat(6));
    await input.press("End");
    await testPage.keyboard.type("/");

    const host = testPage.locator("#clipio-snippet-preview-host");
    await expect(host).toHaveAttribute("data-preview-visible", "true", {
      timeout: 5_000,
    });

    const palette = await host.boundingBox();
    const field = await input.boundingBox();
    expect(palette).not.toBeNull();
    expect(field).not.toBeNull();
    expect(palette!.x).toBeGreaterThan(field!.x + field!.width - 120);
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

  test("picks up a snippet created in the popup without a page reload", async ({
    testPage,
    popupPage,
    storageHelper,
  }) => {
    // The content script reads cachedSnippets, not storage.sync, and is told
    // about changes through the storage watch. Adding in the popup must reach
    // an already-open tab — reloading the page would hide a broken watch.
    await storageHelper.clearAll();
    await testPage.reload();
    await testPage.waitForLoadState("domcontentloaded");
    await waitForContentScriptReady(testPage);

    await popupPage.reload();
    await expect(popupPage.getByTestId("add-snippet")).toBeVisible();
    await popupPage.getByTestId("add-snippet").click();
    await popupPage.getByTestId("snippet-label-input").fill("Live add");
    await popupPage.getByTestId("snippet-shortcut-input").fill("/live");
    await popupPage
      .locator('[contenteditable="true"]')
      .first()
      .fill("Live update content");

    // The first valid autosave creates the snippet; no Create button remains.
    await expect(popupPage).toHaveURL(/#\/snippet\//, { timeout: 10_000 });

    await expect
      .poll(async () => (await storageHelper.readSyncSnippets()).length, {
        timeout: EXPANSION_TIMEOUT,
      })
      .toBe(1);

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/live", { delay: 30 });
    await expect(input).toHaveValue(/Live update content/, {
      timeout: EXPANSION_TIMEOUT,
    });
  });

  test("picks up an edit made in the popup without a page reload", async ({
    testPage,
    popupPage,
    storageHelper,
  }) => {
    // Same watch, other direction: an existing shortcut must serve the new
    // content after the popup saves, not the text the page cached at startup.
    const snippet = makeSnippet({
      label: "Live edit",
      shortcut: "/edit",
      content: "Original content",
    });
    await storageHelper.seedSnippets([snippet]);
    await testPage.reload();
    await testPage.waitForLoadState("domcontentloaded");
    await waitForContentScriptReady(testPage);

    await popupPage.reload();
    await expect(popupPage.getByTestId("snippet-list-item")).toBeVisible();
    await popupPage.getByTestId("snippet-list-item").click();
    const editor = popupPage.locator('[contenteditable="true"]').first();
    await editor.fill("Updated content");
    await expect(editor).toContainText("Updated content");

    // The edit is staged on blur rather than by a Save button, which no longer
    // exists. `pagehide` is the event a real popup blur produces.
    await popupPage.evaluate(() => window.dispatchEvent(new Event("pagehide")));

    await expect
      .poll(async () => (await storageHelper.readSyncSnippets())[0]?.content, {
        timeout: EXPANSION_TIMEOUT,
      })
      .toBe("Updated content");

    const input = testPage.locator('[data-testid="text-input"]');
    await input.click();
    await testPage.keyboard.type("/edit", { delay: 30 });
    await expect(input).toHaveValue(/Updated content/, {
      timeout: EXPANSION_TIMEOUT,
    });
    expect(await input.inputValue()).not.toContain("Original content");
  });
});
