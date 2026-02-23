import { CONTEXT_MENU } from "~/config/constants";
import { contextMenuDraftItem, syncDataLostItem } from "~/storage/items";
import { initSentry, captureMessage } from "~/lib/sentry";
import { registerSentryRelayListener } from "~/lib/sentry-relay";
import { i18n } from "#i18n";

const SNIPPET_PREFIX = "snip:";

export default defineBackground(() => {
  initSentry("background");

  // Register relay listener so content scripts can forward Sentry events
  // through the background when the host page's CSP blocks direct fetch.
  registerSentryRelayListener();

  // ---------------------------------------------------------------------------
  // On install / update
  // ---------------------------------------------------------------------------
  browser.runtime.onInstalled.addListener(() => {
    // Redirect to a farewell / recovery reminder page when uninstalled
    browser.runtime.setUninstallURL(
      "https://github.com/jheysaaz/clipio#uninstalled"
    );

    // Register context-menu items under a parent "Clipio" dropdown
    browser.contextMenus.removeAll().then(() => {
      // Parent item — visible on pages, selections, and editable fields
      browser.contextMenus.create({
        id: CONTEXT_MENU.PARENT,
        title: "Clipio",
        contexts: ["page", "selection", "editable"],
      });

      browser.contextMenus.create({
        id: CONTEXT_MENU.SAVE_SELECTION,
        parentId: CONTEXT_MENU.PARENT,
        title: i18n.t("contextMenu.saveSelection"),
        contexts: ["selection"],
      });

      browser.contextMenus.create({
        id: CONTEXT_MENU.CREATE_SNIPPET,
        parentId: CONTEXT_MENU.PARENT,
        title: i18n.t("contextMenu.createSnippet"),
        contexts: ["page", "editable"],
      });

      browser.contextMenus.create({
        id: CONTEXT_MENU.OPEN_DASHBOARD,
        parentId: CONTEXT_MENU.PARENT,
        title: i18n.t("contextMenu.openDashboard"),
        contexts: ["page", "selection", "editable"],
      });

      browser.contextMenus.create({
        id: CONTEXT_MENU.GIVE_FEEDBACK,
        parentId: CONTEXT_MENU.PARENT,
        title: i18n.t("contextMenu.giveFeedback"),
        contexts: ["page", "selection", "editable"],
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Context-menu click handler
  // ---------------------------------------------------------------------------
  browser.contextMenus.onClicked.addListener(async (info) => {
    switch (info.menuItemId) {
      case CONTEXT_MENU.SAVE_SELECTION: {
        const selectedText = info.selectionText?.trim();
        if (!selectedText) return;
        // Stash the selected text so the popup can pre-fill the draft
        await contextMenuDraftItem.setValue(selectedText);
        // Open the popup (falls back to opening the popup URL in a new tab
        // if the browser doesn't support openPopup)
        try {
          await (browser.action ?? browser.browserAction).openPopup();
        } catch {
          const popupUrl = browser.runtime.getURL("/popup.html");
          browser.tabs.create({ url: popupUrl });
        }
        break;
      }

      case CONTEXT_MENU.CREATE_SNIPPET: {
        try {
          await (browser.action ?? browser.browserAction).openPopup();
        } catch {
          const popupUrl = browser.runtime.getURL("/popup.html");
          browser.tabs.create({ url: popupUrl });
        }
        break;
      }

      case CONTEXT_MENU.OPEN_DASHBOARD: {
        const optionsUrl = browser.runtime.getURL("/options.html");
        browser.tabs.create({ url: optionsUrl });
        break;
      }

      case CONTEXT_MENU.GIVE_FEEDBACK: {
        const optionsUrl = browser.runtime.getURL("/options.html");
        browser.tabs.create({
          url: optionsUrl + "#feedback",
        });
        break;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Sign-out / sync-wipe detection
  // ---------------------------------------------------------------------------
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;

    // If multiple snip: keys disappear at once it is almost certainly a
    // browser sign-out (Chrome wipes storage.sync on account removal).
    const removedSnipKeys = Object.entries(changes).filter(
      ([key, change]) =>
        key.startsWith(SNIPPET_PREFIX) &&
        change.oldValue !== undefined &&
        change.newValue === undefined
    );

    if (removedSnipKeys.length >= 2) {
      const msg = `[Clipio] ${
        removedSnipKeys.length
      } sync keys removed at once — possible sign-out`;
      console.warn(msg);
      captureMessage("Sync storage wipe detected", "warning", {
        wipedKeyCount: removedSnipKeys.length,
      });
      syncDataLostItem.setValue(true);
    }
  });
});
