import {
  CONTEXT_MENU,
  UPDATE_CHECK_ALARM_NAME,
  UPDATE_CHECK_INTERVAL_MINUTES,
} from "~/config/constants";
import {
  contextMenuDraftItem,
  syncDataLostItem,
  blockedSitesItem,
  latestVersionItem,
} from "~/storage/items";
import { initSentry, captureError, captureMessage } from "~/lib/sentry";
import { registerSentryRelayListener } from "~/lib/sentry-relay";
import { i18n } from "#i18n";
import {
  MEDIA_GET_DATA_URL,
  type MediaGetDataUrlRequest,
  type MediaGetDataUrlResponse,
} from "~/lib/messages";
import { getMedia } from "~/storage/backends/media";
import { checkForUpdate } from "~/lib/update-checker";
import { debugLog } from "~/lib/debug";

const SNIPPET_PREFIX = "snip:";

export default defineBackground(() => {
  initSentry("background");

  // Register relay listener so content scripts can forward Sentry events
  // through the background when the host page's CSP blocks direct fetch.
  registerSentryRelayListener();

  // ---------------------------------------------------------------------------
  // Update checker — startup check + periodic alarm
  // ---------------------------------------------------------------------------
  // Check for updates immediately on startup, then every 6 hours via alarm.
  checkForUpdate().catch((err: unknown) => {
    captureError(err, { action: "checkForUpdate.startup" });
  });

  browser.alarms.create(UPDATE_CHECK_ALARM_NAME, {
    delayInMinutes: UPDATE_CHECK_INTERVAL_MINUTES,
    periodInMinutes: UPDATE_CHECK_INTERVAL_MINUTES,
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    debugLog("background", "alarm:fired", { name: alarm.name }).catch(() => {});
    if (alarm.name !== UPDATE_CHECK_ALARM_NAME) return;
    debugLog("background", "update:check:start", {}).catch(() => {});
    checkForUpdate().catch((err: unknown) => {
      captureError(err, { action: "checkForUpdate.alarm" });
    });
  });

  // ---------------------------------------------------------------------------
  // Update notification — fire a browser notification when a new version is found
  // ---------------------------------------------------------------------------
  // Watch for changes to latestVersionItem and show a notification when it
  // transitions from null → a release object.
  latestVersionItem.watch((newValue) => {
    if (!newValue) return;
    try {
      browser.notifications.create("clipio-update", {
        type: "basic",
        iconUrl: browser.runtime.getURL("/icon/128.png"),
        title: i18n.t("background.updateAvailable.title"),
        message: i18n.t("background.updateAvailable.message", [
          newValue.version,
        ]),
      });
    } catch (err) {
      captureError(err, { action: "updateNotification.create" });
    }
  });

  browser.notifications.onClicked.addListener((notificationId) => {
    if (notificationId !== "clipio-update") return;
    latestVersionItem
      .getValue()
      .then((release) => {
        if (release?.htmlUrl) {
          browser.tabs.create({ url: release.htmlUrl });
        }
      })
      .catch((err: unknown) => {
        captureError(err, { action: "updateNotification.click" });
      });
  });

  // ---------------------------------------------------------------------------
  // Media blob → data URL bridge
  // ---------------------------------------------------------------------------
  // Content scripts in the isolated world see the PAGE's origin IndexedDB,
  // not the extension's. All media blobs are stored at the extension origin.
  // Content scripts send this message to retrieve a blob as a data URL.
  browser.runtime.onMessage.addListener(
    (
      message: unknown,
      sender,
      sendResponse: (response: MediaGetDataUrlResponse) => void
    ): true | void => {
      if (
        typeof message !== "object" ||
        message === null ||
        (message as MediaGetDataUrlRequest).type !== MEDIA_GET_DATA_URL
      ) {
        return;
      }
      debugLog("background", "message:received", {
        type: (message as MediaGetDataUrlRequest).type,
      }).catch(() => {});
      // Only accept messages from our own extension (content scripts or popup).
      // Reject requests from external web pages that may know the extension ID.
      if (sender.id !== browser.runtime.id) {
        return;
      }
      const { mediaId } = message as MediaGetDataUrlRequest;
      getMedia(mediaId)
        .then((entry) => {
          if (!entry) {
            sendResponse({ dataUrl: null, alt: null });
            return;
          }
          const reader = new FileReader();
          reader.onload = () =>
            sendResponse({
              dataUrl: reader.result as string,
              alt: entry.alt ?? null,
            });
          reader.onerror = () => {
            captureError(reader.error, {
              action: "mediaGetDataUrl",
              mediaId,
            });
            sendResponse({ dataUrl: null, alt: null });
          };
          reader.readAsDataURL(entry.blob);
        })
        .catch((err: unknown) => {
          captureError(err, { action: "mediaGetDataUrl", mediaId });
          sendResponse({ dataUrl: null, alt: null });
        });
      // Return true to keep the message channel open for the async sendResponse
      return true;
    }
  );

  // ---------------------------------------------------------------------------
  // On install / update
  // ---------------------------------------------------------------------------
  browser.runtime.onInstalled.addListener((details) => {
    // On extension update: clear the cached latest-version so the checker
    // re-fetches against the new installed version, and log to Sentry.
    if (details.reason === "update") {
      latestVersionItem.setValue(null).catch((err: unknown) => {
        captureError(err, { action: "onInstalled.clearLatestVersion" });
      });
      captureMessage("Extension updated", "info", {
        previousVersion: details.previousVersion,
      });
    }

    // Redirect to a farewell / recovery reminder page when uninstalled
    browser.runtime.setUninstallURL(
      "https://github.com/jheysaaz/clipio#uninstalled"
    );

    // Register context-menu items under a parent "Clipio" dropdown
    browser.contextMenus
      .removeAll()
      .then(() => {
        // Parent item — visible on pages, selections, and editable fields
        browser.contextMenus.create({
          id: CONTEXT_MENU.PARENT,
          title: "Clipio — Snippets Manager",
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

        // Separator before "Hide on this site"
        browser.contextMenus.create({
          id: CONTEXT_MENU.SEPARATOR_HIDE,
          parentId: CONTEXT_MENU.PARENT,
          type: "separator",
          contexts: ["page", "selection", "editable"],
        });

        browser.contextMenus.create({
          id: CONTEXT_MENU.HIDE_ON_SITE,
          parentId: CONTEXT_MENU.PARENT,
          title: i18n.t("contextMenu.hideOnThisSite"),
          contexts: ["page", "selection", "editable"],
        });
      })
      .catch((err: unknown) => {
        captureError(err, { action: "contextMenusSetup" });
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
        } catch (err) {
          captureMessage("openPopup failed — falling back to tab", "warning", {
            action: "saveSelection",
          });
          const popupUrl = browser.runtime.getURL("/popup.html");
          browser.tabs.create({ url: popupUrl });
        }
        break;
      }

      case CONTEXT_MENU.CREATE_SNIPPET: {
        try {
          await (browser.action ?? browser.browserAction).openPopup();
        } catch (err) {
          captureMessage("openPopup failed — falling back to tab", "warning", {
            action: "createSnippet",
          });
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

      case CONTEXT_MENU.HIDE_ON_SITE: {
        const url = info.pageUrl;
        if (!url) break;
        try {
          const hostname = new URL(url).hostname;
          if (!hostname) break;
          const current = await blockedSitesItem.getValue();
          if (!current.includes(hostname)) {
            await blockedSitesItem.setValue([...current, hostname]);
          }
        } catch (err) {
          captureError(err, { action: "hideOnSite" });
        }
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
