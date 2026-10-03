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
