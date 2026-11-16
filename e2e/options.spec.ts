/**
 * Phase 4: Options Page Tests (10 tests)
 *
 * Validates the options page: sidebar navigation, storage stats,
 * import/export, theme toggling, confetti setting, feedback form.
 *
 * Test strategy:
 * - Use optionsPage fixture to navigate to options.html
 * - Test file uploads with page.setInputFiles()
 * - Intercept downloads with page.waitForEvent('download')
 * - Verify theme changes via page.evaluate()
 * - Intercept Sentry network requests with page.route()
 */

import path from "path";
import fs from "fs";
import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, type StorageHelper } from "./fixtures.js";
import { makeSnippets } from "./helpers/snippets.js";
import { readSyncSnippets } from "./helpers/storage.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForOptionsReady(page: import("@playwright/test").Page) {
  await page.waitForSelector("nav, aside, [role='navigation'], button, input", {
    timeout: 10_000,
  });
  // A short settle so React has committed its first paint before a test does a
  // one-shot read. This is a genuine "let the UI finish rendering" pause, not a
  // stand-in for a condition: every test that waits for *data* to arrive polls
  // for that data instead.
  await page.waitForTimeout(300);
}

async function seedSnippets(
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
    await ext.storage.local.set({
      cachedSnippets: snips,
      storageMode: "sync",
    });
  }, snippets);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Options Page", () => {
  test("loads with grouped sidebar navigation sections", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);

    // The sidebar renders a navigation landmark with section buttons.
    //
    // Selected by testid, not by its accessible name: the aria-label is a
    // translated string (`options.a11y.optionsNav`) and an e2e selector built on
    // it only resolves while the browser is running English.
    const nav = optionsPage.getByTestId("options-nav");
    await expect(nav).toBeVisible();

    // All seven sections of the redesigned taxonomy are reachable.
    for (const id of [
      "library",
      "expansion",
      "blocked-sites",
      "appearance",
      "storage",
      "diagnostics",
      "about",
    ]) {
      await expect(optionsPage.getByTestId(`options-nav-${id}`)).toBeVisible();
    }

    // Behavior: selecting a section marks it current (aria-current="page")
    // and clears the previously active section.
    const libraryNav = optionsPage.getByTestId("options-nav-library");
    const expansionNav = optionsPage.getByTestId("options-nav-expansion");
    await expect(libraryNav).toHaveAttribute("aria-current", "page");
    await expansionNav.click();
    await expect(expansionNav).toHaveAttribute("aria-current", "page");
    await expect(libraryNav).not.toHaveAttribute("aria-current", "page");
  });

  test("deep-links to a sub-route inside a section", async ({
    context,
    extensionId,
  }) => {
    // `/about/feedback` is what `background.ts` has always meant by
    // `options.html#feedback`. That hash was never a section id, so the old
    // hash validator rejected it and the user landed on Library: the link
    // worked and arrived somewhere else.
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/options.html#/about/feedback`
    );
    await waitForOptionsReady(page);

    // The feedback form is open, so its dialog role is present — not merely a
    // page that did not 404.
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.close();
  });

  test("deep-links to the import panel inside Library", async ({
    context,
    extensionId,
  }) => {
    // Reached from the popup's empty state, which has always linked
    // `#import-export`.
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/options.html#/library/import`
    );
    await waitForOptionsReady(page);

    // The Library section renders, and its import card is the focused element —
    // the route adds an address and a destination, not a second copy of the card.
    await expect(page.getByTestId("import-open")).toBeVisible();
    await expect(page.locator("#import-export-panel")).toBeFocused();
    await page.close();
  });

  test("shows a not-found page for an unknown hash instead of landing on Library", async ({
    context,
    extensionId,
  }) => {
    // The behaviour change most likely to surprise an old bookmark. Previously
    // an unrecognised hash fell back to Library, so a stale link looked exactly
    // like a working one.
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/options.html#/not-a-section`
    );
    await waitForOptionsReady(page);

    await expect(page.getByTestId("options-not-found")).toBeVisible();
    await page.close();
  });

  test("rewrites the legacy #feedback hash to its route", async ({
    context,
    extensionId,
  }) => {
    // The bookmark must keep working *and* the address bar must end up showing
    // the canonical route, or the back button and any copied link disagree with
    // what the user can see.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html#feedback`);
    await waitForOptionsReady(page);

    await expect(page.getByRole("dialog")).toBeVisible();
    expect(new URL(page.url()).hash).toBe("#/about/feedback");
    await page.close();
  });

  test("searching a rendered option label finds the setting that offers it", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);

    // "OpenDyslexic" is one of the three options rendered inside the interface
    // font select on the Appearance section. Search used to score the i18n *key*
    // name rather than the copy on screen, so this query returned nothing and
    // the user had no route to a setting whose control they could see.
    //
    // The query is typed as data; the assertion is on a testid, so changing the
    // copy does not break this test and changing the search ranking does.
    await optionsPage.getByTestId("options-search").fill("opendyslexic");

    const hit = optionsPage.getByTestId("option-setting-font-family");
    await expect(hit).toBeVisible();

    // The result renders the setting's live control, not just a link to the
    // section — that is the whole point of indexing rows rather than sections.
    await expect(hit.getByTestId("setting-font-family-select")).toBeVisible();
  });

  test("searching a word from a setting description finds it", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);

    // Descriptions were never indexed at all before.
    await optionsPage.getByTestId("options-search").fill("filterable");
    await expect(
      optionsPage.getByTestId("option-setting-preview-enabled")
    ).toBeVisible();
  });

  test("shows a no-results message rather than every setting for a bad query", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);

    // The regression this guards: a query that matches nothing must not be
    // mistaken for an empty query, which renders the full registry.
    await optionsPage.getByTestId("options-search").fill("zzzzqqq");
    await expect(
      optionsPage.getByTestId("options-search-empty-page")
    ).toBeVisible();
    await expect(
      optionsPage.getByTestId("option-setting-font-family")
    ).toHaveCount(0);
  });

  test("every advertised import format renders a decoded brand mark", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);

    // The format chips render each mark with alt="" because the adjacent text
    // already names the format. That is right for a screen reader and it makes
    // a broken image completely invisible: no alt text to surface, no layout
    // shift, and the axe scan below has nothing to object to. Two of these
    // marks are bundled from src/assets/brands/ rather than served from public/,
    // so this is the only check that the bundler actually resolved them.
    const formats = optionsPage.getByTestId("import-formats");
    await expect(formats).toBeVisible();

    const marks = formats.locator("img");
    await expect(marks).toHaveCount(3);

    // naturalWidth is 0 for an image that failed to decode, whatever the src
    // said — including a data URL whose payload is corrupt, which a `src`
    // assertion alone would pass. The exact sizes are also a tripwire: the two
    // bundled marks are 48px while Clipio's own icon is 128px, so a chip that
    // silently picked up the wrong asset fails here instead of rendering a
    // plausible-looking square.
    const decoded = await marks.evaluateAll((imgs) =>
      imgs.map((img) => ({
        width: (img as HTMLImageElement).naturalWidth,
        height: (img as HTMLImageElement).naturalHeight,
      }))
    );
    expect(decoded).toEqual([
      { width: 128, height: 128 }, // Clipio   — public/icon/128.png
      { width: 48, height: 48 }, //   TextBlaze — src/assets/brands/
      { width: 48, height: 48 }, //   PowerText — src/assets/brands/
    ]);
  });

  test("storage backend select persists a real mode switch", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);
    await optionsPage.getByTestId("options-nav-storage").click();

    const readStoredMode = () =>
      optionsPage.evaluate(async () => {
        const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
        const result = await ext.storage.local.get("storageMode");
        return (result.storageMode as "sync" | "local") ?? "sync";
      });

    const select = optionsPage.getByTestId("card-storage-mode-select");
    await expect(select).toBeVisible({ timeout: 5_000 });

    // Drive a real switch both directions and assert storage follows. The
    // select is the control now; the old two-button + inline-confirm pair is
    // replaced by a dialog in the danger zone (Phase 4).
    const initial = await readStoredMode();
    const target = initial === "sync" ? "local" : "sync";

    await select.click();
    await optionsPage
      .getByRole("option", { name: new RegExp(target, "i") })
      .click();
    await expect
      .poll(readStoredMode, { message: "storageMode never persisted" })
      .toBe(target);

    // Restore, proving the row tracks both directions.
    await select.click();
    await optionsPage
      .getByRole("option", { name: new RegExp(initial, "i") })
      .click();
    await expect
      .poll(readStoredMode, { message: "storageMode never restored" })
      .toBe(initial);
  });

  test("options page has no critical accessibility violations", async ({
    optionsPage,
  }) => {
    // @axe-core/playwright v4 exposes the AxeBuilder class — the old
    // injectAxe/checkA11y free functions do not exist.
    //
    // Scans EVERY section, not just the default one. A single scan missed a
    // 4.39:1 keycap on the Expansion section's shortcut recorder that the
    // library page never rendered.
    await optionsPage.setViewportSize({ width: 1280, height: 820 });

    const sections = [
      "library",
      "images",
      "expansion",
      "blocked-sites",
      "appearance",
      "storage",
      "diagnostics",
      "about",
    ];

    const base = optionsPage.url().split("#")[0];
    const findings: Record<string, string[]> = {};

    for (const section of sections) {
      await optionsPage.goto(`${base}#${section}`);
      await optionsPage.waitForSelector('[data-testid="options-search"]', {
        timeout: 15_000,
      });
      // Let each section's async panels settle so controls are present to scan.
      await optionsPage.waitForTimeout(600);

      const results = await new AxeBuilder({ page: optionsPage })
        .include("body")
        .analyze();
      await test.info().attach(`axe-${section}`, {
        body: JSON.stringify(results, null, 2),
        contentType: "application/json",
      });

      const serious = results.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious"
      );
      if (serious.length > 0) {
        findings[section] = serious.map(
          (v) =>
            `${v.id} (${v.impact}) x${v.nodes.length} — ${v.nodes[0]?.target?.join(" ")}`
        );
      }
    }

    expect(findings).toEqual({});
  });
});
