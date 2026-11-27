/**
 * Contracts for the relative-size refactor.
 *
 * These assertions read computed geometry, not class names: a class can stay
 * correct while the stylesheet behind it changes. Screenshots for this work are
 * captured separately into /tmp so they never enter the repository.
 */

import { expect, test } from "./fixtures.js";
import { makeSnippet } from "./helpers/snippets.js";

type Page = import("@playwright/test").Page;
type Snippet = import("../src/types/index.js").Snippet;
async function seedAndReload(page: Page, snippets: Snippet[]) {
  await page.evaluate(async (items) => {
    const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
    const entries: Record<string, unknown> = {};
    for (const item of items) entries[`snip:${item.id}`] = item;
    await ext.storage.sync.set(entries);
    await ext.storage.local.set({
      cachedSnippets: items,
      storageMode: "sync",
      lastViewedSnippetId: null,
    });
  }, snippets);
  await page.reload();
  await page.waitForSelector('[data-testid="snippet-list"]');
}

test.describe("relative sizing and document editor", () => {
  test("popup geometry follows the root font and stops at Chrome's cap", async ({
    popupPage,
  }) => {
    await seedAndReload(popupPage, [makeSnippet({ label: "Geometry" })]);
    const body = popupPage.locator("body.popup-shell");
    const geometry = () =>
      body.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        rootFont: getComputedStyle(document.documentElement).fontSize,
        overflowY: getComputedStyle(element).overflowY,
      }));

    // 42.5rem x 28.75rem at the default 16px root is the original 680x460.
    await expect.poll(geometry).toEqual({
      width: 680,
      height: 460,
      rootFont: "16px",
      overflowY: "hidden",
    });

    // A 20px root would ask for 850x575. Width hits Chrome's 800px cap;
    // height stays 575, under the 600px cap.
    await popupPage.evaluate(() => {
      document.documentElement.style.fontSize = "20px";
    });
    await expect.poll(geometry).toEqual({
      width: 800,
      height: 575,
      rootFont: "20px",
      overflowY: "hidden",
    });
  });

  test("the editor reads as a document and scrolls inside the capped box", async ({
    popupPage,
  }) => {
    const longContent = Array.from(
      { length: 80 },
      (_, index) =>
        `Line ${index}: a long enough paragraph to need its own row.`
    ).join("\n\n");
    await seedAndReload(popupPage, [
      makeSnippet({
        label:
          "A snippet with a deliberately long name that should stay inside the header",
        shortcut: "/a-very-long-shortcut-that-should-not-overflow-the-header",
        content: longContent,
      }),
    ]);
    await popupPage.getByTestId("snippet-list-item").click();

    const header = popupPage.getByTestId("snippet-header");
    const name = popupPage.getByTestId("snippet-label-input");
    const shortcut = popupPage.getByTestId("snippet-shortcut-input");
    const island = await header.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        blur: style.backdropFilter,
        shadow: style.boxShadow,
      };
    });
    // The island is translucent, painted glass. The ring is a box-shadow in
    // Tailwind, so the regression is a *change* on hover, not its presence.
    expect(island.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(island.blur).toContain("blur");
    await header.hover();
    await expect(header).toHaveCSS("box-shadow", island.shadow);
    await expect(name).toHaveCSS("font-size", "16px");
    await expect(name).toHaveCSS("font-weight", "500");
    await expect(shortcut).toHaveCSS("font-size", "12px");
    await expect(shortcut).toHaveCSS("border-bottom-width", "0px");
    await expect(shortcut).toHaveAttribute(
      "title",
      "Type this to expand the snippet."
    );

    // Long values truncate inside the header instead of being clipped by the
    // popup edge. An earlier version put the max-width on the input inside an
    // unconstrained wrapper, which pushed it 139px outside the 680px popup.
    const headerBox = await header.evaluate((element) => ({
      right: element.getBoundingClientRect().right,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(headerBox.scrollWidth).toBeLessThanOrEqual(headerBox.clientWidth);
    for (const field of [name, shortcut]) {
      const box = await field.boundingBox();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(headerBox.right);
    }

    // Tab order and the Enter shortcut are part of the document contract.
    await name.focus();
    await popupPage.keyboard.press("Tab");
    await expect(shortcut).toBeFocused();
    await popupPage.keyboard.press("Tab");
    await expect(
      popupPage.getByRole("textbox", { name: "Snippet content" })
    ).toBeFocused();
    await name.focus();
    await popupPage.keyboard.press("Enter");
    await expect(
      popupPage.getByRole("textbox", { name: "Snippet content" })
    ).toBeFocused();

    await popupPage.evaluate(() => {
      document.documentElement.style.fontSize = "20px";
    });
    const scrolling = await popupPage.evaluate(() => {
      const editor = document.querySelector(
        "[data-testid='snippet-content-editor'] [data-slate-editor]"
      ) as HTMLElement | null;
      return {
        body: {
          scroll: document.body.scrollHeight,
          client: document.body.clientHeight,
        },
        editor: editor
          ? { scroll: editor.scrollHeight, client: editor.clientHeight }
          : null,
      };
    });
    expect(scrolling.body.scroll).toBeLessThanOrEqual(scrolling.body.client);
    expect(scrolling.editor).not.toBeNull();
    expect(scrolling.editor!.scroll).toBeGreaterThan(scrolling.editor!.client);
  });
});
