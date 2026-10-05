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
    await ext.storage.local.set({ cachedSnippets: snips, storageMode: "sync" });
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
