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
type Rgb = { r: number; g: number; b: number; a: number };

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

/**
 * Sample computed colours from the live DOM. Canvas converts any CSS colour
 * syntax (including oklch) to sRGB, and walking ancestors composites the
 * translucent `bg-muted/50` layers the sidebar uses. No assertion here trusts
 * a hard-coded colour that might be stale in the stylesheet.
 */
async function sampleColours(
  page: Page,
  selectors: Record<string, string>
): Promise<Record<string, Rgb>> {
  return page.evaluate((pairs) => {
    const toRgba = (
      color: string
    ): { r: number; g: number; b: number; a: number } => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };

    const effectiveBackground = (node: Element | null): Rgb => {
      if (!node) return { r: 255, g: 255, b: 255, a: 1 };
      const colour = toRgba(getComputedStyle(node).backgroundColor);
      const under = effectiveBackground(node.parentElement);
      if (colour.a === 0) return under;
      return {
        r: colour.r * colour.a + under.r * (1 - colour.a),
        g: colour.g * colour.a + under.g * (1 - colour.a),
        b: colour.b * colour.a + under.b * (1 - colour.a),
        a: 1,
      };
    };

    const result: Record<string, Rgb> = {};
    for (const [key, selector] of Object.entries(pairs)) {
      const element = document.querySelector(selector)!;
      result[key] = effectiveBackground(element);
      result[`${key}Text`] = toRgba(getComputedStyle(element).color);
    }
    return result;
  }, selectors);
}

function luminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
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

  test("selection is one stronger neutral with readable text in both themes", async ({
    popupPage,
  }) => {
    const snippets = [
      makeSnippet({ label: "First", shortcut: "/first" }),
      makeSnippet({ label: "Selected", shortcut: "/selected" }),
    ];
    await seedAndReload(popupPage, snippets);
    const rows = popupPage.getByTestId("snippet-list-item");
    await rows.nth(1).click();
    const selected = rows.nth(1);
    const other = rows.nth(0);

    await expect(selected).toHaveAttribute("aria-selected", "true");
    await expect(selected.locator("h3")).toHaveCSS("font-weight", "600");
    await expect(other.locator("h3")).toHaveCSS("font-weight", "500");
    const selectedAlpha = await selected.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    );
    expect(selectedAlpha).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    // No accent bar or ring marker: the focus ring classes are the only ring.
    await expect(selected.locator("[class*='border-l']")).toHaveCount(0);

    for (const theme of ["light", "dark"] as const) {
      await popupPage.evaluate(async (mode) => {
        const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
        await ext.storage.local.set({ themeMode: mode });
      }, theme);
      await popupPage.reload();
      await popupPage.waitForSelector('[data-testid="snippet-list"]');
      await expect(popupPage.locator("html")).toHaveClass(
        theme === "dark" ? /dark/ : /^(?!.*\bdark\b).*$/
      );
      await popupPage.getByTestId("snippet-list-item").nth(1).click();
      const selectedRow = popupPage.getByTestId("snippet-list-item").nth(1);
      const restingFill = () =>
        selectedRow.evaluate(
          (element) => getComputedStyle(element).backgroundColor
        );
      const resting = await restingFill();
      // Hovering the selected row used to swap in the ghost variant's hover
      // fill, briefly making selection weaker than hover in both themes.
      await selectedRow.hover();
      await expect.poll(restingFill).toBe(resting);
      // Hover the other row so "stronger than hover" is measured, not assumed.
      await popupPage.getByTestId("snippet-list-item").nth(0).hover();
      await expect.poll(restingFill).toBe(resting);

      const colours = await sampleColours(popupPage, {
        selected: "[data-testid='snippet-list-item'][aria-selected='true']",
        hovered: "[data-testid='snippet-list-item'][aria-selected='false']",
        sidebar: "[data-testid='snippet-library']",
      });
      const textOnFill = contrastRatio(colours.selectedText, colours.selected);
      const fillOnSidebar = contrastRatio(colours.selected, colours.sidebar);

      // Light: lower luminance is darker; dark: higher luminance is lighter,
      // but in both themes the fill must be further from the page background
      // than the translucent hover fill is.
      expect(
        Math.abs(luminance(colours.selected) - luminance(colours.sidebar)),
        `${theme} selection is not stronger than hover`
      ).toBeGreaterThan(
        Math.abs(luminance(colours.hovered) - luminance(colours.sidebar))
      );
      expect(
        textOnFill,
        `${theme} selected text on its fill`
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        fillOnSidebar,
        `${theme} selected fill against the sidebar background`
      ).toBeGreaterThan(1);
      console.log(
        `${theme}: text/fill ${textOnFill.toFixed(2)}:1, fill/sidebar ${fillOnSidebar.toFixed(2)}:1`
      );
    }
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
    await expect(header).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(name).toHaveCSS("font-size", "18px");
    await expect(name).toHaveCSS("font-weight", "600");
    await expect(shortcut).toHaveCSS("font-size", "12px");
    await expect(shortcut).toHaveCSS("border-bottom-width", "1px");
    await expect(shortcut).toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");

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
