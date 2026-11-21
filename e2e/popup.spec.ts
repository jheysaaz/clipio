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
import type { Snippet } from "../src/types/index.js";
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
  // (): either the snippet list or the empty state.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Popup routing", () => {
  test("deep-linking a snippet id selects that snippet", async ({
    popupPage,
    extensionId,
  }) => {
    // The case that decided the routing: a selection has an address, so a future
    // "open this specific snippet" — a context-menu entry, a notification, a
    // keyboard shortcut — builds a location instead of inventing a side channel.
    const target = makeSnippet({ label: "Deep link target", shortcut: ";dl" });

    // Navigate first, then seed: the reload inside `seedAndReload` keeps the hash,
    // so this exercises the path a real deep link takes — a cold open at that URL.
    await popupPage.goto(
      `chrome-extension://${extensionId}/popup.html#/snippet/${target.id}`
    );
    await seedAndReload(popupPage, [target]);

    // Regex rather than the full URL: the extension id differs per run, and
    // asserting on it would make this test about the harness.
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${target.id}$`));

    // `aria-activedescendant` is the assertion that matters: it names which option
    // in the list is selected. Not the label input — that lives in the *create*
    // form, so asserting on it would have passed for a popup showing nothing.
    await expect(popupPage.getByTestId("snippet-list")).toHaveAttribute(
      "aria-activedescendant",
      `snippet-${target.id}`
    );
    await expect(popupPage.getByTestId("snippet-copy")).toBeVisible();
  });

  test("never overrules an explicit address with the newest snippet", async ({
    popupPage,
    extensionId,
  }) => {
    // Two snippets, addressed the older one. Auto-selecting the newest would make
    // every deep link open the same snippet whatever its id — a link that looks
    // right and is wrong.
    const older = makeSnippet({ label: "Addressed", shortcut: ";a" });
    const newer = makeSnippet({ label: "Newer", shortcut: ";n" });
    // `updatedAt` decides which is newest, so make it unambiguous.
    (newer as { updatedAt: string }).updatedAt = "2999-01-01T00:00:00.000Z";

    await popupPage.goto(
      `chrome-extension://${extensionId}/popup.html#/snippet/${older.id}`
    );
    await seedAndReload(popupPage, [older, newer]);

    await expect(popupPage.getByTestId("snippet-list")).toHaveAttribute(
      "aria-activedescendant",
      `snippet-${older.id}`
    );
  });

  test("keeps the popup's history from growing as the selection changes", async ({
    popupPage,
  }) => {
    // Navigation is `replace` only. The popup closes on blur, so a history entry
    // is something the user can never use — and a stray Back press would go
    // somewhere meaningless.
    await seedAndReload(popupPage, makeSnippets(3));

    const before = await popupPage.evaluate(() => window.history.length);
    for (let i = 0; i < 2; i++) {
      await popupPage
        .locator('[data-testid="snippet-list"] [role="option"]')
        .nth(i)
        .click();
    }
    const after = await popupPage.evaluate(() => window.history.length);

    expect(after).toBe(before);
    // The address did change — otherwise the test above would pass trivially.
    await expect(popupPage).toHaveURL(/#\/snippet\//);
  });

  test("keeps the create form open when a context-menu draft arrives", async ({
    popupPage,
  }) => {
    // The regression: right-click → "Save selection" → the form opens with the
    // pasted text, then the snippet load resolves and auto-select navigated to
    // `#/snippet/<id>`, closing the form and taking the draft with it.
    //
    // The existing background e2e missed this because it opens the popup against
    // an *empty* library, where auto-select returns early regardless. So the
    // draft is seeded alongside real snippets — the condition that exposes it.
    await seedAndReload(popupPage, makeSnippets(2));

    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({
        contextMenuDraft: "text the user selected",
      });
    });
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    // The form is showing, and it is showing *their* text.
    await expect(popupPage.getByTestId("snippet-label-input")).toBeVisible();
    await expect(popupPage).toHaveURL(/#\/new/);
    await expect(
      popupPage.locator('[contenteditable="true"]').first()
    ).toContainText("text the user selected");
  });

  test("addressing a newly created snippet moves the URL to it", async ({
    popupPage,
  }) => {
    // "Copy link to this snippet" needs no work to start working, because the id
    // is in the URL as soon as the snippet exists.
    await waitForPopupReady(popupPage);
    await popupPage.getByTestId("add-snippet").click();
    await popupPage.getByTestId("snippet-label-input").fill("Addressed");
    await popupPage.getByTestId("snippet-shortcut-input").fill(";ad");
    await popupPage.locator('[contenteditable="true"]').first().fill("hello");
    await popupPage.getByTestId("snippet-create-save").click();

    await expect(popupPage).toHaveURL(/#\/snippet\//);
  });
});

test.describe("Popup — a context-menu route request is honoured", () => {
  /**
   * The background cannot address an extension popup: `openPopup()` takes no URL,
   * so the popup comes up at whatever route it last held. The background therefore
   * leaves the requested route in session storage, and the popup reads it on mount.
   *
   * Both halves are asserted here, because either one alone passes while the
   * feature is broken: a background that writes a key nobody reads leaves "Create
   * snippet" landing on whatever the popup last showed — a link that works and
   * arrives somewhere else.
   */
  test("opens the create page when a route was requested", async ({
    popupPage,
  }) => {
    await seedAndReload(popupPage, [makeSnippet({ label: "Existing" })]);

    // Stand in for what `requestPopupView` writes.
    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      // The stored value is a router *path*, not a URL fragment. Handing the
      // fragment to the router type-checks and lands on the not-found view.
      await ext.storage.session.set({ __clipioPopupView__: "/new" });
    });
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    // The create form, not the previously-shown snippet.
    await expect(popupPage).toHaveURL(/#\/new$/);
    await expect(popupPage.getByTestId("snippet-label-input")).toBeVisible();
  });

  test("does not drag the popup back on the next open", async ({
    popupPage,
    extensionId,
  }) => {
    // The key is consumed on read. Left in place it would yank the user back to
    // `#/new` every time they opened the popup afterwards.
    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      // The stored value is a router *path*, not a URL fragment. Handing the
      // fragment to the router type-checks and lands on the not-found view.
      await ext.storage.session.set({ __clipioPopupView__: "/new" });
    });
    await popupPage.reload();
    await waitForPopupReady(popupPage);
    await expect(popupPage).toHaveURL(/#\/new$/);

    // Clear the request, as the background would have, then open cold *without* the
    // hash. A reload would not do: it preserves the address, so it would still be
    // `#/new` for reasons that have nothing to do with the key.
    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.session.remove("__clipioPopupView__");
    });
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await waitForPopupReady(popupPage);

    await expect(popupPage).not.toHaveURL(/#\/new$/);
  });

  test("ignores a request it cannot resolve rather than showing nothing", async ({
    popupPage,
  }) => {
    // The key is session storage and therefore writable by anything with extension
    // access. A stale or hand-edited value must not leave the popup on a blank view.
    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.session.set({
        __clipioPopupView__: "#/not-a-real-route",
      });
    });
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    // Whatever it lands on, it renders the dashboard rather than nothing.
    await expect(popupPage.getByTestId("add-snippet")).toBeVisible();
  });
});

async function reopenPopup(page: import("@playwright/test").Page) {
  /**
   * Open the popup the way the toolbar does — a bare URL, no hash.
   *
   * A `reload()` is NOT a reopen. It preserves the address, so the popup comes up
   * already addressed at whatever was showing, `autoSelect` returns early because
   * the URL says which snippet, and the resume logic is never reached. Every test
   * in this group passed against a build with the feature removed, because of it.
   */
  // Split rather than `new URL(...).origin`: the `chrome-extension:` scheme has a
  // null origin, so building the URL that way produces "Cannot navigate to invalid
  // URL".
  await page.goto(page.url().split("#")[0]);
  await page.waitForLoadState("domcontentloaded");
  await waitForPopupReady(page);
}

test.describe("Popup — reopening resumes the last viewed snippet", () => {
  /**
   * Opening the popup used to land on the *newest* snippet every time. For a snippet
   * manager that is rarely what you want: you open the popup to go back to the thing
   * you were working on.
   *
   * The fallback to newest is load-bearing, not a nicety. The remembered id can stop
   * resolving — deleted from the options page, deleted on another device and synced
   * down, or replaced by an import — and a stale id must not leave the popup on a
   * blank pane.
   *
   * The delete test below looks like it covers that fallback, and it does not:
   * deleting re-records the survivor through `selectSnippet`, so by the time the
   * popup reopens the remembered id is already the right one and the fallback never
   * runs. Verified by mutating the fallback away — the test still passed. The
   * fallback is covered by `resolveInitialSnippet`'s unit tests, which is where a
   * caller can hand it a stale id; no user path reaches that state without first
   * re-recording.
   */
  test("opens the snippet you last looked at, not the newest", async ({
    popupPage,
  }) => {
    const older = makeSnippet({
      label: "Older",
      shortcut: "/o",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const newer = makeSnippet({
      label: "Newer",
      shortcut: "/n",
      updatedAt: "2026-12-01T00:00:00.000Z",
    });
    await seedAndReload(popupPage, [newer, older]);

    // Cold open: nothing remembered, so newest — the pre-existing behaviour.
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${newer.id}`));

    // Go back to the older one.
    await popupPage.getByTestId("snippet-list-item").nth(1).click();
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${older.id}`));

    // Reopen. A popup closes on every blur, so this is the next real open.
    await reopenPopup(popupPage);

    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${older.id}`));
    // The list reports it selected, which is the assertion that matters: the URL
    // could match while the pane showed something else.
    await expect(popupPage.getByTestId("snippet-list")).toHaveAttribute(
      "aria-activedescendant",
      new RegExp(older.id)
    );
  });

  test("falls back to the newest when the remembered snippet is deleted", async ({
    popupPage,
  }) => {
    const older = makeSnippet({
      label: "Older",
      shortcut: "/o",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const newer = makeSnippet({
      label: "Newer",
      shortcut: "/n",
      updatedAt: "2026-12-01T00:00:00.000Z",
    });
    await seedAndReload(popupPage, [newer, older]);

    // Look at the older one, then delete it through the UI.
    //
    // Deleted through the app rather than by writing to `storage.sync` directly: the
    // direct write did not take effect before the reload, so the snippet was still
    // in the library and the test passed for the wrong reason. The UI is also the
    // path a user actually takes to get here.
    await popupPage.getByTestId("snippet-list-item").nth(1).click();
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${older.id}`));

    // The same testid and confirm pattern as the existing delete test, rather than
    // a broader regex: `/^(delete|confirm)/i` with `.last()` matched a control that
    // closed the popup, and the failure surfaced as "target page has been closed".
    await popupPage.getByTestId("snippet-delete").click();
    const confirmButton = popupPage
      .getByRole("button", { name: /delete|confirm|yes/i })
      .first();
    await expect(confirmButton).toBeVisible({ timeout: 5_000 });
    await confirmButton.click();

    // The delete moved the address, which is the app doing its job.
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${newer.id}`));

    // Now reopen cold. The remembered id no longer resolves, so it must fall back
    // to the newest rather than showing a pane for a snippet that is gone.
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${newer.id}`));
    await expect(popupPage.getByTestId("snippet-list")).toBeVisible();
  });

  test("a deep link still wins over the remembered snippet", async ({
    popupPage,
    extensionId,
  }) => {
    // The guard that must survive the feature. Auto-selecting regardless is what
    // made every deep link open the same snippet whatever its id — a link that looks
    // right and is wrong.
    const older = makeSnippet({
      label: "Older",
      shortcut: "/o",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const target = makeSnippet({
      label: "Target",
      shortcut: "/t",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
    await seedAndReload(popupPage, [older, target]);

    // The sidebar lists newest first, so the *older* snippet is at index 1.
    await popupPage.getByTestId("snippet-list-item").nth(1).click();
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${older.id}`));

    // Cold open straight at the target.
    await popupPage.goto(
      `chrome-extension://${extensionId}/popup.html#/snippet/${target.id}`
    );
    await popupPage.waitForLoadState("domcontentloaded");
    await waitForPopupReady(popupPage);

    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${target.id}`));
  });

  test("#/new is still left alone", async ({ popupPage }) => {
    // The other guard. Without it the draft read resolved, startCreating() ran, and
    // then getSnippets() replaced the route — so "Save selection" opened a form and
    // then closed it, taking the pasted text with it.
    const only = makeSnippet({ label: "Only", shortcut: "/o" });
    await seedAndReload(popupPage, [only]);

    await popupPage.getByTestId("add-snippet").click();
    await expect(popupPage).toHaveURL(/#\/new$/);

    await popupPage.reload();
    await popupPage.waitForLoadState("domcontentloaded");
    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.session.set({ __clipioPopupView__: "/new" });
    });
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    await expect(popupPage).toHaveURL(/#\/new$/);
    await expect(popupPage.getByTestId("snippet-label-input")).toBeVisible();
  });
});

test.describe("Popup — a new snippet's shortcut follows the trigger prefix", () => {
  /**
   * The setting is a free-text field, so a user can set it to anything. The default
   * shortcut used to be a hardcoded "/" in four places, so someone who had set their
   * trigger to ";" got a form prefilled with a character their preview would never
   * fire on.
   *
   * `readTriggerPrefix` reads storage on every call rather than capturing it at
   * module load: the popup document outlives a settings change made in another tab,
   * and "change it in Options, reopen the popup" is exactly the case.
   */
  test("prefills from the configured prefix", async ({ popupPage }) => {
    await seedAndReload(popupPage, []);
    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({ snippetPreviewPrefix: ";" });
    });
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    await popupPage.getByTestId("add-snippet").click();

    await expect(popupPage.getByTestId("snippet-shortcut-input")).toHaveValue(
      ";"
    );
  });

  test("prefills / when the prefix is explicitly the default", async ({
    popupPage,
  }) => {
    // The shipped default, set *explicitly* rather than left absent. This is the
    // case a user lands in after trying another prefix and switching back — and it
    // is not covered by either neighbour: "absent" resolves to the item's default,
    // and "blank" is coerced. An explicit "/" is a third path through
    // `normaliseTriggerPrefix`, and it was the one untested.
    await seedAndReload(popupPage, []);
    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({ snippetPreviewPrefix: "/" });
    });
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    await popupPage.getByTestId("add-snippet").click();

    await expect(popupPage.getByTestId("snippet-shortcut-input")).toHaveValue(
      "/"
    );
  });

  test("falls back to / when the prefix is blank", async ({ popupPage }) => {
    // Blank is a legitimate *trigger* configuration — it means "always trigger" —
    // but a shortcut that begins with nothing is not a shortcut.
    await seedAndReload(popupPage, []);
    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({ snippetPreviewPrefix: "   " });
    });
    await popupPage.reload();
    await waitForPopupReady(popupPage);

    await popupPage.getByTestId("add-snippet").click();

    await expect(popupPage.getByTestId("snippet-shortcut-input")).toHaveValue(
      "/"
    );
  });

  test("reads the prefix again on the next open", async ({ popupPage }) => {
    // Not captured at module load. The value is read per draft, so a change made
    // while the popup was open is picked up without a reload.
    await seedAndReload(popupPage, []);
    await popupPage.getByTestId("add-snippet").click();
    await expect(popupPage.getByTestId("snippet-shortcut-input")).toHaveValue(
      "/"
    );

    // Role + name, per the e2e selector rule — the cancel button carries an
    // aria-label rather than a testid, and adding one here would mean this test
    // dictated the component's markup.
    await popupPage
      .getByRole("button", { name: /cancel/i })
      .first()
      .click();
    await popupPage.evaluate(async () => {
      const ext = (globalThis as any).chrome ?? (globalThis as any).browser;
      await ext.storage.local.set({ snippetPreviewPrefix: "," });
    });

    await popupPage.getByTestId("add-snippet").click();

    await expect(popupPage.getByTestId("snippet-shortcut-input")).toHaveValue(
      ","
    );
  });
});

test.describe("Popup (Dashboard)", () => {
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
  });

  test("shows a saved blank line between paragraphs in the editor", async ({
    popupPage,
  }) => {
    // The stored markdown keeps the blank line — insertion into a page already
    // preserves it — but the editor used to render the two paragraphs as bare
    // Slate divs with no gap, so reopening looked like one flat block.
    const snippet = makeSnippet({
      label: "Newsletter",
      shortcut: "/news",
      content:
        "GitHub Education November 2026 Newsletter\n\nNovember brings exciting opportunities.",
    });
    await seedAndReload(popupPage, [snippet]);

    await popupPage.getByTestId("snippet-list-item").click();
    await expect(popupPage.getByTestId("snippet-copy")).toBeVisible();

    const paragraphs = popupPage.getByTestId("clipio-editor-paragraph");
    await expect(paragraphs).toHaveCount(2);
    const gap = await paragraphs
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).marginBottom));
    expect(gap).toBeGreaterThan(0);
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

test.describe("Popup (Dashboard) — oversized snippet is refused, not silently diverted", () => {});

// ---------------------------------------------------------------------------
// Leaving a snippet with unsaved changes.
//
// The guard was a `pendingSnippet` store field consulted by the sidebar row and
// nowhere else. Browser Back — the navigation a popup user actually reaches for
// when they have made an edit they regret — walked straight past it, and so did
// the arrow keys. Editing a snippet's content, pressing Back, and watching the
// edit disappear was the reported symptom.
//
// `useBlocker` puts the decision in the router, so the sidebar click, the keyboard,
// and a POP are the same code path. These tests are the deliverable: the wiring
// without them proves nothing, and the control test is what stops the whole group
// from passing because the guard fires on every navigation.
// ---------------------------------------------------------------------------

test.describe("Popup — unsaved changes block navigation", () => {
  /**
   * Two snippets, with the newer one unambiguous so auto-select picks it.
   *
   * `updatedAt` is what `selectNewest` reads, and auto-select is what decides
   * which snippet the popup is sitting on after a reload — so leaving it to chance
   * would make every assertion below depend on `makeSnippet`'s clock.
   */
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

  /**
   * Leave the selected snippet dirty, and prove it from the app's own statement.
   *
   * `snippet-save` is disabled unless there are unsaved changes, so waiting for it
   * to enable is the app confirming the editor is dirty — no sleep, and no
   * assumption about how long the rich editor takes to report a keystroke.
   */
  async function makeEditorDirty(popupPage: import("@playwright/test").Page) {
    const editor = popupPage.locator('[contenteditable="true"]');
    // Exactly one when a snippet is selected, so addressing it is not a positional
    // pick wearing a different hat.
    await expect(editor).toHaveCount(1);
    await editor.click();
    await popupPage.keyboard.type(" an unsaved edit");
    await expect(popupPage.getByTestId("snippet-save")).toBeEnabled();
  }

  test("a dirty editor blocks a sidebar selection and keeps the snippet addressed", async ({
    popupPage,
  }) => {
    const { older, newer } = await seedTwo(popupPage);
    // The row's own `id` attribute — a stable attribute, and not an index into a
    // list whose order the test does not control.
    await popupPage.locator(`#snippet-${older.id}`).click();
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${older.id}$`));
    await makeEditorDirty(popupPage);

    await popupPage.locator(`#snippet-${newer.id}`).click();

    await expect(popupPage.getByRole("alertdialog")).toBeVisible();
    // Blocked, not merely warned about: the address did not move, and the list
    // still says the older snippet is the selected one.
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${older.id}$`));
    await expect(popupPage.getByTestId("snippet-list")).toHaveAttribute(
      "aria-activedescendant",
      `snippet-${older.id}`
    );
  });

  test("keeping editing cancels the navigation and leaves the editor alone", async ({
    popupPage,
  }) => {
    const { older, newer } = await seedTwo(popupPage);
    await popupPage.locator(`#snippet-${older.id}`).click();
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${older.id}$`));
    await makeEditorDirty(popupPage);

    await popupPage.locator(`#snippet-${newer.id}`).click();
    const dialog = popupPage.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /keep editing/i }).click();

    await expect(dialog).toBeHidden();
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${older.id}$`));
    // The edit is still there, which is the point of cancelling.
    await expect(popupPage.getByTestId("snippet-save")).toBeEnabled();
  });

  test("discarding from the dialog lets the blocked navigation through", async ({
    popupPage,
  }) => {
    const { older, newer } = await seedTwo(popupPage);
    await popupPage.locator(`#snippet-${older.id}`).click();
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${older.id}$`));
    await makeEditorDirty(popupPage);

    await popupPage.locator(`#snippet-${newer.id}`).click();
    const dialog = popupPage.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /discard/i }).click();

    // Not just "the dialog closed" — the navigation it was holding actually
    // happened, once, and the blocker did not re-arm against it.
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${newer.id}$`));
    await expect(dialog).toBeHidden();
    // And a second attempt is not blocked: nothing is dirty about the new snippet.
    await popupPage.locator(`#snippet-${older.id}`).click();
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${older.id}$`));
    await expect(dialog).toBeHidden();
  });

  test("a dirty editor blocks the browser's Back button", async ({
    popupPage,
    extensionId,
  }) => {
    const { older, newer } = await seedTwo(popupPage);
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${newer.id}$`));

    // The popup's own navigation is replace-only (ADR 0011), so `history.length`
    // never grows on its own and Back has nowhere to go. This same-document hash
    // navigation is what gives it a previous entry — the same way a real user's
    // Back arrives with somewhere to return to.
    await popupPage.goto(
      `chrome-extension://${extensionId}/popup.html#/snippet/${older.id}`
    );
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${older.id}$`));

    // Give that entry the history index the router would have written had the
    // popup pushed it itself. A hash navigation performed from outside the router
    // copies the previous entry's state, so both entries claim the same index and
    // the router reads the step as a delta of zero — which it answers by reloading
    // rather than by stepping back. That is an artefact of manufacturing history
    // depth here; a real entry always carries its own index.
    await popupPage.evaluate(() => {
      const state = (window.history.state ?? {}) as { __TSR_index?: number };
      window.history.replaceState(
        { ...state, __TSR_index: (state.__TSR_index ?? 0) + 1 },
        ""
      );
    });

    await makeEditorDirty(popupPage);

    await popupPage.goBack();

    const dialog = popupPage.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    // A POP is the browser's own move, so the address bar has already stepped back
    // by the time the blocker is consulted. What proves the *app* did not navigate
    // is that it is still showing the snippet being edited, with the edit still
    // unsaved. Before the blocker, this navigation went through and the typed text
    // went with it, silently.
    await expect(popupPage.getByTestId("snippet-list")).toHaveAttribute(
      "aria-activedescendant",
      `snippet-${older.id}`
    );
    await expect(popupPage.getByTestId("snippet-save")).toBeEnabled();

    // And answering "Keep editing" puts the address back where it was, so the
    // blocked step is undone rather than merely deferred.
    await dialog.getByRole("button", { name: /keep editing/i }).click();
    await expect(dialog).toBeHidden();
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${older.id}$`));
  });

  test("a clean editor navigates away without a prompt", async ({
    popupPage,
  }) => {
    // The control. Without it, every test above would also pass if the guard fired
    // on all navigation — which is a worse bug than the one being fixed.
    const { older, newer } = await seedTwo(popupPage);
    await popupPage.locator(`#snippet-${older.id}`).click();
    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${older.id}$`));

    await popupPage.locator(`#snippet-${newer.id}`).click();

    await expect(popupPage).toHaveURL(new RegExp(`#/snippet/${newer.id}$`));
    await expect(popupPage.getByRole("alertdialog")).toBeHidden();
  });
});
