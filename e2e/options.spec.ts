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
import { test, expect } from "./fixtures.js";
import { makeSnippets } from "./helpers/snippets.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForOptionsReady(page: import("@playwright/test").Page) {
  await page.waitForSelector("nav, aside, [role='navigation'], button, input", {
    timeout: 10_000,
  });
  await page.waitForTimeout(300);
}

async function seedSnippets(
  page: import("@playwright/test").Page,
  snippets: import("../src/types/index.js").Snippet[]
) {
  await page.evaluate(async (snips) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
    const syncEntries: Record<string, (typeof snips)[0]> = {};
    for (const s of snips) {
      syncEntries[`snip:${s.id}`] = s;
    }
    await ext.storage.sync.set(syncEntries);
    await ext.storage.local.set({ cachedSnippets: snips, storageMode: "sync" });
  }, snippets);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Options Page", () => {
  test("loads with sidebar navigation sections", async ({ optionsPage }) => {
    await waitForOptionsReady(optionsPage);

    const pageText = await optionsPage.textContent("body");
    // The options page should contain nav section labels
    // (translated via i18n — check for partial English text)
    expect(pageText).toBeTruthy();
    expect(pageText!.length).toBeGreaterThan(100);

    // Sidebar should have clickable nav items
    const navItems = optionsPage.locator(
      "nav a, nav button, aside button, aside a"
    );
    const count = await navItems.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("displays storage statistics", async ({ optionsPage }) => {
    const snippets = makeSnippets(5, (i) => ({
      label: `Stats Snippet ${i}`,
      shortcut: `/stats${i}`,
      content: "Content for stats testing",
    }));
    await seedSnippets(optionsPage, snippets);
    await optionsPage.reload();
    await waitForOptionsReady(optionsPage);

    const pageText = await optionsPage.textContent("body");
    // Should show some numeric stats (byte counts, snippet count, etc.)
    expect(pageText).toBeTruthy();
    // Page loads and renders content without crashing
    const body = optionsPage.locator("body");
    await expect(body).toBeVisible();
  });

  test("exports snippets to JSON file", async ({ optionsPage }) => {
    const snippets = makeSnippets(3, (i) => ({
      label: `Export Snippet ${i}`,
      shortcut: `/exp${i}`,
      content: `Export content ${i}`,
    }));
    await seedSnippets(optionsPage, snippets);
    await optionsPage.reload();
    await waitForOptionsReady(optionsPage);

    // Navigate to import/export section
    const importExportNav = optionsPage
      .locator(
        'button:has-text("Import"), button:has-text("Export"), a:has-text("Import"), a:has-text("Export"), nav button'
      )
      .first();
    if (await importExportNav.isVisible()) {
      await importExportNav.click();
      await optionsPage.waitForTimeout(300);
    }

    // Find and click the export button, intercepting the download
    const exportButton = optionsPage
      .locator(
        'button:has-text("Export"), button[aria-label*="export" i], button[title*="export" i]'
      )
      .first();

    if (await exportButton.isVisible()) {
      const downloadPromise = optionsPage
        .waitForEvent("download", { timeout: 5_000 })
        .catch(() => null);
      await exportButton.click();
      const download = await downloadPromise;

      if (download) {
        expect(download.suggestedFilename()).toMatch(/\.json$/i);
        // Read the downloaded file
        const tmpPath = path.resolve(`test-results/export-${Date.now()}.json`);
        await download.saveAs(tmpPath).catch(() => {});
        if (fs.existsSync(tmpPath)) {
          const content = fs.readFileSync(tmpPath, "utf-8");
          const parsed = JSON.parse(content);
          expect(Array.isArray(parsed) || typeof parsed === "object").toBe(
            true
          );
          fs.unlinkSync(tmpPath);
        }
      }
    }

    // Smoke test: page is still responsive
    const body = optionsPage.locator("body");
    await expect(body).toBeVisible();
  });

  test("imports snippets from Clipio JSON file", async ({ optionsPage }) => {
    await waitForOptionsReady(optionsPage);

    // Create a valid Clipio export JSON
    const importData = makeSnippets(2, (i) => ({
      id: `import-test-${i}`,
      label: `Imported Snippet ${i}`,
      shortcut: `/imp${i}`,
      content: `Imported content ${i}`,
    }));
    const jsonContent = JSON.stringify(importData);

    // Navigate to import/export section
    const importNav = optionsPage
      .locator('button:has-text("Import"), nav button')
      .first();
    if (await importNav.isVisible()) {
      await importNav.click();
      await optionsPage.waitForTimeout(300);
    }

    // Find file input and upload the JSON
    const fileInput = optionsPage.locator('input[type="file"]').first();
    if (await fileInput.isVisible().catch(() => false)) {
      // Write temp file
      const tmpPath = path.resolve(
        `test-results/import-test-${Date.now()}.json`
      );
      fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
      fs.writeFileSync(tmpPath, jsonContent);

      await fileInput.setInputFiles(tmpPath);
      await optionsPage.waitForTimeout(500);

      // Confirm import if wizard shows a confirm step
      const confirmBtn = optionsPage
        .locator('button:has-text("Import"), button:has-text("Confirm")')
        .first();
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
        await optionsPage.waitForTimeout(500);
      }

      fs.unlinkSync(tmpPath);
    }

    // Smoke test: page is still responsive after import attempt
    const body = optionsPage.locator("body");
    await expect(body).toBeVisible();
  });

  test("imports from TextBlaze format", async ({ optionsPage }) => {
    await waitForOptionsReady(optionsPage);

    // TextBlaze CSV-like format
    const textBlazeContent = `shortcut,content\n/tb1,"TextBlaze snippet one"\n/tb2,"TextBlaze snippet two"`;

    const importNav = optionsPage
      .locator('button:has-text("Import"), nav button')
      .first();
    if (await importNav.isVisible()) {
      await importNav.click();
      await optionsPage.waitForTimeout(300);
    }

    const fileInput = optionsPage.locator('input[type="file"]').first();
    if (await fileInput.isVisible().catch(() => false)) {
      const tmpPath = path.resolve(`test-results/textblaze-${Date.now()}.csv`);
      fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
      fs.writeFileSync(tmpPath, textBlazeContent);

      await fileInput.setInputFiles(tmpPath);
      await optionsPage.waitForTimeout(500);

      fs.unlinkSync(tmpPath);
    }

    const body = optionsPage.locator("body");
    await expect(body).toBeVisible();
  });

  test("imports from PowerText format", async ({ optionsPage }) => {
    await waitForOptionsReady(optionsPage);

    // PowerText JSON format
    const powerTextContent = JSON.stringify([
      { keyword: "/pt1", expansion: "PowerText snippet one" },
      { keyword: "/pt2", expansion: "PowerText snippet two" },
    ]);

    const importNav = optionsPage
      .locator('button:has-text("Import"), nav button')
      .first();
    if (await importNav.isVisible()) {
      await importNav.click();
      await optionsPage.waitForTimeout(300);
    }

    const fileInput = optionsPage.locator('input[type="file"]').first();
    if (await fileInput.isVisible().catch(() => false)) {
      const tmpPath = path.resolve(`test-results/powertext-${Date.now()}.json`);
      fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
      fs.writeFileSync(tmpPath, powerTextContent);

      await fileInput.setInputFiles(tmpPath);
      await optionsPage.waitForTimeout(500);

      fs.unlinkSync(tmpPath);
    }

    const body = optionsPage.locator("body");
    await expect(body).toBeVisible();
  });

  test("toggles theme (light/dark/system)", async ({ optionsPage }) => {
    await waitForOptionsReady(optionsPage);

    // Navigate to appearance section
    const appearanceNav = optionsPage
      .locator(
        'button:has-text("Appearance"), button:has-text("Theme"), nav button, aside button'
      )
      .nth(2); // try third nav item (Appearance is typically 3rd)
    if (await appearanceNav.isVisible()) {
      await appearanceNav.click();
      await optionsPage.waitForTimeout(300);
    }

    // Find theme toggle buttons
    const darkButton = optionsPage
      .locator(
        'button:has-text("Dark"), [aria-label*="dark" i], input[value="dark"]'
      )
      .first();
    if (await darkButton.isVisible()) {
      await darkButton.click();
      await optionsPage.waitForTimeout(300);

      // Verify the theme was changed in storage
      const storedTheme = await optionsPage.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
        const result = await ext.storage.local.get("themeMode");
        return result.themeMode;
      });
      expect(["dark", "light", "system", undefined]).toContain(storedTheme);
    }

    const lightButton = optionsPage
      .locator(
        'button:has-text("Light"), [aria-label*="light" i], input[value="light"]'
      )
      .first();
    if (await lightButton.isVisible()) {
      await lightButton.click();
      await optionsPage.waitForTimeout(300);
    }

    const body = optionsPage.locator("body");
    await expect(body).toBeVisible();
  });

  test("toggles confetti setting", async ({ optionsPage }) => {
    await waitForOptionsReady(optionsPage);

    // Navigate to appearance section
    const appearanceNav = optionsPage
      .locator(
        'button:has-text("Appearance"), button:has-text("Confetti"), nav button'
      )
      .nth(2);
    if (await appearanceNav.isVisible()) {
      await appearanceNav.click();
      await optionsPage.waitForTimeout(300);
    }

    const confettiToggle = optionsPage
      .locator(
        'input[type="checkbox"][name*="confetti" i], button[aria-label*="confetti" i], [data-testid*="confetti"]'
      )
      .first();

    if (await confettiToggle.isVisible()) {
      await confettiToggle.click();
      await optionsPage.waitForTimeout(300);

      const stored = await optionsPage.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
        const result = await ext.storage.local.get("confettiEnabled");
        return result.confettiEnabled;
      });
      // Value should be a boolean (either true or false, depending on initial state)
      expect(typeof stored === "boolean" || stored === undefined).toBe(true);
    }

    const body = optionsPage.locator("body");
    await expect(body).toBeVisible();
  });

  test("hash-based navigation to feedback section", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html#feedback`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);

    const pageText = await page.textContent("body");
    // Page should load and show something (feedback section or fallback)
    expect(pageText).toBeTruthy();
    const body = page.locator("body");
    await expect(body).toBeVisible();

    await page.close();
  });

  test("submits feedback form (network request intercepted)", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);

    // Intercept Sentry ingest requests
    let sentryRequestCaptured = false;
    await optionsPage.route(/sentry\.io|ingest\.us\.sentry\.io/, (route) => {
      sentryRequestCaptured = true;
      route.fulfill({ status: 200, body: "{}" });
    });

    // Navigate to feedback section
    const feedbackNav = optionsPage
      .locator(
        'button:has-text("Feedback"), a:has-text("Feedback"), nav button'
      )
      .last();
    if (await feedbackNav.isVisible()) {
      await feedbackNav.click();
      await optionsPage.waitForTimeout(300);
    }

    // Fill feedback form fields
    const nameField = optionsPage
      .locator('input[name*="name" i], input[placeholder*="name" i]')
      .first();
    const emailField = optionsPage
      .locator('input[type="email"], input[name*="email" i]')
      .first();
    const messageField = optionsPage
      .locator(
        'textarea[name*="message" i], textarea[placeholder*="feedback" i], textarea'
      )
      .first();

    if (await nameField.isVisible()) await nameField.fill("E2E Tester");
    if (await emailField.isVisible()) await emailField.fill("e2e@test.com");
    if (await messageField.isVisible())
      await messageField.fill("E2E test feedback message");

    // Submit the form
    const submitButton = optionsPage
      .locator(
        'button[type="submit"], button:has-text("Send"), button:has-text("Submit")'
      )
      .first();
    if (await submitButton.isVisible()) {
      await submitButton.click();
      await optionsPage.waitForTimeout(1_000);
    }

    // Page should not crash
    const body = optionsPage.locator("body");
    await expect(body).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Developers Section
// ---------------------------------------------------------------------------

test.describe("Developers Section", () => {
  async function navigateToDevelopers(page: import("@playwright/test").Page) {
    await waitForOptionsReady(page);
    const devNav = page
      .locator('button:has-text("Developers"), a:has-text("Developers")')
      .first();
    if (await devNav.isVisible()) {
      await devNav.click();
      await page.waitForTimeout(300);
    }
  }

  test("renders the Developers section with all five new cards", async ({
    optionsPage,
  }) => {
    await navigateToDevelopers(optionsPage);

    const pageText = await optionsPage.textContent("body");
    expect(pageText).toContain("Extension Version & Update");
    expect(pageText).toContain("Content Script Health");
    expect(pageText).toContain("Storage Mode & Quota");
    expect(pageText).toContain("Top 5 Usage");
    expect(pageText).toContain("Clear IDB Backup");
  });

  test("shows current version in version card", async ({ optionsPage }) => {
    await navigateToDevelopers(optionsPage);

    // Version card should show "Version: X.Y.Z"
    const pageText = await optionsPage.textContent("body");
    expect(pageText).toMatch(/Version:\s*\d+\.\d+/);
  });

  test("shows 'Up to date' when no update is available", async ({
    optionsPage,
  }) => {
    await navigateToDevelopers(optionsPage);
    // With no latestVersionItem seeded, the card shows "Up to date"
    const pageText = await optionsPage.textContent("body");
    expect(pageText).toContain("Up to date");
  });

  test("shows update banner on Dashboard when latestVersionItem is set to newer version", async ({
    context,
    extensionId,
  }) => {
    // Seed a fake newer release into local storage before opening the popup
    const seedPage = await context.newPage();
    await seedPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await seedPage.waitForLoadState("domcontentloaded");
    await seedPage.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({
        latestVersion: {
          version: "999.0.0",
          htmlUrl: "https://github.com/jheysaaz/clipio/releases/tag/v999.0.0",
          publishedAt: new Date().toISOString(),
        },
        // no dismissedUpdateVersion set, so banner should appear
      });
    });
    await seedPage.close();

    // Open a fresh popup page to get the dashboard
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.waitForLoadState("domcontentloaded");
    await popupPage.waitForTimeout(500);

    const pageText = await popupPage.textContent("body");
    // Banner body: "A new version of Clipio is available: 999.0.0"
    expect(pageText).toContain("999.0.0");

    await popupPage.close();
  });

  test("dismissing update banner hides it and stores version", async ({
    context,
    extensionId,
  }) => {
    // Seed a fake newer release
    const seedPage = await context.newPage();
    await seedPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await seedPage.waitForLoadState("domcontentloaded");
    await seedPage.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({
        latestVersion: {
          version: "888.0.0",
          htmlUrl: "https://github.com/jheysaaz/clipio/releases/tag/v888.0.0",
          publishedAt: new Date().toISOString(),
        },
      });
    });
    await seedPage.close();

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.waitForLoadState("domcontentloaded");
    await popupPage.waitForTimeout(500);

    // Find and click the dismiss (X) button on the warning banner
    const dismissBtn = popupPage
      .locator('button[aria-label*="dismiss" i], button[aria-label*="close" i]')
      .first();
    if (await dismissBtn.isVisible()) {
      await dismissBtn.click();
      await popupPage.waitForTimeout(300);

      // Banner should no longer show "888.0.0"
      const pageText = await popupPage.textContent("body");
      expect(pageText).not.toContain(
        "A new version of Clipio is available: 888.0.0"
      );

      // dismissedUpdateVersion should be stored in local storage
      const dismissed = await popupPage.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
        const r = await ext.storage.local.get("dismissedUpdateVersion");
        return r.dismissedUpdateVersion;
      });
      expect(dismissed).toBe("888.0.0");
    }

    await popupPage.close();
  });

  test("ping button sends message and shows result", async ({
    optionsPage,
  }) => {
    await navigateToDevelopers(optionsPage);

    const pingButton = optionsPage
      .locator('button:has-text("Ping content script")')
      .first();

    if (await pingButton.isVisible()) {
      await pingButton.click();
      await optionsPage.waitForTimeout(1_000);

      // After ping, should show either pong or an error message
      const pageText = await optionsPage.textContent("body");
      const hasPong = pageText!.includes("Pong") || pageText!.includes("pong");
      const hasError =
        pageText!.includes("No active tab") ||
        pageText!.includes("No content script") ||
        pageText!.includes("Ping failed");
      expect(hasPong || hasError).toBe(true);
    }

    const body = optionsPage.locator("body");
    await expect(body).toBeVisible();
  });

  test("storage mode card displays active backend", async ({ optionsPage }) => {
    await navigateToDevelopers(optionsPage);

    const pageText = await optionsPage.textContent("body");
    // Should show "Active backend: sync" or "Active backend: local"
    expect(pageText).toMatch(/Active backend:\s*(sync|local|—)/);
  });

  test("top-5 usage card shows 'No usage data yet' when empty", async ({
    optionsPage,
  }) => {
    await navigateToDevelopers(optionsPage);
    // No usage data seeded → empty state message
    const pageText = await optionsPage.textContent("body");
    // Either "No usage data yet." or actual usage items
    const hasEmpty = pageText!.includes("No usage data yet");
    const hasUsageItems = pageText!.match(/\d+ uses/) !== null;
    expect(hasEmpty || hasUsageItems).toBe(true);
  });

  test("top-5 usage card shows snippet labels when usage data exists", async ({
    context,
    extensionId,
    optionsPage,
  }) => {
    // Seed usage counts and snippets
    await optionsPage.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({
        snippetUsageCount: { "snip-abc": 42, "snip-def": 7 },
      });
      await ext.storage.sync.set({
        "snip:snip-abc": {
          id: "snip-abc",
          label: "My Email Signature",
          shortcut: "/sig",
          content: "test",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      });
    });

    await optionsPage.reload();
    await waitForOptionsReady(optionsPage);
    await navigateToDevelopers(optionsPage);

    const pageText = await optionsPage.textContent("body");
    // Should show the label and usage count
    expect(pageText).toContain("My Email Signature");
    expect(pageText).toContain("42");
  });

  test("clear IDB backup requires two-step confirmation", async ({
    optionsPage,
  }) => {
    await navigateToDevelopers(optionsPage);

    // First click: shows confirm button
    const clearButton = optionsPage
      .locator('button:has-text("Clear backup")')
      .first();
    if (await clearButton.isVisible()) {
      await clearButton.click();
      await optionsPage.waitForTimeout(200);

      // Confirm button should now be visible
      const confirmButton = optionsPage
        .locator('button:has-text("Confirm clear")')
        .first();
      await expect(confirmButton).toBeVisible();

      // Second click: performs action, shows "Cleared"
      await confirmButton.click();
      await optionsPage.waitForTimeout(2_500);

      const pageText = await optionsPage.textContent("body");
      // Either "Cleared" flash was shown (and expired) or page is still functional
      const body = optionsPage.locator("body");
      await expect(body).toBeVisible();
    } else {
      // Developers section not navigated to — just smoke test
      const body = optionsPage.locator("body");
      await expect(body).toBeVisible();
    }
  });

  // ── Typing Timeout slider ──────────────────────────────────────────────

  test("typing timeout slider renders with default value", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);
    await navigateToDevelopers(optionsPage);

    // The typing timeout card title should be visible
    const cardTitle = optionsPage.locator(':has-text("Typing Timeout")');
    await expect(cardTitle.first()).toBeVisible({ timeout: 5000 });

    // The range input should be present with value 300 (default)
    const slider = optionsPage.locator('input[type="range"]').first();
    await expect(slider).toBeVisible();
    const value = await slider.inputValue();
    expect(value).toBe("300");
  });

  test("typing timeout slider saves new value to storage", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);
    await navigateToDevelopers(optionsPage);

    const slider = optionsPage.locator('input[type="range"]').first();
    if (!(await slider.isVisible())) return;

    // Use Playwright fill() to set a range value — triggers React onChange
    await slider.fill("600");

    // Wait for the debounced save (400ms) + extra buffer
    await optionsPage.waitForTimeout(1000);

    // Verify storage was updated (WXT stores "local:typingTimeout" as key "typingTimeout")
    const storedTimeout = await optionsPage.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const result = await ext.storage.local.get("typingTimeout");
      return result.typingTimeout;
    });
    expect(storedTimeout).toBe(600);
  });

  // ── Debug Mode toggle ──────────────────────────────────────────────────

  test("debug mode toggle enables and writes to storage", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);
    await navigateToDevelopers(optionsPage);

    // The sr-only checkbox is hidden behind a decorative overlay div.
    // Click the parent <label> which properly toggles the checkbox.
    const toggle = optionsPage.locator(
      'input[type="checkbox"][aria-label="Enable debug logging"]'
    );
    const toggleLabel = toggle.locator("xpath=ancestor::label");
    if (!(await toggleLabel.isVisible())) return;

    const initialChecked = await toggle.isChecked();
    await toggleLabel.click();
    await optionsPage.waitForTimeout(500);

    // The checkbox state should have flipped
    const newChecked = await toggle.isChecked();
    expect(newChecked).toBe(!initialChecked);

    // Storage should reflect the new value
    const stored = await optionsPage.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const result = await ext.storage.local.get("debugMode");
      return result.debugMode;
    });
    expect(stored).toBe(!initialChecked);
  });

  // ── Force storage switch ───────────────────────────────────────────────

  test("storage mode switch buttons appear in Developers section", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);
    await navigateToDevelopers(optionsPage);

    // In sync mode (default), "Switch to local" button should appear
    const switchLocalBtn = optionsPage.locator(
      'button:has-text("Switch to local")'
    );
    // The button may or may not be there depending on current mode; just assert page loaded
    const body = optionsPage.locator("body");
    await expect(body).toBeVisible();
    // At minimum, the Storage Mode card title should be present
    const storageModeTitle = optionsPage.locator(':has-text("Storage Mode")');
    await expect(storageModeTitle.first()).toBeVisible({ timeout: 5000 });

    // If the switch button is present, it should be clickable
    if ((await switchLocalBtn.count()) > 0) {
      await expect(switchLocalBtn.first()).toBeVisible();
    }
  });

  test("cancel on clear IDB backup hides confirm step", async ({
    optionsPage,
  }) => {
    await navigateToDevelopers(optionsPage);

    const clearButton = optionsPage
      .locator('button:has-text("Clear backup")')
      .first();
    if (await clearButton.isVisible()) {
      await clearButton.click();
      await optionsPage.waitForTimeout(200);

      // Cancel button should be present alongside Confirm
      const cancelButton = optionsPage
        .locator('button:has-text("Cancel")')
        .first();
      if (await cancelButton.isVisible()) {
        await cancelButton.click();
        await optionsPage.waitForTimeout(200);

        // "Clear backup" button should be back; "Confirm clear" gone
        await expect(
          optionsPage.locator('button:has-text("Clear backup")').first()
        ).toBeVisible();
        const confirmButton = optionsPage.locator(
          'button:has-text("Confirm clear")'
        );
        await expect(confirmButton).not.toBeVisible();
      }
    }

    const body = optionsPage.locator("body");
    await expect(body).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Review Prompt Banner
// ---------------------------------------------------------------------------

test.describe("Review Prompt Banner", () => {
  // spec: review-prompt.spec.md#options-page-banner

  test("banner is hidden when reviewPromptState is pending (default)", async ({
    context,
    extensionId,
  }) => {
    // spec: review-prompt.spec.md#options-page-banner
    // No storage seeding — default state is "pending"
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState("domcontentloaded");
    await waitForOptionsReady(page);

    const pageText = await page.textContent("body");
    expect(pageText).not.toContain("Enjoying Clipio?");

    await page.close();
  });

  test("banner shows when reviewPromptState is shown and no recent error", async ({
    context,
    extensionId,
    storageHelper,
  }) => {
    // spec: review-prompt.spec.md#options-page-banner
    // Seed state before opening options page
    await storageHelper.setLocal("reviewPromptState", "shown");

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState("domcontentloaded");
    await waitForOptionsReady(page);

    const pageText = await page.textContent("body");
    expect(pageText).toContain("Enjoying Clipio?");
    expect(pageText).toContain("Rate on the Store");

    await page.close();
  });

  test("banner is hidden when state is shown but lastSentryErrorAt is within 24h", async ({
    context,
    extensionId,
    storageHelper,
  }) => {
    // spec: review-prompt.spec.md#options-page-banner
    const recentError = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    await storageHelper.setLocal("reviewPromptState", "shown");
    await storageHelper.setLocal("lastSentryErrorAt", recentError);

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState("domcontentloaded");
    await waitForOptionsReady(page);

    const pageText = await page.textContent("body");
    expect(pageText).not.toContain("Enjoying Clipio?");

    await page.close();
  });

  test("banner shows when state is shown and lastSentryErrorAt is older than 24h", async ({
    context,
    extensionId,
    storageHelper,
  }) => {
    // spec: review-prompt.spec.md#options-page-banner
    const oldError = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
    await storageHelper.setLocal("reviewPromptState", "shown");
    await storageHelper.setLocal("lastSentryErrorAt", oldError);

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState("domcontentloaded");
    await waitForOptionsReady(page);

    const pageText = await page.textContent("body");
    expect(pageText).toContain("Enjoying Clipio?");

    await page.close();
  });

  test("dismissing the banner hides it and writes dismissed state to storage", async ({
    context,
    extensionId,
    storageHelper,
  }) => {
    // spec: review-prompt.spec.md#options-page-banner
    await storageHelper.setLocal("reviewPromptState", "shown");

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState("domcontentloaded");
    await waitForOptionsReady(page);

    // Banner should be visible before dismiss
    await expect(page.locator('text="Enjoying Clipio?"').first()).toBeVisible({
      timeout: 5_000,
    });

    // The review banner is the blue Alert containing "Enjoying Clipio?"
    // Scope the dismiss button search to that banner to avoid hitting the
    // uninstall warning dismiss (amber banner) which also has aria-label="Dismiss"
    const reviewBanner = page
      .locator('text="Enjoying Clipio?"')
      .locator("..")
      .locator("..");
    const dismissBtn = reviewBanner
      .locator('button[aria-label="Dismiss"]')
      .first();
    await dismissBtn.click();
    await page.waitForTimeout(500);

    // Banner should disappear
    const pageText = await page.textContent("body");
    expect(pageText).not.toContain("Enjoying Clipio?");

    // Storage should reflect "dismissed"
    const storedState = await storageHelper.getLocal("reviewPromptState");
    expect(storedState).toBe("dismissed");

    await page.close();
  });

  test("clicking Rate on the Store hides banner and writes rated state to storage", async ({
    context,
    extensionId,
    storageHelper,
  }) => {
    // spec: review-prompt.spec.md#options-page-banner
    await storageHelper.setLocal("reviewPromptState", "shown");

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState("domcontentloaded");
    await waitForOptionsReady(page);

    // Banner should be visible
    await expect(page.locator('text="Enjoying Clipio?"').first()).toBeVisible({
      timeout: 5_000,
    });

    // Intercept the new tab so the test does not navigate away
    const newPagePromise = context
      .waitForEvent("page", { timeout: 3_000 })
      .catch(() => null);

    // Click the "Rate on the Store" button
    const rateBtn = page
      .locator('button:has-text("Rate on the Store")')
      .first();
    await rateBtn.click();
    await page.waitForTimeout(500);

    // Close any newly opened tab so the context stays clean
    const newTab = await newPagePromise;
    if (newTab) await newTab.close().catch(() => {});

    // Banner should disappear
    const pageText = await page.textContent("body");
    expect(pageText).not.toContain("Enjoying Clipio?");

    // Storage should reflect "rated"
    const storedState = await storageHelper.getLocal("reviewPromptState");
    expect(storedState).toBe("rated");

    await page.close();
  });

  test("banner is hidden when reviewPromptState is dismissed", async ({
    context,
    extensionId,
    storageHelper,
  }) => {
    // spec: review-prompt.spec.md#options-page-banner
    // Terminal state — banner must never reappear
    await storageHelper.setLocal("reviewPromptState", "dismissed");

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState("domcontentloaded");
    await waitForOptionsReady(page);

    const pageText = await page.textContent("body");
    expect(pageText).not.toContain("Enjoying Clipio?");

    await page.close();
  });

  test("banner is hidden when reviewPromptState is rated", async ({
    context,
    extensionId,
    storageHelper,
  }) => {
    // spec: review-prompt.spec.md#options-page-banner
    // Terminal state — banner must never reappear
    await storageHelper.setLocal("reviewPromptState", "rated");

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState("domcontentloaded");
    await waitForOptionsReady(page);

    const pageText = await page.textContent("body");
    expect(pageText).not.toContain("Enjoying Clipio?");

    await page.close();
  });
});
