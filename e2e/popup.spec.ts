/**
 * Popup flows that need a real browser: autosave through the real Plate editor,
 * clipboard and delete UI, cross-context undo, real history Back, and the two
 * editor geometry regressions (inline GIF caret and constrained slash menu).
 *
 * Routing, status text, tag overflow, banners, datepicker, code blocks and link
 * forms are covered by the unit suite under src now; re-proving them here only
 * made the gate slower without adding a browser-only assertion.
 */

import { test, expect } from "./fixtures.js";
import { helloSnippet, makeSnippet } from "./helpers/snippets.js";
import type { Snippet } from "../src/types/index.js";
import { readSyncSnippets } from "./helpers/storage.js";

// Sonner's own attributes. Asserting their absence proves the old toast layer
// is really gone instead of merely hidden by a CSS class or a copy change.
const TOAST_SELECTOR = "[data-sonner-toaster], [data-sonner-toast]";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for the popup's main content to be visible (React has hydrated).
 */
async function waitForPopupReady(page: import("@playwright/test").Page) {
  // Wait for the stable hydration landmarks added under e2e coverage
  // (): either the snippet list or the empty state.
  await page.waitForSelector(
    '[data-testid="snippet-list"], [data-testid="empty-state"]',
    { timeout: 10_000 }
  );
}

/**
 * The add-tag icon must sit inside its hit target, not against its left edge.
 * The old alignment hack removed the button's horizontal padding and pushed
 * the glyph flush with the footer; this measures the actual boxes in a browser.
 */

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
    // `lastViewedSnippetId` cleared as part of the seed, because it survives a popup
    // close by design and this fixture's storage outlives a single test. Snippet ids
    // are generated per call, so an id left by an earlier test can collide with one
    // in this one — and the leftover memory then "passes" a fallback assertion for
    // the wrong reason. A seed that does not clear it is a seed from an unknown
    // starting state.
    await ext.storage.local.set({
      cachedSnippets: snips,
      storageMode: "sync",
      lastViewedSnippetId: null,
    });
  }, snippets);
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await waitForPopupReady(page);
}

/**
 * Switch storage mode while suppressing the unrelated update banner. The badge
 * belongs to the background, so the change is made through browser storage —
 * not a React state setter — and the popup is reloaded to read it fresh.
 */

/**
 * Use the narrowest sidebar the resize handle permits. The bottom bar has to
 * keep its controls on screen there; a floating state field that only fits at
 * the default width has just moved the bug to a different setting.
 */

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Popup (Dashboard)", () => {
  test("creates a snippet on the first valid autosave", async ({
    popupPage,
  }) => {
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

    // No Save button: once all fields are valid the debounced draft is created.
    // The route change proves the create committed, not just that a draft exists.
    await expect(popupPage).toHaveURL(/#\/snippet\//, { timeout: 10_000 });

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
      // Exactly one. This was `toBeGreaterThanOrEqual(1)`, which is why a create
      // that produced two snippets passed: one is "at least one".
      .toBe(1);
    await expect(popupPage.getByTestId("snippet-list")).toBeVisible();

    // Rows, not keys. Storage holding exactly one `snip:` key is not the same
    // claim as the sidebar showing the snippet once, and the difference was the
    // whole bug: `addSnippet` appended optimistically *and* the change event its
    // own write fired drove a re-read, so one snippet in storage became two rows
    // on screen. Asserting only on storage is what let it through.
    await expect(popupPage.getByTestId("snippet-list-item")).toHaveCount(1);
    // The background clears the staged draft; the one status slot must follow
    // it out of `Saving…` and back to idle instead of staying stuck after a
    // successful create. A transient `Saved` is covered by the status test.
    await expect(popupPage.getByTestId("snippet-sync-status")).toHaveText("", {
      timeout: 10_000,
    });
  });

  test("places the caret beside an inline GIF when clicking next to it", async ({
    popupPage,
  }) => {
    // A void at the end of a block used to be deserialised with no text leaf
    // after it. There was then no Slate point for the browser click to land on,
    // so typing did nothing. Stub the remote GIF so the failure is about the
    // caret, not an offline image.
    const gifId = "caretanchorgif";
    await popupPage.route(
      `https://media.giphy.com/media/${gifId}/giphy.gif`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "image/gif",
          body: Buffer.from(
            "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
            "base64"
          ),
        })
    );
    const snippet = makeSnippet({
      label: "Media caret",
      shortcut: ";mc",
      content: `{{gif:${gifId}}}`,
    });
    await seedAndReload(popupPage, [snippet]);
    await popupPage.getByTestId("snippet-list-item").click();

    const image = popupPage.getByRole("img", { name: "GIF" });
    await expect(image).toBeVisible();
    const box = await image.boundingBox();
    expect(box).not.toBeNull();
    await popupPage.mouse.click(
      box!.x + box!.width + 4,
      box!.y + box!.height / 2
    );
    await popupPage.keyboard.type(" tail");

    await expect
      .poll(() => syncedContent(popupPage, snippet.id), { timeout: 10_000 })
      .toContain(" tail");
  });

  test("starts a new line after inserting an image", async ({ popupPage }) => {
    const snippet = makeSnippet({
      label: "Image line",
      shortcut: ";il",
      content: "",
    });
    await seedAndReload(popupPage, [snippet]);
    await popupPage.getByTestId("snippet-list-item").click();
    await popupPage.locator('[contenteditable="true"]').click();

    await popupPage.getByTestId("image-file-input").setInputFiles({
      name: "pixel.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
        "base64"
      ),
    });

    // A real block break survives serialization as the blank line between two
    // paragraphs; an empty text leaf alone would serialize to no newline.
    await expect
      .poll(() => syncedContent(popupPage, snippet.id), { timeout: 10_000 })
      .toMatch(/^\{\{image:[^\n]+\}\}\n\n/);
  });

  test("keeps every slash command reachable near the popup bottom", async ({
    popupPage,
  }) => {
    const snippet = makeSnippet({
      label: "Bottom menu",
      shortcut: ";bm",
      content: Array.from({ length: 14 }, (_, index) => `line ${index}`).join(
        "\n"
      ),
    });
    await seedAndReload(popupPage, [snippet]);
    await popupPage.getByTestId("snippet-list-item").click();

    const editor = popupPage.locator('[contenteditable="true"]');
    await editor.click();
    await editor.press("Control+End");
    // A slash is only a trigger at a word boundary. Start a fresh last
    // paragraph so the caret is genuinely at the bottom of a long document.
    await editor.press("Enter");
    await popupPage.mouse.move(0, 0);
    await popupPage.keyboard.type("/");

    const menu = popupPage.getByRole("listbox", { name: "Commands" });
    await expect(menu).toBeVisible();
    // The last item used to sit below the popup edge with no way to scroll to
    // it. It must now be reachable inside the constrained, scrollable menu.
    const lastCommand = popupPage.locator("#slash-cmd-gif");
    await lastCommand.scrollIntoViewIfNeeded();
    await expect(lastCommand).toBeInViewport();
    const menuBox = await menu.boundingBox();
    const popupBox = await popupPage.locator("body").boundingBox();
    expect(menuBox).not.toBeNull();
    expect(popupBox).not.toBeNull();
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(
      popupBox!.y + popupBox!.height
    );
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

    // The confirmation lives on the button itself, with one polite announcement
    // and no toast. It reverts after its short window.
    await expect(copyButton).toHaveAttribute("aria-pressed", "true", {
      timeout: 3_000,
    });
    await expect(copyButton).toContainText("Copied");
    await expect(copyButton).toHaveAttribute("aria-label", "Copied");
    await expect(popupPage.getByRole("status")).toHaveText("Copied");
    await expect(popupPage.locator(TOAST_SELECTOR)).toHaveCount(0);
    await expect(copyButton).not.toContainText("Copied", { timeout: 5_000 });
    await expect(copyButton).toHaveAttribute("aria-pressed", "false");
  });

  test("deletes immediately and confirms deletion inline", async ({
    popupPage,
  }) => {
    const snippet = makeSnippet({ label: "Delete Me", shortcut: "/delete-me" });
    await seedAndReload(popupPage, [snippet]);

    // Delete lives in the overflow menu and acts immediately.
    await popupPage.getByTestId("snippet-more").click();
    const deleteButton = popupPage.getByTestId("snippet-delete");
    await expect(deleteButton).toBeVisible({ timeout: 5_000 });
    await deleteButton.click();

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

    // The deleted state is a persistent part of the main panel, not a toast.
    const message = popupPage.getByTestId("snippet-deleted-message");
    await expect(message).toHaveText("Snippet deleted");
    await expect(message).toBeFocused();
    await expect(popupPage.getByTestId("snippet-undo-delete")).toBeVisible();
    await expect(popupPage.getByRole("status")).toHaveText(
      "Snippet deleted. Undo available."
    );
    await expect(popupPage.locator(TOAST_SELECTOR)).toHaveCount(0);
    await expect(popupPage.getByTestId("empty-state")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Accessibility checks
  // -------------------------------------------------------------------------
});

// ---------------------------------------------------------------------------
// Autosave replaces the old unsaved-changes guard. The popup disappears on
// blur, so an edit has to be staged locally and committed by the background
// however the user leaves the editor — sidebar click, browser Back, or a blur.
// ---------------------------------------------------------------------------

async function seedTwo(
  popupPage: import("@playwright/test").Page
): Promise<{ older: Snippet; newer: Snippet }> {
  const older = makeSnippet({
    label: "Older",
    shortcut: ";ol",
    content: "older body",
  });
  const newer = makeSnippet({
    label: "Newer",
    shortcut: ";nw",
    content: "newer body",
    updatedAt: "2999-01-01T00:00:00.000Z",
  });
  await seedAndReload(popupPage, [older, newer]);
  return { older, newer };
}

async function editSelectedSnippet(
  popupPage: import("@playwright/test").Page,
  snippet: Snippet,
  text: string
) {
  // The URL changes before React swaps the keyed detail view. Waiting for the
  // target's content avoids clicking the outgoing editor, which React would
  // replace mid-type and drop every keystroke on the floor.
  const editor = popupPage.locator('[contenteditable="true"]');
  await expect(editor).toHaveCount(1);
  await expect(editor).toContainText(snippet.content);
  await editor.click();
  await popupPage.keyboard.type(text);
  await expect(editor).toContainText(text.trim());
}

async function syncedContent(
  popupPage: import("@playwright/test").Page,
  snippetId: string
): Promise<string> {
  const snippets = await readSyncSnippets(popupPage);
  return snippets.find((s) => s.id === snippetId)?.content ?? "";
}

test.describe("Popup — edits autosave", () => {
  test("an edit is committed when the user switches snippets", async ({
    popupPage,
  }) => {
    const { older, newer } = await seedTwo(popupPage);
    await popupPage.locator(`#snippet-${older.id}`).click();
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${older.id}$`));

    await editSelectedSnippet(popupPage, older, " autosaved");
    await popupPage.locator(`#snippet-${newer.id}`).click();

    // No dialog, no Save button: the unmounting editor flushes its draft and
    // the background commits it. What proves it is the authoritative store.
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${newer.id}$`));
    await expect
      .poll(() => syncedContent(popupPage, older.id), { timeout: 10_000 })
      .toContain("autosaved");

    await popupPage.locator(`#snippet-${older.id}`).click();
    await expect(popupPage.locator('[contenteditable="true"]')).toContainText(
      "autosaved"
    );
  });

  test("undo restores the committed edit through the queue", async ({
    popupPage,
  }) => {
    const { older, newer } = await seedTwo(popupPage);
    await popupPage.locator(`#snippet-${older.id}`).click();
    await editSelectedSnippet(popupPage, older, " autosaved");
    await popupPage.locator(`#snippet-${newer.id}`).click();
    await expect
      .poll(() => syncedContent(popupPage, older.id), { timeout: 10_000 })
      .toContain("autosaved");

    await popupPage.locator(`#snippet-${older.id}`).click();
    const undo = popupPage.getByTestId("snippet-undo");
    await expect(undo).toBeEnabled();
    await undo.click();

    await expect
      .poll(() => syncedContent(popupPage, older.id), { timeout: 10_000 })
      .toBe("older body");
    await expect(
      popupPage.locator('[contenteditable="true"]')
    ).not.toContainText("autosaved");
  });

  test("browser Back does not lose an edit", async ({
    popupPage,
    extensionId,
  }) => {
    const { older, newer } = await seedTwo(popupPage);
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${newer.id}$`));

    // The popup's own navigation is replace-only (ADR 0011), so a hash
    // navigation from outside the router is what gives Back somewhere to go.
    await popupPage.goto(
      `chrome-extension://${extensionId}/popup.html#/snippet/${older.id}`
    );
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${older.id}$`));
    await popupPage.evaluate(() => {
      const state = (window.history.state ?? {}) as { __TSR_index?: number };
      window.history.replaceState(
        { ...state, __TSR_index: (state.__TSR_index ?? 0) + 1 },
        ""
      );
    });

    await editSelectedSnippet(popupPage, older, " before back");
    await popupPage.goBack();

    // Before autosave, this navigation threw the typed text away. The edit is
    // now flushed by the unmounting editor and committed in the background.
    await expect
      .poll(() => syncedContent(popupPage, older.id), { timeout: 10_000 })
      .toContain("before back");
    await expect(popupPage.getByRole("alertdialog")).toBeHidden();
  });
});
