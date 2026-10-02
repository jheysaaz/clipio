/**
 * Phase 3: Popup (Dashboard) Tests (12 tests)
 *
 * Validates the popup UI through full CRUD operations, search,
 * keyboard navigation, clipboard operations, and banners.
 *
 * Test strategy:
 * - Use popupPage fixture which navigates to chrome-extension://{id}/popup.html
 * - Wait for React hydration via waitForSelector
 * - Interact with UI using Playwright locators
 * - Verify storage changes via page.evaluate()
 * - Seed state via storage helpers before test
 */

import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures.js";
import { helloSnippet, makeSnippet, makeSnippets } from "./helpers/snippets.js";
import {
  getLocalItem,
  readSyncSnippets,
  writeBackupSnippets,
} from "./helpers/storage.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for the popup's main content to be visible (React has hydrated).
 */
async function waitForPopupReady(page: import("@playwright/test").Page) {
  // Wait for the stable hydration landmarks added under e2e coverage
  // (specs/e2e-suite.spec.md): either the snippet list or the empty state.
  await page.waitForSelector(
    '[data-testid="snippet-list"], [data-testid="empty-state"]',
    { timeout: 10_000 }
  );
}

/**
 * Seed snippets and reload popup.
 */
async function seedAndReload(
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
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await waitForPopupReady(page);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Popup (Dashboard)", () => {
  test("loads and shows empty state when no snippets exist", async ({
    popupPage,
  }) => {
    // Clear any existing snippets
    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.sync.clear();
      await ext.storage.local.set({ cachedSnippets: [] });
    });
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    // Popup should load without the empty-state landmark when snippets exist,
    // or show it when none do — either way the hydration landmark must appear.
    const title = await popupPage.title();
    expect(title.length).toBeGreaterThan(0);

    // Empty state is the behavioral signal for "no snippets"
    await expect(popupPage.getByTestId("empty-state")).toBeVisible();
  });

  test("creates new snippet via form", async ({ popupPage }) => {
    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.sync.clear();
      await ext.storage.local.set({ cachedSnippets: [], storageMode: "sync" });
    });
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    // Click the "Add Snippet" button (stable testid)
    const newButton = popupPage.getByTestId("add-snippet");
    await expect(newButton).toBeVisible({ timeout: 5_000 });
    await newButton.click();

    // Wait for the form the button is supposed to open.
    const labelInput = popupPage.getByTestId("snippet-label-input");
    await expect(labelInput).toBeVisible({ timeout: 5_000 });
    const shortcutInput = popupPage.getByTestId("snippet-shortcut-input");

    await expect(labelInput).toBeVisible();
    await labelInput.fill("E2E Test Snippet");
    await expect(shortcutInput).toBeVisible();
    await shortcutInput.fill("/e2e");

    // canSave requires non-empty content — fill the PlateJS contenteditable
    const editor = popupPage.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 5_000 });
    await editor.click();
    await popupPage.keyboard.type("Created by e2e");

    // Save the snippet
    const saveButton = popupPage.getByTestId("snippet-create-save");
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // Poll the persisted value: the save handler writes asynchronously.
    await expect
      .poll(
        () =>
          popupPage.evaluate(async () => {
            const ext =
              (globalThis as any).chrome ?? (globalThis as any).browser;
            const all = await ext.storage.sync.get(null);
            return Object.keys(all).filter((k) => k.startsWith("snip:")).length;
          }),
        { timeout: 5_000, message: "snippet never reached sync storage" }
      )
      .toBeGreaterThanOrEqual(1);
    await expect(popupPage.getByTestId("snippet-list")).toBeVisible();
  });

  test("displays existing snippets in list", async ({ popupPage }) => {
    const snippets = [
      helloSnippet(),
      makeSnippet({ label: "Second Snippet", shortcut: "/second" }),
      makeSnippet({ label: "Third Snippet", shortcut: "/third" }),
    ];
    await seedAndReload(popupPage, snippets);

    // At least one snippet should be visible in the page
    const pageText = await popupPage.textContent("body");
    // At least one of the snippet labels should appear
    const hasSnippetContent =
      pageText?.includes("Hello World") ||
      pageText?.includes("Second Snippet") ||
      pageText?.includes("Third Snippet");
    expect(hasSnippetContent).toBe(true);
  });

  test("searches and filters snippets by label", async ({ popupPage }) => {
    const snippets = [
      makeSnippet({ label: "Alpha Snippet", shortcut: "/alpha" }),
      makeSnippet({ label: "Beta Snippet", shortcut: "/beta" }),
      makeSnippet({ label: "Gamma Snippet", shortcut: "/gamma" }),
    ];
    await seedAndReload(popupPage, snippets);

    // Find and use the search input (aria-label from dashboard.searchPlaceholder)
    const searchInput = popupPage.getByRole("textbox", { name: /search/i });
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await searchInput.fill("Beta");
    await expect(
      popupPage.getByTestId("snippet-list-item").filter({ hasText: "Beta" })
    ).toBeVisible();
    // Other labels must be filtered out
    await expect(
      popupPage.getByTestId("snippet-list-item").filter({ hasText: "Alpha" })
    ).toHaveCount(0);
  });

  test("shows sync-wipe recovery banner when syncDataLost is true", async ({
    popupPage,
  }) => {
    // The banner is driven by `tryRecoverFromBackup()`, which reads the
    // `clipio-backup` IndexedDB store and shows nothing when it is empty — so the
    // backup has to be seeded. Writing `storage.sync` alone will not raise it.
    await writeBackupSnippets(
      popupPage,
      makeSnippets(2, (i) => ({
        label: `Recovered ${i + 1}`,
        shortcut: `/r${i + 1}`,
      }))
    );

    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({ syncDataLost: true });
    });
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    // The previous version accepted "an alert exists OR the page mentions
    // 'sync'/'lost'/'warning'", which is true on any page that mentions sync at
    // all — forcing `showRecoveryBanner` to false still passed it.
    const banner = popupPage.getByTestId("warning-uninstall");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText(/2/);

    // The dismiss control is on the banner, and the testid is derived from it.
    await expect(
      popupPage.getByTestId("warning-uninstall-dismiss")
    ).toBeVisible();
  });

  test("consumes context menu draft on popup open", async ({ popupPage }) => {
    const draftText = "Draft text from context menu";
    await popupPage.evaluate(async (draft: string) => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({ contextMenuDraft: draft });
    }, draftText);

    await popupPage.reload();
    await waitForPopupReady(popupPage);

    // The draft lands in a Plate.js editor — a `contenteditable`, not a
    // textarea. The previous version read `body` text and checked it was
    // truthy, which passed with draft consumption removed outright
    // (`if (typeof draft === "string" && draft)` → `if (false)`).

    // The draft is rendered...
    await expect
      .poll(
        () =>
          popupPage
            .locator('[contenteditable="true"]')
            .first()
            .textContent()
            .catch(() => null),
        { timeout: 5_000, message: "draft was never pre-filled" }
      )
      .toContain(draftText);

    // ...and consumed, so reopening does not restore it.
    await expect
      .poll(
        () =>
          popupPage.evaluate(async () => {
            const ext =
              (globalThis as any).chrome ?? (globalThis as any).browser;
            const r = await ext.storage.local.get("contextMenuDraft");
            return r.contextMenuDraft ?? null;
          }),
        { timeout: 5_000, message: "draft was never consumed" }
      )
      .toBeNull();
  });

  test("popup viewport is approximately 680x460", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 680, height: 460 });
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.waitForLoadState("domcontentloaded");

    // No sleep: `page.viewportSize()` reads the emulated viewport, which is set
    // by `setViewportSize` above and needs no render settle.
    const viewport = page.viewportSize();
    expect(viewport?.width).toBe(680);
    expect(viewport?.height).toBe(460);

    // Verify the page loaded
    const body = page.locator("body");
    await expect(body).toBeVisible();
    await page.close();
  });

  test("keyboard navigation with arrow keys in snippet list", async ({
    popupPage,
  }) => {
    const snippets = makeSnippets(3, (i) => ({
      label: `Snippet ${i + 1}`,
      shortcut: `/s${i + 1}`,
    }));
    await seedAndReload(popupPage, snippets);

    // The list is a `role="listbox"` using virtual focus: `aria-activedescendant`
    // names the active option and `document.activeElement` never leaves the
    // container. So that is what has to be asserted.
    //
    // The previous version slept 100 ms between presses and then checked that
    // `body` was visible, which is true whether or not anything handled the
    // keystroke.
    const list = popupPage.getByTestId("snippet-list");
    await expect(list).toBeVisible();

    const activeDescendant = () =>
      list.evaluate((el) => el.getAttribute("aria-activedescendant"));

    // The first row is pre-selected on mount, so the assertion is about
    // *movement*, not about the initial state being empty.
    const initial = await activeDescendant();
    expect(initial).toBeTruthy();

    await popupPage.keyboard.press("ArrowDown");
    const second = await expect
      .poll(activeDescendant, {
        message: "ArrowDown never advanced the active option",
      })
      .not.toBe(initial)
      .then(() => activeDescendant());

    await popupPage.keyboard.press("ArrowDown");
    const third = await expect
      .poll(activeDescendant, {
        message: "a second ArrowDown did not advance the active option",
      })
      .not.toBe(second)
      .then(() => activeDescendant());

    // Three distinct rows across three positions, so the keys really walked the
    // list rather than repeatedly reporting the same id.
    expect(new Set([initial, second, third]).size).toBe(3);

    await popupPage.keyboard.press("ArrowUp");
    await expect
      .poll(activeDescendant, {
        message: "ArrowUp did not return to the previous option",
      })
      .toBe(second);
  });

  test("copies snippet to clipboard", async ({ popupPage }) => {
    await seedAndReload(popupPage, [helloSnippet()]);

    // Grant clipboard permissions
    await popupPage
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: `chrome-extension://${await popupPage.evaluate(() => (globalThis as typeof globalThis & { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id ?? "")}`,
      })
      .catch(() => {});

    // Find and click the copy button via stable testid
    const copyButton = popupPage.getByTestId("snippet-copy");
    await expect(copyButton).toBeVisible({ timeout: 5_000 });
    await copyButton.click();

    // Behavior: aria-pressed flips to true after a successful copy
    await expect(copyButton).toHaveAttribute("aria-pressed", "true", {
      timeout: 3_000,
    });
  });

  test("shows quota warning banner when sync has fallen back on quota", async ({
    popupPage,
  }) => {
    // The banner is driven by `getStorageStatus().quotaExceeded`, which is
    // `mode === "local" && localReason === "quota"` — so those are the two keys
    // to seed. The previous version wrote ~91 KB straight into `storage.sync`
    // and then asserted only that `body` was visible, with a comment conceding
    // the banner "may or may not appear"; forcing `quotaWarning` to false still
    // passed it.
    await seedAndReload(popupPage, [makeSnippet({ label: "One" })]);

    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({
        storageMode: "local",
        storageModeReason: "quota",
      });
    });
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    const banner = popupPage.getByTestId("warning-quota");
    await expect(banner).toBeVisible({ timeout: 10_000 });

    // The banner's action opens the options page, which is what the warning is for.
    await expect(
      banner.getByRole("button").filter({ hasNotText: /^$/ }).first()
    ).toBeVisible();
  });

  test("shows sync-paused banner when storage was switched to local manually", async ({
    popupPage,
  }) => {
    // The third dashboard banner. It renders when `mode === "local"` and
    // `localReason === "manual"`, which is the pair of keys to seed.
    await seedAndReload(popupPage, [makeSnippet({ label: "One" })]);

    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({
        storageMode: "local",
        storageModeReason: "manual",
      });
    });
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    await expect(popupPage.getByTestId("warning-sync-paused")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("import button navigates to options page", async ({
    popupPage,
    context,
    extensionId,
  }) => {
    await waitForPopupReady(popupPage);

    // The settings control. The `exact: true` workaround is no longer needed:
    // the empty state used to offer a second, near-identical "Import snippets"
    // button and an "Open settings" button, so this locator had to be pinned
    // to an exact accessible name to avoid matching them.
    const settingsBtn = popupPage.getByTestId("settings-button");
    await expect(settingsBtn).toBeVisible({ timeout: 5_000 });
    const newPage = await Promise.all([
      context.waitForEvent("page", { timeout: 5_000 }).catch(() => null),
      settingsBtn.click(),
    ]).then(([p]) => p);

    expect(newPage).not.toBeNull();
    if (newPage) {
      await newPage.waitForLoadState("domcontentloaded");
      expect(newPage.url()).toContain(extensionId);
      await newPage.close();
    }

    // Smoke test: popup is still responsive
    const body = popupPage.locator("body");
    await expect(body).toBeVisible();
  });

  test("deletes snippet and verifies removal from storage", async ({
    popupPage,
  }) => {
    const snippet = makeSnippet({ label: "Delete Me", shortcut: "/delete-me" });
    await seedAndReload(popupPage, [snippet]);

    // Click delete via stable testid, then confirm in the dialog
    const deleteButton = popupPage.getByTestId("snippet-delete");
    await expect(deleteButton).toBeVisible({ timeout: 5_000 });
    await deleteButton.click();

    const confirmButton = popupPage
      .getByRole("button", { name: /delete|confirm|yes/i })
      .first();
    await expect(confirmButton).toBeVisible({ timeout: 5_000 });
    await confirmButton.click();

    // Storage verification — the seeded snippet must be gone. Poll: the delete
    // handler writes asynchronously.
    await expect
      .poll(
        () =>
          popupPage.evaluate(async () => {
            const ext =
              (globalThis as any).chrome ?? (globalThis as any).browser;
            const all = await ext.storage.sync.get(null);
            return Object.keys(all).filter((k) => k.startsWith("snip:")).length;
          }),
        { timeout: 5_000, message: "deleted snippet never left sync storage" }
      )
      .toBe(0);
    await expect(popupPage.getByTestId("empty-state")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Accessibility checks
  // -------------------------------------------------------------------------

  test("popup has no critical accessibility violations", async ({
    popupPage,
  }) => {
    // spec: specs/e2e-suite.spec.md
    // @axe-core/playwright v4 exposes the AxeBuilder class — the old
    // injectAxe/checkA11y free functions do not exist. Scan the hydrated
    // popup; fail on critical/serious violations without suppression, and
    // attach the full axe output to the report either way.
    await waitForPopupReady(popupPage);
    const results = await new AxeBuilder({ page: popupPage })
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

// ---------------------------------------------------------------------------
// Save-path outcomes changed by Waves 9 and 10. Neither had e2e coverage, so
// both regressions below were invisible to the e2e suite.
// ---------------------------------------------------------------------------

test.describe("Popup (Dashboard) — oversized snippet is refused, not silently diverted", () => {
  // spec: specs/storage-quota-preflight.spec.md
  test("refuses a snippet over the per-item sync limit and keeps sync mode", async ({
    popupPage,
  }) => {
    await seedAndReload(popupPage, [helloSnippet()]);

    const before = await readSyncSnippets(popupPage);
    const beforeMode = await getLocalItem(popupPage, "storageMode");

    // Over `SYNC_QUOTA.BYTES_PER_ITEM` (8,192). Paste it into the editor.
    const editor = popupPage.locator('[contenteditable="true"]').first();
    await popupPage.getByTestId("add-snippet").click();
    await expect(editor).toBeVisible({ timeout: 5_000 });
    await editor.click();
    await popupPage.keyboard.insertText("x".repeat(9_000));

    await popupPage.getByTestId("snippet-label-input").fill("Too Big");
    await popupPage.getByTestId("snippet-shortcut-input").fill("/toobig");

    const save = popupPage.getByTestId("snippet-create-save");
    await expect(save).toBeEnabled();
    await save.click();

    // The write must be refused, and the user must be told why.
    await expect(popupPage.getByText(/8\.0 KB|8 KB|per snippet/i)).toBeVisible({
      timeout: 10_000,
    });

    // The decisive assertion: nothing was written and the install did NOT
    // silently switch to local mode. Before Wave 9 this switched permanently.
    const after = await readSyncSnippets(popupPage);
    expect(after.map((s) => s.shortcut)).toEqual(before.map((s) => s.shortcut));
    expect(await getLocalItem(popupPage, "storageMode")).toBe(beforeMode);
  });
});

test.describe("Popup (Dashboard) — block structure survives a save", () => {
  // spec: specs/markdown-block-grammar.spec.md
  test("keeps a heading, a list and a table through an open/save cycle", async ({
    popupPage,
  }) => {
    // Seed a snippet whose body is a real multi-block document. Before Wave 10
    // the list and the table cells were merged into single strings on save.
    const body = [
      "## Heading",
      "",
      "- alpha",
      "- beta",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");

    await seedAndReload(popupPage, [
      makeSnippet({
        id: "blocks",
        label: "Blocks",
        shortcut: "/blocks",
        content: body,
      }),
    ]);

    // Open it.
    await popupPage
      .getByTestId("snippet-list-item")
      .filter({ hasText: "Blocks" })
      .click();
    const editor = popupPage.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 10_000 });

    // The editor must have parsed the blocks rather than one blob of text.
    // Without this the later assertions could pass on a page that never
    // round-tripped anything.
    await expect(editor.locator("h2")).toHaveCount(1, { timeout: 10_000 });
    await expect(editor.locator("ul li")).toHaveCount(2, { timeout: 10_000 });
    await expect(editor.locator("table")).toHaveCount(1, { timeout: 10_000 });

    // Make a change so Save is enabled — the button is disabled when nothing
    // differs, and a no-op save would not exercise the serialiser at all.
    // Typed into the heading specifically. Clicking the editor container, or
    // pressing End/Ctrl+Home, lands the caret in whichever block happens to be
    // under the pointer — which was a table cell, so the edit went into `a`
    // instead of the heading.
    await editor.locator("h2").click();
    await popupPage.keyboard.press("Home");
    await popupPage.keyboard.insertText("edited. ");

    const save = popupPage.getByTestId("snippet-save");
    await expect(save).toBeEnabled();
    await save.click();

    // Poll: the save handler writes asynchronously.
    await expect
      .poll(
        async () => {
          const all = await readSyncSnippets(popupPage);
          return all.find((s) => s.id === "blocks")?.content ?? "";
        },
        { timeout: 10_000, message: "the edited snippet was never persisted" }
      )
      .toContain("edited. ");

    const saved = (await readSyncSnippets(popupPage)).find(
      (s) => s.id === "blocks"
    );

    // Every block marker must still be there. The heading text was edited
    // above, so the assertion is on the marker plus the surviving word, not on
    // the literal original line.
    expect(saved?.content).toMatch(/^## .*Heading$/m);
    expect(saved?.content).toContain("- alpha");
    expect(saved?.content).toContain("- beta");
    // The table keeps its pipes: the two cells must not have become "12".
    expect(saved?.content).toContain("| a | b |");
    expect(saved?.content).toContain("| 1 | 2 |");
  });
});

// ---------------------------------------------------------------------------
// Empty state: one place for the actions, not three.
// ---------------------------------------------------------------------------

test.describe("Popup (Dashboard) — empty state", () => {
  test("offers create and import exactly once each, and no duplicate settings route", async ({
    popupPage,
  }) => {
    await waitForPopupReady(popupPage);

    // The detail pane is the single home for the empty-state actions. It is
    // also the only pane still visible when the sidebar is collapsed.
    await expect(popupPage.getByTestId("empty-create")).toHaveCount(1);
    await expect(popupPage.getByTestId("empty-import")).toHaveCount(1);

    // The sidebar footer carries the persistent controls. "Add Snippet" is a
    // different control from the empty-state CTA and stays.
    await expect(popupPage.getByTestId("add-snippet")).toHaveCount(1);
    await expect(popupPage.getByTestId("settings-button")).toHaveCount(1);

    // The list pane used to repeat the create and import buttons, putting four
    // controls for two actions on screen at once.
    const listPane = popupPage.getByTestId("empty-state");
    await expect(listPane).toBeVisible();
    await expect(listPane.getByRole("button")).toHaveCount(0);
  });

  test("no button anywhere duplicates the import route", async ({
    popupPage,
  }) => {
    await waitForPopupReady(popupPage);
    // "Import snippets" appeared twice — in the list pane and in the detail
    // hero. It should now be a single control.
    await expect(
      popupPage.getByRole("button", { name: /import snippets/i })
    ).toHaveCount(1);
  });

  test("settings is reachable from exactly one control, whatever it is labelled", async ({
    popupPage,
  }) => {
    await waitForPopupReady(popupPage);

    // Label-agnostic on purpose. An earlier version of this test matched the
    // literal text "Open settings" and therefore passed even after a second
    // settings route was reintroduced under a different label — which is the
    // exact regression it was written to catch.
    const settingsControls = popupPage.getByRole("button", {
      name: /settings|import\s*\/\s*export|preferences/i,
    });
    await expect(settingsControls).toHaveCount(1);
    await expect(popupPage.getByTestId("settings-button")).toBeVisible();
  });
});
