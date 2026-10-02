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

  test("a hash deep link opens its section on a cold load", async ({
    context,
    extensionId,
  }) => {
    // The previous page ignored the hash entirely and always booted to the
    // dashboard, so `#appearance` silently showed the wrong section.
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/options.html#appearance`
    );
    await page.waitForSelector('[data-testid="options-search"]', {
      timeout: 15_000,
    });

    await expect(page.getByTestId("options-nav-appearance")).toHaveAttribute(
      "aria-current",
      "page"
    );
    // The Appearance section's own rows must be what rendered, proving the
    // hash selected the section rather than just highlighting the nav item.
    await expect(page.getByTestId("setting-theme")).toBeVisible();

    await page.close();
  });

  test("search filters settings and toggles one in place", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);

    // Typing filters the registry and renders each match as a live row, so a
    // preference can be changed without navigating to its section.
    await optionsPage.getByTestId("options-search").fill("confetti");
    const row = optionsPage.getByTestId("confetti-toggle");
    await expect(row).toBeVisible({ timeout: 5_000 });

    const toggle = optionsPage.getByTestId("confetti-toggle-switch");
    const initial = (await toggle.getAttribute("aria-checked")) === "true";
    await toggle.click();

    await expect
      .poll(() => toggle.getAttribute("aria-checked"), {
        message: "search-result switch never flipped",
      })
      .toBe(String(!initial));

    await expect
      .poll(
        () =>
          optionsPage.evaluate(async () => {
            const ext =
              (globalThis as any).chrome ?? (globalThis as any).browser;
            const r = await ext.storage.local.get("confettiEnabled");
            return String(r.confettiEnabled);
          }),
        { message: "confettiEnabled never matched the search-result switch" }
      )
      .toBe(String(!initial));
  });

  test("search reports no matches rather than listing everything", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);
    await optionsPage
      .getByTestId("options-search")
      .fill("zzzzqqq-no-such-setting");
    // Negative: an unmatched query must show the empty state, not fall back to
    // the full registry.
    await expect(
      optionsPage.getByTestId("options-search-empty-page")
    ).toBeVisible({ timeout: 5_000 });
    await expect(optionsPage.getByTestId("confetti-toggle")).toHaveCount(0);
  });

  test("records a keyboard shortcut from a real chord", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);
    await optionsPage.getByTestId("options-nav-expansion").click();

    const recorder = optionsPage.getByTestId(
      "setting-preview-shortcut-recorder"
    );
    await expect(recorder).toBeVisible({ timeout: 5_000 });

    // A bare letter with no modifier is refused, with feedback.
    await recorder.click();
    await optionsPage.keyboard.press("k");
    await expect(
      optionsPage.getByTestId("setting-preview-shortcut-recorder-error")
    ).toBeVisible();

    // A real chord is captured and persisted.
    await optionsPage.keyboard.press("Meta+Shift+K");
    await expect
      .poll(
        () =>
          optionsPage.evaluate(async () => {
            const ext =
              (globalThis as any).chrome ?? (globalThis as any).browser;
            const r = await ext.storage.local.get("snippetPreviewShortcut");
            return r.snippetPreviewShortcut as string;
          }),
        { message: "the captured chord was never persisted" }
      )
      .toBe("Mod+Shift+K");
  });

  test("the sidebar is resizable and persists its width", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);

    const sidebar = optionsPage.getByRole("complementary");
    const resizer = optionsPage.getByTestId("sidebar-resizer");
    await expect(resizer).toBeVisible();

    // Announced as a separator with a range, so the width is not pointer-only.
    await expect(resizer).toHaveAttribute("aria-valuenow", /\d+/);

    const initialWidth = (await sidebar.boundingBox())!.width;

    // The handle straddles the rail's right edge. Drag it right by 120px.
    const box = (await resizer.boundingBox())!;
    const startX = box.x + box.width / 2;
    await optionsPage.mouse.move(startX, box.y + box.height / 2);
    await optionsPage.mouse.down();
    await optionsPage.mouse.move(startX + 120, box.y + box.height / 2, {
      steps: 10,
    });
    await optionsPage.mouse.up();

    await expect
      .poll(async () => (await sidebar.boundingBox())!.width, {
        message: "sidebar width never changed after the drag",
      })
      .toBeGreaterThan(initialWidth);

    const afterDrag = (await sidebar.boundingBox())!.width;

    // Arrow keys resize too, so the width is not pointer-only.
    await resizer.focus();
    await resizer.press("ArrowLeft");
    await expect
      .poll(async () => (await sidebar.boundingBox())!.width, {
        message: "ArrowLeft did not narrow the sidebar",
      })
      .toBeLessThan(afterDrag);

    const afterArrow = (await sidebar.boundingBox())!.width;

    // It survives a reload.
    await optionsPage.reload();
    await waitForOptionsReady(optionsPage);
    await expect
      .poll(
        async () => {
          const b = await optionsPage.getByRole("complementary").boundingBox();
          return Math.abs(b!.width - afterArrow) < 2;
        },
        { message: "sidebar width did not survive a reload" }
      )
      .toBe(true);
  });

  test("About offers donate and a Chromium-only store review", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);
    await optionsPage.getByTestId("options-nav-about").click();

    // Donate is available everywhere.
    const donate = optionsPage.getByTestId("about-donate");
    await expect(donate).toBeVisible({ timeout: 5_000 });

    // The store review points at the Chrome Web Store, which does not exist on
    // Firefox. The suite runs on Chromium, so it must be present here.
    const review = optionsPage.getByTestId("about-review");
    await expect(review).toBeVisible({ timeout: 5_000 });

    // Both open a new tab rather than navigating the options page away.
    const newTab = optionsPage.context().waitForEvent("page", {
      timeout: 5_000,
    });
    await donate.click();
    expect((await newTab).url()).toContain("github.com/sponsors");
  });

  test("Images section does not repeat its own heading", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);
    await optionsPage.getByTestId("options-nav-images").click();

    // The page renders the section title from the registry; the media list must
    // not add a second "Images" heading directly beneath it.
    const headings = optionsPage.getByRole("heading", { name: "Images" });
    await expect(headings).toHaveCount(1, { timeout: 5_000 });
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

    // Library stats (snippet count, top usage) live in Library; the quota
    // meters live in Storage. Assert the rendered figures — the previous
    // version read `body` text and checked it was truthy, which passed with
    // the whole panel replaced by an early `return null`.
    await expect(optionsPage.getByTestId("card-top-usage")).toBeVisible();

    await optionsPage.getByTestId("options-nav-storage").click();
    const syncStat = optionsPage.getByTestId("stat-sync-kb");
    await expect(syncStat).toBeVisible({ timeout: 5_000 });
    // `<used> / <quota>` in KB or MB. Format-agnostic on purpose: the panel
    // drops a trailing `.0`, so `100 KB` and `0.5 KB` are both valid.
    await expect(syncStat).toHaveText(
      /^\d+(\.\d)? (KB|MB) \/ \d+(\.\d)? (KB|MB)$/
    );

    const localStat = optionsPage.getByTestId("stat-local-kb");
    await expect(localStat).toBeVisible();
    // `<estimate>` in KB or MB, optionally tilde-prefixed (an estimate).
    await expect(localStat).toHaveText(/^~?\d+(\.\d)? (KB|MB)$/);
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
    await optionsPage.getByTestId("options-nav-library").click();
    const exportButton = optionsPage.getByTestId("export-json");
    await expect(exportButton).toBeVisible({ timeout: 5_000 });

    // No `.catch(() => null)` and no `if (download)` / `existsSync` guard: both
    // silently skipped the entire content check, so a failed save produced a
    // green run. A missing download is a failure, not a branch.
    const downloadPromise = optionsPage.waitForEvent("download", {
      timeout: 10_000,
    });
    await exportButton.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.json$/i);

    const tmpPath = path.resolve(`test-results/export-${Date.now()}.json`);
    try {
      await download.saveAs(tmpPath);
      expect(fs.existsSync(tmpPath)).toBe(true);

      // Assert the export really contains the seeded snippets, not merely that
      // it parses as JSON — `Array.isArray(x) || typeof x === "object"` is
      // true for any `JSON.parse` result and so asserted nothing.
      const parsed = JSON.parse(fs.readFileSync(tmpPath, "utf-8")) as {
        snippets?: { shortcut?: string }[];
      };
      expect(Array.isArray(parsed.snippets)).toBe(true);
      expect(parsed.snippets?.map((snip) => snip.shortcut)).toEqual(
        expect.arrayContaining(["/exp0", "/exp1", "/exp2"])
      );
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
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
    await optionsPage.getByTestId("options-nav-library").click();
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

    // The temp file is cleaned up in a finally. Removing the vacuous guard also
    // removed the `unlinkSync` that used to follow it, so every run was leaving a
    // file behind in test-results/ — while the two sibling tests in this file
    // still cleaned up theirs.
    try {
      // Drive the wizard through and complete the import.
      //
      // This is what the `if (visible)` guard was hiding. The old selector
      // looked for a button named /import|confirm/i, but the wizard's footer
      // button on the first step is "Next" — so the selector matched nothing, the
      // guard was always false, and **the import was never performed**. The test
      // then asserted on whatever the page happened to show and passed.
      //
      // A previous revision of this comment claimed the footer button could not
      // be targeted by any selector, and left the import unverified on that
      // basis. That was wrong: `getByRole("button", { name: "Next" })` resolves
      // fine. The original failure was a stale assumption about the wizard's
      // labels, not a targeting problem.
      const wizard = optionsPage.locator('[role="dialog"]');

      // "Found 2 snippets" only appears once the upload has been parsed, so it
      // is the readiness signal — real information, not a sleep.
      await expect(wizard).toContainText(/Found \d+ snippets?/, {
        timeout: 10_000,
      });
      await expect(wizard).toContainText("Clipio");

      // Steps 2 (unsupported placeholders) and 3 (conflicts) are skipped by the
      // wizard itself when there are none, so from a clean export one click
      // reaches the final step.
      const nextBtn = wizard.getByRole("button", { name: "Next" });
      await expect(nextBtn).toBeEnabled();
      await nextBtn.click();

      const importBtn = wizard.getByRole("button", {
        name: /Import \d+ snippets?/,
      });
      await expect(importBtn).toBeEnabled();
      await importBtn.click();

      // The decisive assertion: the snippets reached storage. Reading the snip:
      // keys proves the import landed, rather than inferring it from the UI
      // having looked right.
      await expect
        .poll(
          async () => {
            const ids = (await readSyncSnippets(optionsPage)).map((s) => s.id);
            return (
              ids.includes("import-test-0") && ids.includes("import-test-1")
            );
          },
          {
            timeout: 10_000,
            message: "imported snippets never reached storage",
          }
        )
        .toBe(true);
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  });

  test("imports from TextBlaze format", async ({ optionsPage }) => {
    await waitForOptionsReady(optionsPage);

    // A real TextBlaze export: `{ version, folders: [{ name, snippets: [...] }] }`.
    //
    // The previous fixture was CSV text and the test then only asserted that
    // `body` was visible, so the wizard rejecting it with "Invalid JSON file"
    // passed anyway. Both the fixture and the assertion were wrong.
    const textBlazeContent = JSON.stringify({
      version: 1,
      folders: [
        {
          name: "Team",
          snippets: [
            { name: "TB One", shortcut: "/tb1", text: "TextBlaze snippet one" },
            { name: "TB Two", shortcut: "/tb2", text: "TextBlaze snippet two" },
          ],
        },
      ],
    });

    // Open the import wizard from the Snippets section via stable testid
    await optionsPage.getByTestId("options-nav-library").click();
    const importOpen = optionsPage.getByTestId("import-open");
    await expect(importOpen).toBeVisible({ timeout: 5_000 });
    await importOpen.click();
    await expect(optionsPage.getByRole("dialog", { name: /.*/ })).toBeVisible({
      timeout: 5_000,
    });

    const fileInput = optionsPage.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached({ timeout: 5_000 });

    const tmpPath = path.resolve(`test-results/textblaze-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, textBlazeContent);

    await fileInput.setInputFiles(tmpPath);

    // Assert the import landed rather than sleeping and checking that the page
    // is still on screen, which is true whether or not anything was imported.
    // The wizard previews before it writes, so selecting the file only
    // populates the preview. Drive it through, mirroring the Clipio test above.
    const wizard = optionsPage.getByRole("dialog");
    await expect(wizard).toContainText(/Found \d+ snippets?/, {
      timeout: 10_000,
    });

    const nextBtn = wizard.getByRole("button", { name: "Next" });
    await expect(nextBtn).toBeEnabled();
    await nextBtn.click();

    const importBtn = wizard.getByRole("button", {
      name: /Import \d+ snippets?/,
    });
    await expect(importBtn).toBeEnabled();
    await importBtn.click();

    await expect
      .poll(
        async () =>
          (await readSyncSnippets(optionsPage)).map((snip) => snip.shortcut),
        {
          timeout: 10_000,
          message: "TextBlaze snippets never reached sync storage",
        }
      )
      .toEqual(expect.arrayContaining(["/tb1", "/tb2"]));

    fs.unlinkSync(tmpPath);
  });

  test("imports from PowerText format", async ({ optionsPage }) => {
    await waitForOptionsReady(optionsPage);

    // A real Power Text export: a flat object of shortcut → expansion. The
    // previous fixture was an array of `{keyword, expansion}` objects, which the
    // detector does not recognise, and the assertion again only checked that
    // `body` was visible.
    const powerTextContent = JSON.stringify({
      "/pt1": "PowerText snippet one",
      "/pt2": "PowerText snippet two",
    });

    // Open the import wizard from the Snippets section via stable testid
    await optionsPage.getByTestId("options-nav-library").click();
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

    // The wizard previews before it writes, so selecting the file only
    // populates the preview. Drive it through, mirroring the Clipio test above.
    const wizard = optionsPage.getByRole("dialog");
    await expect(wizard).toContainText(/Found \d+ snippets?/, {
      timeout: 10_000,
    });

    const nextBtn = wizard.getByRole("button", { name: "Next" });
    await expect(nextBtn).toBeEnabled();
    await nextBtn.click();

    const importBtn = wizard.getByRole("button", {
      name: /Import \d+ snippets?/,
    });
    await expect(importBtn).toBeEnabled();
    await importBtn.click();

    await expect
      .poll(
        async () =>
          (await readSyncSnippets(optionsPage)).map((snip) => snip.shortcut),
        {
          timeout: 10_000,
          message: "PowerText snippets never reached sync storage",
        }
      )
      .toEqual(expect.arrayContaining(["/pt1", "/pt2"]));

    fs.unlinkSync(tmpPath);
  });

  test("toggles theme (light/dark/system)", async ({ optionsPage }) => {
    await waitForOptionsReady(optionsPage);

    // Navigate to appearance via stable testid
    await optionsPage.getByTestId("options-nav-appearance").click();

    // The three-button picker is now a select row.
    const select = optionsPage.getByTestId("setting-theme-select");
    await expect(select).toBeVisible({ timeout: 5_000 });

    // Poll the persisted value: the change handler writes asynchronously, so a
    // one-shot read can land before the write and report the old theme.
    const readTheme = () =>
      optionsPage.evaluate(async () => {
        const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
        const result = await ext.storage.local.get("themeMode");
        return result.themeMode;
      });

    await select.click();
    await optionsPage.getByRole("option", { name: "Dark" }).click();
    await expect
      .poll(readTheme, { message: "theme never persisted as dark" })
      .toBe("dark");

    // The change must reach the document, not just storage: ThemeContext owns
    // the `dark` class on <html>, and writing the item alone left the page
    // visually unchanged.
    await expect(optionsPage.locator("html")).toHaveClass(/\bdark\b/);

    await select.click();
    await optionsPage.getByRole("option", { name: "Light" }).click();
    await expect
      .poll(readTheme, { message: "theme never persisted as light" })
      .toBe("light");
    await expect(optionsPage.locator("html")).not.toHaveClass(/\bdark\b/);

    await select.click();
    await optionsPage.getByRole("option", { name: "System" }).click();
    await expect
      .poll(readTheme, { message: "theme never persisted as system" })
      .toBe("system");
  });

  test("toggles confetti setting", async ({ optionsPage }) => {
    await waitForOptionsReady(optionsPage);

    // Navigate to appearance via stable testid
    await optionsPage.getByTestId("options-nav-appearance").click();

    const confettiToggle = optionsPage.getByTestId("confetti-toggle-switch");
    await expect(confettiToggle).toBeVisible({ timeout: 5_000 });

    const initialChecked =
      (await confettiToggle.getAttribute("aria-checked")) === "true";
    await confettiToggle.click();

    // Behavior: the switch's checked state flips.
    await expect
      .poll(() => confettiToggle.getAttribute("aria-checked"), {
        message: "switch state never flipped",
      })
      .toBe(String(!initialChecked));

    const newChecked = await confettiToggle.getAttribute("aria-checked");

    // The persisted value must track the control, not merely be a boolean.
    await expect
      .poll(
        () =>
          optionsPage.evaluate(async () => {
            const ext =
              (globalThis as any).chrome ?? (globalThis as any).browser;
            const result = await ext.storage.local.get("confettiEnabled");
            return String(result.confettiEnabled);
          }),
        { message: "confettiEnabled never matched the toggle" }
      )
      .toBe(newChecked);
  });

  test("hash-based navigation to feedback section", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html#feedback`);
    await page.waitForLoadState("domcontentloaded");

    // `feedback` is not a section id, so the shell must fall back to the default
    // section rather than rendering nothing. Assert the nav and the feedback
    // affordance are both present — the previous version slept 500 ms and then
    // checked `body` was visible, which is true for any shell that rendered.
    await expect(page.getByTestId("options-nav-library")).toBeVisible({
      timeout: 10_000,
    });
    // Feedback moved into the About section after the redesign.
    await page.getByTestId("options-nav-about").click();
    await expect(page.getByRole("button", { name: "Feedback" })).toBeVisible({
      timeout: 10_000,
    });

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

    // Feedback opens from the About section (aria-label="Feedback")
    await optionsPage.getByTestId("options-nav-about").click();
    const feedbackNav = optionsPage.getByRole("button", { name: "Feedback" });
    await expect(feedbackNav).toBeVisible({ timeout: 5_000 });
    await feedbackNav.click();

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

    // Asserted, not guarded. A prior version wrapped each in
    // `if (await field.isVisible())`, so the form could be submitted empty and
    // the test would still pass.
    await expect(nameField).toBeVisible();
    await expect(emailField).toBeVisible();
    await expect(messageField).toBeVisible();
    await nameField.fill("E2E Tester");
    await emailField.fill("e2e@test.com");
    await messageField.fill("E2E test feedback message");

    // Submit the form
    const submitButton = optionsPage
      .getByRole("button", { name: /send|submit/i })
      .first();
    // Asserted, not guarded — see the note on the import dialog above. A failed
    // precondition here used to skip the submit and still pass.
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Page should not crash
    const body = optionsPage.locator("body");
    await expect(body).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Developers Section
// ---------------------------------------------------------------------------

test.describe("Diagnostics Section", () => {
  async function navigateToDiagnostics(page: import("@playwright/test").Page) {
    await waitForOptionsReady(page);
    // Selector is keyed to behavior (testid), not copy. The section is
    // "diagnostics" in the redesigned taxonomy — previously "advanced".
    await page.getByTestId("options-nav-diagnostics").click();
    // Fail loudly if the section never renders — never silently no-op.
    await expect(page.getByTestId("card-content-script-health")).toBeVisible({
      timeout: 5_000,
    });
  }

  test("renders the health panel, debug toggle and storage panels", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);

    // Version info and top usage live in Library and About after the redesign.
    await expect(optionsPage.getByTestId("card-top-usage")).toBeVisible();

    await navigateToDiagnostics(optionsPage);
    await expect(
      optionsPage.getByTestId("card-content-script-health")
    ).toBeVisible();
    // The debug toggle is a registry row here, and the Giphy key is a text row.
    await expect(optionsPage.getByTestId("setting-debug-mode")).toBeVisible();
    await expect(optionsPage.getByTestId("setting-giphy-key")).toBeVisible();

    // Storage is its own section and owns the quota meters.
    await optionsPage.getByTestId("options-nav-storage").click();
    await expect(optionsPage.getByTestId("panel-storage")).toBeVisible();
    await expect(optionsPage.getByTestId("card-storage-mode")).toBeVisible();
  });

  test("shows current version in the About section", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);

    await optionsPage.getByTestId("options-nav-about").click();
    const card = optionsPage.getByTestId("card-extension-version");
    await expect(card).toBeVisible({ timeout: 5_000 });
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
    await optionsPage.getByTestId("options-nav-about").click();
    const card = optionsPage.getByTestId("card-extension-version");
    await expect(card).toBeVisible({ timeout: 5_000 });
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

    // The banner is seeded into storage, so poll for it rather than sleeping a
    // fixed 500 ms and reading the body once.
    await expect(popupPage.getByTestId("warning-update")).toBeVisible({
      timeout: 10_000,
    });
    await expect(popupPage.getByTestId("warning-update")).toContainText(
      "999.0.0"
    );

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

    // Find and click the dismiss (X) button on the warning banner.
    // The banner must be asserted present. The previous version wrapped every
    // assertion in `if (await dismissBtn.isVisible())`, so the test passed
    // vacuously whenever the banner failed to render.
    //
    // Note: items are defined as "local:x" in src/storage/items.ts but WXT
    // strips the area prefix, so the real storage.local key is the bare "x".
    // Verified by dumping storage.local.get(null) from a loaded options page.
    const dismissBtn = popupPage.getByTestId("warning-update-dismiss");
    await expect(dismissBtn).toBeVisible({ timeout: 5_000 });
    await dismissBtn.click();

    // Banner should no longer show "888.0.0"
    await expect(popupPage.locator("body")).not.toContainText("888.0.0");

    // dismissedUpdateVersion should be stored in local storage.
    // Polled because the write happens in the click handler.
    await expect
      .poll(
        () =>
          popupPage.evaluate(async () => {
            const ext =
              (globalThis as any).chrome ?? (globalThis as any).browser;
            const r = await ext.storage.local.get("dismissedUpdateVersion");
            return r.dismissedUpdateVersion;
          }),
        { timeout: 5_000 }
      )
      .toBe("888.0.0");

    await popupPage.close();
  });

  test("ping button sends message and shows result", async ({
    optionsPage,
  }) => {
    await navigateToDiagnostics(optionsPage);

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

  test("top-5 usage card shows empty state when no usage data exists", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);
    // Top 5 Usage lives in Library; a fresh context has no usage counts, so the
    // empty state must be shown.
    await optionsPage.getByTestId("options-nav-library").click();
    const card = optionsPage.getByTestId("card-top-usage");
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(optionsPage.getByTestId("top-usage-empty")).toBeVisible();
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

  // ── Typing Timeout slider ──────────────────────────────────────────────

  test("typing timeout slider renders with default value", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);
    // The Typing Timeout row lives in the Expansion section.
    await optionsPage.getByTestId("options-nav-expansion").click();
    const row = optionsPage.getByTestId("card-typing-timeout");
    await expect(row).toBeVisible({ timeout: 5_000 });

    // Slider is identified by its accessible role/name, scoped to the row.
    // Fresh profile → default TIMING.TYPING_TIMEOUT (300 ms).
    const slider = row.getByRole("slider", { name: "Typing Timeout" });
    await expect(slider).toBeVisible();
    await expect(slider).toHaveValue("300");
  });

  test("typing timeout slider saves new value to storage", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);
    await optionsPage.getByTestId("options-nav-expansion").click();
    const row = optionsPage.getByTestId("card-typing-timeout");
    await expect(row).toBeVisible({ timeout: 5_000 });

    const slider = row.getByRole("slider", { name: "Typing Timeout" });
    await expect(slider).toHaveValue("300");

    // Drive the slider with real arrow-key input (step=50): 300 → 600.
    for (let i = 0; i < 6; i++) {
      await slider.press("ArrowRight");
    }
    await expect(slider).toHaveValue("600");

    // Poll the stored value rather than sleeping past the write. Asserting the
    // exact value, not merely "not the old one": an earlier version of this
    // poll used `not.toBe(300)`, which a missing key satisfies trivially.
    // (WXT stores "local:typingTimeout" as the bare key "typingTimeout".)
    await expect
      .poll(
        async () =>
          optionsPage.evaluate(async () => {
            const ext =
              (globalThis as any).chrome ?? (globalThis as any).browser;
            const result = await ext.storage.local.get("typingTimeout");
            return result.typingTimeout;
          }),
        { timeout: 5_000, message: "typingTimeout was never persisted as 600" }
      )
      .toBe(600);
  });

  // ── Debug Mode toggle ──────────────────────────────────────────────────

  test("debug mode toggle enables and writes to storage", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);
    await navigateToDiagnostics(optionsPage);

    // Every boolean now renders through the shared Switch primitive, so the
    // old sr-only-checkbox-behind-a-div markup is gone.
    const toggle = optionsPage.getByTestId("setting-debug-mode-switch");
    // Asserted, not guarded. `if (!visible) return;` skipped the entire body of
    // the test, so a missing toggle produced a green run.
    await expect(toggle).toBeVisible({ timeout: 5_000 });

    const initialChecked =
      (await toggle.getAttribute("aria-checked")) === "true";
    await toggle.click();

    // Behavior: the switch's checked state flips.
    await expect
      .poll(() => toggle.getAttribute("aria-checked"), {
        message: "switch state never flipped",
      })
      .toBe(String(!initialChecked));

    // Storage should reflect the new value
    const stored = await optionsPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const result = await ext.storage.local.get("debugMode");
      return result.debugMode;
    });
    expect(stored).toBe(!initialChecked);
  });

  // ── Storage backend control ────────────────────────────────────────────

  test("storage backend select offers exactly the two backends", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);
    await optionsPage.getByTestId("options-nav-storage").click();

    const select = optionsPage.getByTestId("card-storage-mode-select");
    await expect(select).toBeVisible({ timeout: 5_000 });

    await select.click();
    // Exactly two backends are offered, and the currently-active one is the
    // one the trigger displays.
    const options_ = optionsPage.getByRole("option");
    await expect(options_).toHaveCount(2);

    const storedMode = await optionsPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      const r = await ext.storage.local.get("storageMode");
      return (r.storageMode as "sync" | "local") ?? "sync";
    });
    await expect(select).toContainText(new RegExp(storedMode, "i"));
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

    // Scoped by testid: four banners share the `common.dismiss` aria-label, and
    // it is a translated string, so a label-based selector would both be
    // ambiguous and English-only.
    const dismissBtn = page.getByTestId("warning-review-dismiss");
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

  test("search results are reachable from the keyboard", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);

    // Typing filters, then ArrowDown must move focus into the results so the
    // flow needs no pointer.
    await optionsPage.getByTestId("options-search").fill("confetti");
    await expect(optionsPage.getByTestId("confetti-toggle")).toBeVisible({
      timeout: 5_000,
    });

    await optionsPage.getByTestId("options-search").press("ArrowDown");
    await expect(
      optionsPage.getByTestId("option-setting-confetti")
    ).toBeFocused();
  });

  test("the search field and sidebar labels are announced", async ({
    optionsPage,
  }) => {
    await waitForOptionsReady(optionsPage);

    // The rail is an `aside` and the list inside it is a `nav`; both need
    // labels or a screen reader announces two unlabelled landmarks.
    const sidebar = optionsPage.getByRole("complementary");
    await expect(sidebar).toBeVisible();
    await expect(
      optionsPage.getByRole("navigation", { name: /options navigation/i })
    ).toBeVisible();

    // The search field's placeholder is not its accessible name.
    await expect(optionsPage.getByRole("searchbox")).toHaveAccessibleName(
      /search settings/i
    );
  });
});
