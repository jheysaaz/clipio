import { test, expect } from "./fixtures.js";
import type { StorageHelper } from "./fixtures.js";
import { multilineSnippet, helloSnippet } from "./helpers/snippets.js";

/**
 * Regressions for the contenteditable snippet-insertion flow.
 *
 * 1. Preview must open when the field already contains text (typed "/" or
 *    via the Ctrl+Shift+Space shortcut).
 * 2. After insertion the caret must land at the END of the inserted snippet,
 *    not at its start.
 * 3. The confetti celebration must actually render (not just create a canvas).
 */
test.describe("Contenteditable insertion flow", () => {
  test("preview opens when typing / after existing text", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const field = testPage.locator('[data-testid="contenteditable-field"]');
    const preview = testPage.locator("#clipio-snippet-preview-host");

    await field.click();
    // Type the existing text (trailing space is preserved by real typing).
    await testPage.keyboard.type("Hello ", { delay: 30 });

    // "/" follows a word boundary -> preview must open.
    await testPage.keyboard.type("/", { delay: 30 });
    await expect(preview).toBeVisible({
      timeout: 5000,
      message: "preview should open when typing / after existing text",
    });

    // The trigger text must survive in the field.
    await expect(field).toContainText("Hello /");
  });

  test("shortcut opens preview when field already has text", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const field = testPage.locator('[data-testid="contenteditable-field"]');
    const preview = testPage.locator("#clipio-snippet-preview-host");

    await field.click();
    await testPage.keyboard.type("existing text here", { delay: 30 });

    // Ctrl+Shift+Space (default manual shortcut) must open the snippet list
    // even though the field already contains text and no "/" trigger prefix.
    await testPage.keyboard.press("Control+Shift+Space");
    await expect(preview).toBeVisible({
      timeout: 5000,
      message: "shortcut should open preview with existing text",
    });
  });

  test("inserts snippet with caret at its end and renders confetti", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [multilineSnippet()]);

    const field = testPage.locator('[data-testid="contenteditable-field"]');
    const preview = testPage.locator("#clipio-snippet-preview-host");

    await field.click();
    // Multi-node field with the caret at the start of the second text node
    // (local focusOffset is 0, global offset is 6) — the old focusOffset bug
    // left the caret staged here after a rich-text edit.
    await field.evaluate((el) => {
      el.innerHTML = "<div>Hello </div><div>World<br></div>";
      const worldText = [...el.querySelectorAll("*")].reduce<Text | null>(
        (found, node) =>
          found ??
          [...node.childNodes].find(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent === "World"
          ) ??
          null,
        null
      );
      const range = document.createRange();
      range.setStart(worldText!, 0);
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });

    await testPage.keyboard.type("/", { delay: 30 });
    await expect(preview).toBeVisible();

    await testPage.keyboard.press("Enter");
    await testPage.waitForTimeout(350);

    // The snippet was inserted and "World" survived after it.
    const innerText = (await field.innerText()).trim();
    expect(innerText).toContain("Line 1");
    expect(innerText).toContain("Line 3");
    expect(innerText).toContain("World");

    // Caret must be at the END of the inserted snippet: before the "World"
    // text that followed the trigger, i.e. its offset must equal the index of
    // "World" in the field's textContent (not the snippet's start).
    const caretOffset = await field.evaluate((el) => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return -1;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.startContainer)) return -2;
      const measure = document.createRange();
      measure.selectNodeContents(el);
      measure.setEnd(range.startContainer, range.startOffset);
      return measure.cloneContents().textContent?.length ?? -3;
    });
    const worldIndex = await field.evaluate(
      (el) => el.textContent?.indexOf("World") ?? -1
    );
    expect(worldIndex, "World should follow the inserted snippet").toBeGreaterThan(
      0
    );
    expect(
      caretOffset,
      "caret should land at the end of the inserted snippet"
    ).toBe(worldIndex);

    // Confetti must actually paint pixels on its canvas.
    const confettiPainted = await testPage.evaluate(() => {
      const canvas = document.querySelector(
        "canvas[style*='314159']"
      ) as HTMLCanvasElement | null;
      if (!canvas) return -1;
      const ctx = canvas.getContext("2d");
      if (!ctx) return -2;
      const { width, height } = canvas;
      const image = ctx.getImageData(0, 0, width, height).data;
      let painted = 0;
      for (let i = 3; i < image.length; i += 4) {
        if (image[i] > 0) painted++;
      }
      return painted;
    });
    expect(
      confettiPainted,
      "confetti canvas should contain painted pixels after insertion"
    ).toBeGreaterThan(0);
  });

  test("inserting at the end of existing text leaves caret at the very end", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const field = testPage.locator('[data-testid="contenteditable-field"]');
    const preview = testPage.locator("#clipio-snippet-preview-host");

    await field.click();
    await testPage.keyboard.type("Hello ", { delay: 30 });

    // "Hello /h" — "/" follows a word boundary at the very end of the text.
    await testPage.keyboard.type("/", { delay: 30 });
    await testPage.keyboard.type("h", { delay: 30 });
    await expect(preview).toBeVisible();

    await testPage.keyboard.press("Enter");
    await testPage.waitForTimeout(350);

    // The snippet was inserted after "Hello" and the caret is at the very end
    // of the field (no trailing content remains).
    const text = (await field.innerText()).trim();
    expect(text).toContain("Hello");
    expect(text).toContain("Hello, World!");

    const caretOffset = await field.evaluate((el) => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return -1;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.startContainer)) return -2;
      const measure = document.createRange();
      measure.selectNodeContents(el);
      measure.setEnd(range.startContainer, range.startOffset);
      return measure.cloneContents().textContent?.length ?? -3;
    });
    const totalLength = await field.evaluate(
      (el) => el.textContent?.length ?? -1
    );
    expect(caretOffset, "caret should sit at the very end of the field").toBe(
      totalLength
    );
  });

  test("manual shortcut inserts snippet at caret with caret at its end", async ({
    testPage,
    storageHelper,
  }) => {
    await setupTestPage(testPage, storageHelper, [helloSnippet()]);

    const field = testPage.locator('[data-testid="contenteditable-field"]');
    const preview = testPage.locator("#clipio-snippet-preview-host");

    await field.click();
    await testPage.keyboard.type("hello", { delay: 30 }); // no "/" prefix

    await testPage.keyboard.press("Control+Shift+Space");
    await expect(preview).toBeVisible();

    // Select the (only) snippet.
    await testPage.keyboard.press("Enter");
    await testPage.waitForTimeout(350);

    // The snippet was inserted right after the existing text.
    const text = (await field.innerText()).trim();
    expect(text).toContain("hello");
    expect(text).toContain("Hello, World!");

    // Caret at the very end of the field.
    const caretOffset = await field.evaluate((el) => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return -1;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.startContainer)) return -2;
      const measure = document.createRange();
      measure.selectNodeContents(el);
      measure.setEnd(range.startContainer, range.startOffset);
      return measure.cloneContents().textContent?.length ?? -3;
    });
    const totalLength = await field.evaluate(
      (el) => el.textContent?.length ?? -1
    );
    expect(caretOffset, "caret should sit at the very end of the field").toBe(
      totalLength
    );
  });
});

async function setupTestPage(
  testPage: import("@playwright/test").Page,
  storageHelper: StorageHelper,
  snippets: import("../src/types/index.js").Snippet[]
) {
  await storageHelper.seedSnippets(snippets);
  await testPage.reload();
  await testPage.waitForLoadState("domcontentloaded");
  await testPage.waitForTimeout(600);
}