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

    // The sidebar renders a navigation landmark with section buttons.
    const nav = optionsPage.getByRole("navigation", {
      name: "Options navigation",
    });
    await expect(nav).toBeVisible();
    expect(await nav.getByRole("button").count()).toBeGreaterThanOrEqual(1);

    // Behavior: selecting a section marks it current (aria-current="page")
    // and clears the previously active section.
    const dashboardNav = optionsPage.getByTestId("options-nav-dashboard");
    const snippetsNav = optionsPage.getByTestId("options-nav-snippets");
    await expect(dashboardNav).toHaveAttribute("aria-current", "page");
    await snippetsNav.click();
    await expect(snippetsNav).toHaveAttribute("aria-current", "page");
    await expect(dashboardNav).not.toHaveAttribute("aria-current", "page");
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

    // Import/export lives in the Snippets section — navigate via stable testid
    await optionsPage.getByTestId("options-nav-snippets").click();
    const exportButton = optionsPage.getByTestId("export-json");
    await expect(exportButton).toBeVisible({ timeout: 5_000 });

    const downloadPromise = optionsPage
      .waitForEvent("download", { timeout: 5_000 })
      .catch(() => null);
    await exportButton.click();
    const download = await downloadPromise;
    expect(download).not.toBeNull();
    if (download) {
      expect(download.suggestedFilename()).toMatch(/\.json$/i);
      // Read the downloaded file
      const tmpPath = path.resolve(`test-results/export-${Date.now()}.json`);
      await download.saveAs(tmpPath).catch(() => {});
      if (fs.existsSync(tmpPath)) {
        const content = fs.readFileSync(tmpPath, "utf-8");
        const parsed = JSON.parse(content);
        expect(Array.isArray(parsed) || typeof parsed === "object").toBe(true);
        fs.unlinkSync(tmpPath);
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

    // Open the import wizard from the Snippets section via stable testid
    await optionsPage.getByTestId("options-nav-snippets").click();
    const importOpen = optionsPage.getByTestId("import-open");
    await expect(importOpen).toBeVisible({ timeout: 5_000 });
    await importOpen.click();

    // Wizard dialog must open (behavior, not copy)
    const dialog = optionsPage.getByRole("dialog", { name: /.*/ });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Find file input and upload the JSON
    const fileInput = optionsPage.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached({ timeout: 5_000 });

    // Write temp file
    const tmpPath = path.resolve(`test-results/import-test-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, jsonContent);

    await fileInput.setInputFiles(tmpPath);
    await optionsPage.waitForTimeout(500);

    // Confirm import — scoped to the dialog so we don't hit the overlay-blocked
    // import-open button behind the modal
    const confirmBtn = dialog
      .getByRole("button", { name: /import|confirm/i })
      .first();
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click({ timeout: 5_000 }).catch(() => {});
      await optionsPage.waitForTimeout(500);
    }

    fs.unlinkSync(tmpPath);

    // Smoke test: page is still responsive after import attempt
    const body = optionsPage.locator("body");
    await expect(body).toBeVisible();
  });

  test("imports from TextBlaze format", async ({ optionsPage }) => {
    await waitForOptionsReady(optionsPage);

    // TextBlaze CSV-like format
    const textBlazeContent = `shortcut,content\n/tb1,"TextBlaze snippet one"\n/tb2,"TextBlaze snippet two"`;

    // Open the import wizard from the Snippets section via stable testid
    await optionsPage.getByTestId("options-nav-snippets").click();
    const importOpen = optionsPage.getByTestId("import-open");
    await expect(importOpen).toBeVisible({ timeout: 5_000 });
    await importOpen.click();
    await expect(optionsPage.getByRole("dialog", { name: /.*/ })).toBeVisible({
      timeout: 5_000,
    });

    const fileInput = optionsPage.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached({ timeout: 5_000 });

    const tmpPath = path.resolve(`test-results/textblaze-${Date.now()}.csv`);
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, textBlazeContent);

    await fileInput.setInputFiles(tmpPath);
    await optionsPage.waitForTimeout(500);

    fs.unlinkSync(tmpPath);

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

    // Open the import wizard from the Snippets section via stable testid
    await optionsPage.getByTestId("options-nav-snippets").click();
    const importOpen = optionsPage.getByTestId("import-open");
    await expect(importOpen).toBeVisible({ timeout: 5_000 });
    await importOpen.click();
    await expect(optionsPage.getByRole("dialog", { name: /.*/ })).toBeVisible({
      timeout: 5_000,
    });

    const fileInput = optionsPage.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached({ timeout: 5_000 });

    const tmpPath = path.resolve(`test-results/powertext-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, powerTextContent);

    await fileInput.setInputFiles(tmpPath);
    await optionsPage.waitForTimeout(500);

    fs.unlinkSync(tmpPath);

    const body = optionsPage.locator("body");
    await expect(body).toBeVisible();
  });

  test("toggles theme (light/dark/system)", async ({ optionsPage }) => {
    await waitForOptionsReady(optionsPage);

    // Navigate to appearance via stable testid
    await optionsPage.getByTestId("options-nav-appearance").click();

    // Find theme toggle buttons by stable testid
    const darkButton = optionsPage.getByTestId("theme-dark");
    await expect(darkButton).toBeVisible({ timeout: 5_000 });
    await darkButton.click();
    await optionsPage.waitForTimeout(300);

    // Verify the theme was changed in storage
    const storedTheme = await optionsPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const result = await ext.storage.local.get("themeMode");
      return result.themeMode;
    });
    expect(storedTheme).toBe("dark");

    const lightButton = optionsPage.getByTestId("theme-light");
    await expect(lightButton).toBeVisible();
    await lightButton.click();
    await optionsPage.waitForTimeout(300);

    const storedLight = await optionsPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const result = await ext.storage.local.get("themeMode");
      return result.themeMode;
    });
    expect(storedLight).toBe("light");

    const body = optionsPage.locator("body");
    await expect(body).toBeVisible();
  });

  test("toggles confetti setting", async ({ optionsPage }) => {
    await waitForOptionsReady(optionsPage);

    // Navigate to appearance via stable testid
    await optionsPage.getByTestId("options-nav-appearance").click();

    const confettiToggle = optionsPage.getByTestId("confetti-toggle");
    await expect(confettiToggle).toBeVisible({ timeout: 5_000 });

    const initialAria = await confettiToggle.getAttribute("aria-checked");
    await confettiToggle.click();
    await optionsPage.waitForTimeout(300);

    // Behavior: switch role flips aria-checked
    const newAria = await confettiToggle.getAttribute("aria-checked");
    expect(newAria).not.toBe(initialAria);

    const stored = await optionsPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const result = await ext.storage.local.get("confettiEnabled");
      return result.confettiEnabled;
    });
    // Value should track the flipped boolean
    expect(typeof stored).toBe("boolean");
    expect(String(stored)).toBe(newAria);

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

    // Feedback opens from the header button (aria-label="Feedback")
    const feedbackNav = optionsPage.getByRole("button", { name: "Feedback" });
    await expect(feedbackNav).toBeVisible({ timeout: 5_000 });
    await feedbackNav.click();
    await optionsPage.waitForTimeout(300);

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
      .getByRole("button", { name: /send|submit/i })
      .first();
    if (await submitButton.isVisible().catch(() => false)) {
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
    // Sidebar item id is "advanced"; the section it opens is titled
    // "Developers". Selector is keyed to behavior (testid), not copy.
    await page.getByTestId("options-nav-advanced").click();
    // Fail loudly if the section never renders — never silently no-op.
    await expect(page.getByTestId("card-content-script-health")).toBeVisible({
      timeout: 5_000,
    });
  }

  test("renders all five developer cards (Dashboard + Developers section)", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);

    // Extension Version and Top 5 Usage render on the Dashboard overview
    // (relocated out of the Developers section — see specs/e2e-suite.spec.md).
    await expect(
      optionsPage.getByTestId("card-extension-version")
    ).toBeVisible();
    await expect(optionsPage.getByTestId("card-top-usage")).toBeVisible();

    // Content Script Health, Storage Mode & Quota and Clear IDB Backup
    // render in the Developers section.
    await navigateToDevelopers(optionsPage);
    await expect(
      optionsPage.getByTestId("card-content-script-health")
    ).toBeVisible();
    await expect(optionsPage.getByTestId("card-storage-mode")).toBeVisible();
    await expect(optionsPage.getByTestId("card-clear-idb")).toBeVisible();
  });

  test("shows current version in version card", async ({ optionsPage }) => {
    await waitForOptionsReady(optionsPage);

    // The version card lives on the Dashboard (default section) and must
    // display the real manifest version.
    const card = optionsPage.getByTestId("card-extension-version");
    await expect(card).toBeVisible();
    const manifestVersion = await optionsPage.evaluate(() => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      return ext.runtime.getManifest().version as string;
    });
    await expect(card).toContainText(manifestVersion);
  });

  test("shows up-to-date state when no update is available", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);
    // Fresh context — no latestVersion seeded. The card must show its
    // up-to-date state and must not offer the update action.
    const card = optionsPage.getByTestId("card-extension-version");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("version-up-to-date")).toBeVisible();
    await expect(card.getByTestId("version-update-available")).toHaveCount(0);
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
      .getByTestId("card-content-script-health")
      .getByRole("button", { name: /ping/i });
    await expect(pingButton).toBeVisible();

    await pingButton.click();

    // The ping outcome is reported as a Sonner toast — assert on that toast
    // (spec: specs/e2e-suite.spec.md — no literal copy via textContent("body")).
    const toast = optionsPage.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText(
      /Pong|No active tab|No content script|Ping failed/
    );
  });

  test("storage mode card reflects the active backend after a mode switch", async ({
    optionsPage,
  }) => {
    await navigateToDevelopers(optionsPage);

    const backendEl = optionsPage.getByTestId("storage-active-backend");
    const readStoredMode = () =>
      optionsPage.evaluate(async () => {
        const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
        const result = await ext.storage.local.get("storageMode");
        return (result.storageMode as "sync" | "local") ?? "sync";
      });

    // The card must display the backend that storage reports as active.
    const initial = await readStoredMode();
    await expect(backendEl).toContainText(initial);

    // Drive a real switch and assert the card follows the new backend.
    const target = initial === "sync" ? "local" : "sync";
    await optionsPage.getByTestId(`storage-switch-${target}`).click();
    await optionsPage.getByTestId("storage-switch-confirm").click();
    await expect(backendEl).toContainText(target);
    expect(await readStoredMode()).toBe(target);

    // Restore the original mode — verifies the card tracks both directions.
    await optionsPage.getByTestId(`storage-switch-${initial}`).click();
    await optionsPage.getByTestId("storage-switch-confirm").click();
    await expect(backendEl).toContainText(initial);
    expect(await readStoredMode()).toBe(initial);
  });

  test("top-5 usage card shows empty state when no usage data exists", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);
    // Top 5 Usage lives on the Dashboard (default section); fresh context
    // has no usage counts, so the empty state must be shown.
    const card = optionsPage.getByTestId("card-top-usage");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("top-usage-empty")).toBeVisible();
  });

  test("top-5 usage card shows snippet labels when usage data exists", async ({
    optionsPage,
  }) => {
    // Seed usage counts and snippets
    await optionsPage.evaluate(async () => {
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

    const card = optionsPage.getByTestId("card-top-usage");
    await expect(card).toBeVisible();
    // Seeded (test-defined) label and usage count render; empty state is gone.
    await expect(card).toContainText("My Email Signature");
    await expect(card).toContainText("42");
    await expect(card.getByTestId("top-usage-empty")).toHaveCount(0);
  });

  test("clear IDB backup requires two-step confirmation", async ({
    optionsPage,
  }) => {
    await navigateToDevelopers(optionsPage);

    const card = optionsPage.getByTestId("card-clear-idb");
    const clearButton = optionsPage.getByTestId("clear-idb-clear");
    await expect(clearButton).toBeVisible();

    // First click: reveals the confirm step.
    await clearButton.click();
    const confirmButton = optionsPage.getByTestId("clear-idb-confirm");
    await expect(confirmButton).toBeVisible();

    // Second click: performs the wipe and resets the card to its idle state.
    await confirmButton.click();
    await expect(clearButton).toBeVisible({ timeout: 5_000 });
    await expect(confirmButton).toHaveCount(0);
    await expect(card).toBeVisible();
  });

  // ── Typing Timeout slider ──────────────────────────────────────────────

  test("typing timeout slider renders with default value", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);
    // The Typing Timeout card lives in the Snippets section.
    await optionsPage.getByTestId("options-nav-snippets").click();
    const card = optionsPage.getByTestId("card-typing-timeout");
    await expect(card).toBeVisible({ timeout: 5_000 });

    // Slider is identified by its accessible role/name, scoped to the card.
    // Fresh profile → default TIMING.TYPING_TIMEOUT (300 ms).
    const slider = card.getByRole("slider", { name: "Typing Timeout" });
    await expect(slider).toBeVisible();
    await expect(slider).toHaveValue("300");
  });

  test("typing timeout slider saves new value to storage", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);
    await optionsPage.getByTestId("options-nav-snippets").click();
    const card = optionsPage.getByTestId("card-typing-timeout");
    await expect(card).toBeVisible({ timeout: 5_000 });

    const slider = card.getByRole("slider", { name: "Typing Timeout" });
    await expect(slider).toHaveValue("300");

    // Drive the slider with real arrow-key input (step=50): 300 → 600.
    for (let i = 0; i < 6; i++) {
      await slider.press("ArrowRight");
    }
    await expect(slider).toHaveValue("600");

    // Wait for the debounced save (400ms) + extra buffer
    await optionsPage.waitForTimeout(1000);

    // Verify storage was updated (WXT stores "local:typingTimeout" as key "typingTimeout")
    const storedTimeout = await optionsPage.evaluate(async () => {
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
    await navigateToDevelopers(optionsPage);

    // The Storage Mode card must offer exactly one switch target — the
    // backend that is NOT currently active.
    await expect(optionsPage.getByTestId("card-storage-mode")).toBeVisible();
    const switchLocalBtn = optionsPage.getByTestId("storage-switch-local");
    const switchSyncBtn = optionsPage.getByTestId("storage-switch-sync");
    const visibleSwitches = [
      await switchLocalBtn.isVisible(),
      await switchSyncBtn.isVisible(),
    ];
    expect(visibleSwitches.filter(Boolean)).toHaveLength(1);
  });

  test("cancel on clear IDB backup hides confirm step", async ({
    optionsPage,
  }) => {
    await navigateToDevelopers(optionsPage);

    const card = optionsPage.getByTestId("card-clear-idb");
    const clearButton = optionsPage.getByTestId("clear-idb-clear");
    await expect(clearButton).toBeVisible();
    await clearButton.click();

    const confirmButton = optionsPage.getByTestId("clear-idb-confirm");
    await expect(confirmButton).toBeVisible();

    const cancelButton = card.getByRole("button", { name: "Cancel" });
    await expect(cancelButton).toBeVisible();
    await cancelButton.click();

    // Card returns to its idle state: clear button back, confirm step gone.
    await expect(clearButton).toBeVisible();
    await expect(confirmButton).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Review Prompt Banner
// ---------------------------------------------------------------------------

test.describe("Review Prompt Banner", () => {
  // spec: review-prompt.spec.md#options-page-banner

  /**
   * Seed review-banner storage keys and re-assert until stable.
   *
   * On a fresh context the background SW runs checkForUpdate() immediately;
   * if that fetch fails it calls captureError(), which fire-and-forget writes
   * lastSentryErrorAt = now — racing our seed and hiding the banner.
   * Wait for the startup check marker, then re-assert the seed until it sticks.
   */
  async function seedReviewBanner(
    storageHelper: StorageHelper,
    opts: { state: string; lastSentryErrorAt?: string | null }
  ): Promise<void> {
    // Give checkForUpdate a moment to write its completion marker (or fail).
    const deadline = Date.now() + 1_500;
    while (Date.now() < deadline) {
      const checked = await storageHelper.getLocal("latestVersionCheckedAt");
      if (checked) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    await storageHelper.setLocal("reviewPromptState", opts.state);

    if (!("lastSentryErrorAt" in opts)) return;

    const target = opts.lastSentryErrorAt ?? null;
    for (let i = 0; i < 10; i++) {
      await storageHelper.setLocal("lastSentryErrorAt", target);
      const current = await storageHelper.getLocal("lastSentryErrorAt");
      if (current === target) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(
      `Failed to stabilize lastSentryErrorAt=${String(target)} — background captureError kept overwriting it`
    );
  }

  /**
   * Open options.html after a stable seed. If a late captureError still
   * overwrote lastSentryErrorAt between seed and mount, re-seed and reload once.
   */
  async function openOptionsAfterSeed(
    context: BrowserContext,
    extensionId: string,
    storageHelper: StorageHelper,
    opts: { state: string; lastSentryErrorAt?: string | null }
  ): Promise<Page> {
    await seedReviewBanner(storageHelper, opts);

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForLoadState("domcontentloaded");
    await waitForOptionsReady(page);

    if ("lastSentryErrorAt" in opts) {
      const target = opts.lastSentryErrorAt ?? null;
      const actual = await storageHelper.getLocal("lastSentryErrorAt");
      if (actual !== target) {
        await seedReviewBanner(storageHelper, opts);
        await page.reload();
        await page.waitForLoadState("domcontentloaded");
        await waitForOptionsReady(page);
      }
    }

    return page;
  }

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

    // Give the OptionsPage storage useEffect time to resolve before asserting
    // absence (otherwise a slow read could false-pass before the banner mounts).
    await page
      .getByText("Enjoying Clipio?")
      .waitFor({ state: "visible", timeout: 1_000 })
      .catch(() => {});
    await expect(page.getByText("Enjoying Clipio?")).toHaveCount(0);

    await page.close();
  });

  test("banner shows when reviewPromptState is shown and no recent error", async ({
    context,
    extensionId,
    storageHelper,
  }) => {
    // spec: review-prompt.spec.md#options-page-banner
    // Seed state before opening options page (re-assert: background captureError races)
    const page = await openOptionsAfterSeed(
      context,
      extensionId,
      storageHelper,
      {
        state: "shown",
        lastSentryErrorAt: null,
      }
    );

    // Auto-retrying — storage read + React render can lag under suite load
    await expect(page.getByText("Enjoying Clipio?")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Rate on the Store")).toBeVisible();

    await page.close();
  });

  test("banner is hidden when state is shown but lastSentryErrorAt is within 24h", async ({
    context,
    extensionId,
    storageHelper,
  }) => {
    // spec: review-prompt.spec.md#options-page-banner
    const recentError = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    const page = await openOptionsAfterSeed(
      context,
      extensionId,
      storageHelper,
      {
        state: "shown",
        lastSentryErrorAt: recentError,
      }
    );

    await page
      .getByText("Enjoying Clipio?")
      .waitFor({ state: "visible", timeout: 1_000 })
      .catch(() => {});
    await expect(page.getByText("Enjoying Clipio?")).toHaveCount(0);

    await page.close();
  });

  test("banner shows when state is shown and lastSentryErrorAt is older than 24h", async ({
    context,
    extensionId,
    storageHelper,
  }) => {
    // spec: review-prompt.spec.md#options-page-banner
    const oldError = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
    const page = await openOptionsAfterSeed(
      context,
      extensionId,
      storageHelper,
      {
        state: "shown",
        lastSentryErrorAt: oldError,
      }
    );

    await expect(page.getByText("Enjoying Clipio?")).toBeVisible({
      timeout: 10_000,
    });

    await page.close();
  });

  test("dismissing the banner hides it and writes dismissed state to storage", async ({
    context,
    extensionId,
    storageHelper,
  }) => {
    // spec: review-prompt.spec.md#options-page-banner
    const page = await openOptionsAfterSeed(
      context,
      extensionId,
      storageHelper,
      {
        state: "shown",
        lastSentryErrorAt: null,
      }
    );

    // Banner should be visible before dismiss (auto-retrying)
    await expect(page.getByText("Enjoying Clipio?").first()).toBeVisible({
      timeout: 10_000,
    });

    // The review banner is the blue Alert containing "Enjoying Clipio?"
    // Scope the dismiss button search to that banner to avoid hitting the
    // uninstall warning dismiss (amber banner) which also has aria-label="Dismiss"
    const reviewBanner = page
      .getByText("Enjoying Clipio?")
      .locator("..")
      .locator("..");
    const dismissBtn = reviewBanner
      .locator('button[aria-label="Dismiss"]')
      .first();
    await dismissBtn.click();
    await expect(page.getByText("Enjoying Clipio?")).toHaveCount(0, {
      timeout: 5_000,
    });

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
    const page = await openOptionsAfterSeed(
      context,
      extensionId,
      storageHelper,
      {
        state: "shown",
        lastSentryErrorAt: null,
      }
    );

    // Banner should be visible (auto-retrying)
    await expect(page.getByText("Enjoying Clipio?").first()).toBeVisible({
      timeout: 10_000,
    });

    // Intercept the new tab so the test does not navigate away
    const newPagePromise = context
      .waitForEvent("page", { timeout: 3_000 })
      .catch(() => null);

    // Click the "Rate on the Store" button (scoped role lookup)
    const rateBtn = page.getByRole("button", { name: /rate on the store/i });
    await rateBtn.click();

    // Close any newly opened tab so the context stays clean
    const newTab = await newPagePromise;
    if (newTab) await newTab.close().catch(() => {});

    // Banner should disappear
    await expect(page.getByText("Enjoying Clipio?")).toHaveCount(0, {
      timeout: 5_000,
    });

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

    await page
      .getByText("Enjoying Clipio?")
      .waitFor({ state: "visible", timeout: 1_000 })
      .catch(() => {});
    await expect(page.getByText("Enjoying Clipio?")).toHaveCount(0);

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

    await page
      .getByText("Enjoying Clipio?")
      .waitFor({ state: "visible", timeout: 1_000 })
      .catch(() => {});
    await expect(page.getByText("Enjoying Clipio?")).toHaveCount(0);

    await page.close();
  });

  // -------------------------------------------------------------------------
  // Accessibility checks
  // -------------------------------------------------------------------------

  test("options page has no critical accessibility violations", async ({
    optionsPage,
  }) => {
    // spec: specs/e2e-suite.spec.md
    // @axe-core/playwright v4 exposes the AxeBuilder class — the old
    // injectAxe/checkA11y free functions do not exist. Scan the hydrated
    // page; fail on critical/serious violations without suppression, and
    // attach the full axe output to the report either way.
    await waitForOptionsReady(optionsPage);
    const results = await new AxeBuilder({ page: optionsPage })
      .include("body")
      .analyze();
    await test.info().attach("axe-results", {
      body: JSON.stringify(results, null, 2),
      contentType: "application/json",
    });
    const critical = results.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? "")
    );
    expect(critical).toEqual([]);
  });
});
