import {
  CONTEXT_MENU,
  UPDATE_CHECK_ALARM_NAME,
  UPDATE_CHECK_INTERVAL_MINUTES,
  REVIEW_CHECK_ALARM_NAME,
  REVIEW_CHECK_DELAY_HOURS,
  POPUP_VIEW_SESSION_KEY,
  TIMING,
} from "@/config/constants";
import {
  contextMenuDraftItem,
  syncDataLostItem,
  blockedSitesItem,
  latestVersionItem,
  latestVersionCheckedAtItem,
  extensionInstalledAtItem,
} from "@/storage/items";
import { initSentry, captureError, captureMessage } from "@/lib/sentry";
import { registerSentryRelayListener } from "@/lib/sentry-relay";
import { i18n } from "#i18n";
import { buildUninstallUrl } from "@/lib/uninstall-url";
import { MESSAGE, MediaNotFoundError, onMessageFromSelf } from "@/lib/protocol";
import { getMedia } from "@/storage/backends/media";
import { updateContentScriptCache } from "@/storage/backends/local";
import { storageManager } from "@/storage";
import { checkForUpdate, openReleasePage } from "@/lib/update-checker";
import { addBlockedSite } from "@/lib/blocked-sites";
import {
  FEEDBACK_ROUTE,
  OPTIONS_HOME_ROUTE,
  popupHashRoute,
  popupRouteForAction,
  resolveContextMenuAction,
  type ContextMenuAction,
} from "@/lib/context-menu";
import {
  needsCacheRefresh,
  readSyncChange,
  type StorageChanges,
} from "@/lib/sync-change";
import { debugLog } from "@/lib/debug";
import {
  shouldShowReviewPrompt,
  setReviewPromptState,
  getStoreReviewUrl,
} from "@/lib/review-prompt";

const DEV_QA_OPENED_KEY = "__clipioDevQaOpened__";
const DEV_QA_URL = "http://localhost:7777/manual-qa.html";
const CONTEXT_MENU_DRAFT_SESSION_KEY = "__clipioContextMenuDraft__";

/**
 * Read a blob as a data URL.
 *
 * Promisified from `FileReader` because the protocol handler is `async`. Rejects
 * on a read error rather than resolving with a null, so the failure is visible to
 * the caller instead of arriving as an empty image.
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed to read the blob"));
    reader.readAsDataURL(blob);
  });
}

async function setupBackgroundAlarms(): Promise<void> {
  try {
    await Promise.all([
      browser.alarms.create(UPDATE_CHECK_ALARM_NAME, {
        delayInMinutes: UPDATE_CHECK_INTERVAL_MINUTES,
        periodInMinutes: UPDATE_CHECK_INTERVAL_MINUTES,
      }),
      // No `periodInMinutes`: the review prompt is shown at most once per
      // install, so a repeating alarm would be a permanent no-op costing a
      // service-worker wakeup each cycle. See REVIEW_CHECK_DELAY_HOURS.
      browser.alarms.create(REVIEW_CHECK_ALARM_NAME, {
        delayInMinutes: REVIEW_CHECK_DELAY_HOURS * 60,
      }),
    ]);
  } catch (err) {
    captureError(err, { action: "alarmsSetup" });
  }
}

async function registerContextMenus(): Promise<void> {
  try {
    await browser.contextMenus.removeAll();

    await Promise.all([
      browser.contextMenus.create({
        id: CONTEXT_MENU.PARENT,
        title: "Clipio: Snippets Manager",
        contexts: ["page", "selection", "editable"],
      }),
      browser.contextMenus.create({
        id: CONTEXT_MENU.SAVE_SELECTION,
        parentId: CONTEXT_MENU.PARENT,
        title: i18n.t("contextMenu.saveSelection"),
        contexts: ["selection"],
      }),
      browser.contextMenus.create({
        id: CONTEXT_MENU.CREATE_SNIPPET,
        parentId: CONTEXT_MENU.PARENT,
        title: i18n.t("contextMenu.createSnippet"),
        contexts: ["page", "editable"],
      }),
      browser.contextMenus.create({
        id: CONTEXT_MENU.OPEN_OPTIONS,
        parentId: CONTEXT_MENU.PARENT,
        title: i18n.t("contextMenu.openOptions"),
        contexts: ["page", "selection", "editable"],
      }),
      browser.contextMenus.create({
        id: CONTEXT_MENU.GIVE_FEEDBACK,
        parentId: CONTEXT_MENU.PARENT,
        title: i18n.t("contextMenu.giveFeedback"),
        contexts: ["page", "selection", "editable"],
      }),
      browser.contextMenus.create({
        id: CONTEXT_MENU.SEPARATOR_HIDE,
        parentId: CONTEXT_MENU.PARENT,
        type: "separator",
        contexts: ["page", "selection", "editable"],
      }),
      browser.contextMenus.create({
        id: CONTEXT_MENU.HIDE_ON_SITE,
        parentId: CONTEXT_MENU.PARENT,
        title: i18n.t("contextMenu.hideOnThisSite"),
        contexts: ["page", "selection", "editable"],
      }),
    ]);
  } catch (err) {
    captureError(err, { action: "contextMenusSetup" });
  }
}

/**
 * Open the popup, on a route the API cannot be given.
 *
 * `openPopup()` takes no URL, so the route is passed separately and used where it
 * *is* under this code's control: the tab fallback, which is an ordinary URL. The
 * popup surface gets the route a different way — see `requestPopupView`.
 */
async function openPopupOrFallback(action: string, route = ""): Promise<void> {
  try {
    await (browser.action ?? browser.browserAction).openPopup();
  } catch {
    captureMessage("openPopup failed — falling back to tab", "warning", {
      action,
    });
    const popupUrl = browser.runtime.getURL("/popup.html") + route;
    browser.tabs.create({ url: popupUrl }).catch((err: unknown) => {
      captureError(err, { action: `${action}.popupFallback` });
    });
  }
}

/**
 * Leave the route a popup should boot into, for the popup to read.
 *
 * ── Why the route has to travel ──────────────────────────────────────────────
 *
 * The popup reopens at whatever route it was last showing, and no API lets the
 * service worker address it. So "Create new snippet" landed on whichever snippet
 * the popup happened to be showing: the one menu item whose whole meaning is
 * *which* page to open, opening the page the user did not ask for. The route is
 * the fix, and `storage.session` is how it reaches the popup — the same channel
 * the context-menu draft already uses, and for the same reason.
 *
 * ── What the popup has to do with it ──────────────────────────────────────────
 *
 * Read `POPUP_VIEW_SESSION_KEY` on mount, navigate to it with `replace`, and
 * remove it — consuming it, so a pending request cannot fire on a later open.
 * The stored value is a router **path** (`/new`), not a URL fragment: handing
 * `"#/new"` to `navigate` lands on the not-found view, so the URL reads `#/new`
 * while nothing renders.
 * `Dashboard.tsx` does the same for the draft in its mount effect. Without that
 * reader the write here is inert and the popup keeps restoring its last route, so
 * the two belong in one change.
 *
 * A failure is reported rather than swallowed: the menu item would otherwise
 * quietly open the wrong page, which is exactly the bug this replaced.
 */
async function requestPopupView(route: string): Promise<void> {
  try {
    await browser.storage.session.set({ [POPUP_VIEW_SESSION_KEY]: route });
  } catch (err) {
    captureError(err, { action: "contextMenu.requestPopupView" });
  }
}

export default defineBackground(() => {
  initSentry("background");
  void setupBackgroundAlarms();

  // Dev-only: open the manual QA harness once per dev session.
  if ((import.meta.env.MODE as string) !== "production") {
    browser.storage.session
      .get(DEV_QA_OPENED_KEY)
      .then((result) => {
        if (result[DEV_QA_OPENED_KEY]) return;
        return browser.tabs
          .create({ url: DEV_QA_URL, active: true })
          .then(() =>
            browser.storage.session.set({ [DEV_QA_OPENED_KEY]: true })
          )
          .catch(() => {
            // Non-fatal: server may not be running yet.
          });
      })
      .catch(() => {
        // Non-fatal.
      });
  }

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

  browser.alarms.onAlarm.addListener((alarm) => {
    debugLog("background", "alarm:fired", { name: alarm.name }).catch(() => {});
    if (alarm.name === UPDATE_CHECK_ALARM_NAME) {
      debugLog("background", "update:check:start", {}).catch(() => {});
      checkForUpdate().catch((err: unknown) => {
        captureError(err, { action: "checkForUpdate.alarm" });
      });
    } else if (alarm.name === REVIEW_CHECK_ALARM_NAME) {
      shouldShowReviewPrompt()
        .then((shouldShow) => {
          if (!shouldShow) return;
          return setReviewPromptState("shown").then(() => {
            browser.notifications
              .create("clipio-review", {
                type: "basic",
                iconUrl: browser.runtime.getURL("/icon/128.png"),
                title: i18n.t("background.reviewPrompt.title"),
                message: i18n.t("background.reviewPrompt.message"),
              })
              .catch((err: unknown) => {
                captureError(err, { action: "reviewPrompt.notification" });
              });
          });
        })
        .catch((err: unknown) => {
          captureError(err, { action: "reviewPrompt.alarm" });
        });
    }
  });

  // ---------------------------------------------------------------------------
  // Update notification — fire a browser notification when a new version is found
  // ---------------------------------------------------------------------------
  // Watch for changes to latestVersionItem and show a notification when it
  // transitions from null → a release object.
  latestVersionItem.watch((newValue) => {
    if (!newValue) return;
    browser.notifications
      .create("clipio-update", {
        type: "basic",
        iconUrl: browser.runtime.getURL("/icon/128.png"),
        title: i18n.t("background.updateAvailable.title"),
        message: i18n.t("background.updateAvailable.message", [
          newValue.version,
        ]),
      })
      .catch((err: unknown) => {
        captureError(err, { action: "updateNotification.create" });
      });
  });

  browser.notifications.onClicked.addListener((notificationId) => {
    if (notificationId === "clipio-update") {
      latestVersionItem
        .getValue()
        .then((release) => {
          if (release?.htmlUrl) {
            // Re-validates before opening — this fires behind a system
            // notification the user trusts, so it is the highest-value place
            // for a tampered URL to land.
            openReleasePage(release.htmlUrl).catch((err: unknown) => {
              captureError(err, { action: "updateNotification.click" });
            });
          }
        })
        .catch((err: unknown) => {
          captureError(err, { action: "updateNotification.click" });
        });
    } else if (notificationId === "clipio-review") {
      const storeUrl = getStoreReviewUrl();
      browser.tabs.create({ url: storeUrl }).catch((err: unknown) => {
        captureError(err, { action: "reviewNotification.click" });
      });
      setReviewPromptState("rated").catch((err: unknown) => {
        captureError(err, { action: "reviewNotification.click" });
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Media blob → data URL bridge
  // ---------------------------------------------------------------------------
  // Content scripts in the isolated world see the PAGE's origin IndexedDB, not
  // the extension's. All media blobs are stored at the extension origin, so
  // every blob read crosses to here first.
  //
  // A missing entry throws `MediaNotFoundError` rather than answering with a null
  // data URL. The old response type had `dataUrl: string | null`, so "no such
  // media" and "the blob was unreadable" looked identical to the caller and
  // every reader had to branch on a sentinel. The content script now gets a
  // rejection it can name.
  onMessageFromSelf(MESSAGE.MEDIA_GET, async ({ data }) => {
    debugLog("background", "message:received", {
      type: MESSAGE.MEDIA_GET,
    }).catch(() => {});

    const { mediaId } = data;
    const entry = await getMedia(mediaId);
    if (!entry) throw new MediaNotFoundError(mediaId);

    try {
      return {
        dataUrl: await blobToDataUrl(entry.blob),
        alt: entry.alt ?? null,
      };
    } catch (err) {
      // An unreadable blob is our problem, not the caller's: it means the entry
      // in IndexedDB is corrupt. Report it and let the caller retry rather than
      // surfacing "no such image" to the user.
      captureError(err, { action: "mediaGetDataUrl", mediaId });
      throw err;
    }
  });

  // ---------------------------------------------------------------------------
  // On install / update
  // ---------------------------------------------------------------------------
  browser.runtime.onInstalled.addListener((details) => {
    // On first install: record the install timestamp for review-prompt
    // eligibility. Onboarding is now fully in-extension; the popup starts the
    // guided tour on first use and hands off to Options from there.
    if (details.reason === "install") {
      const installedAt = new Date().toISOString();
      extensionInstalledAtItem.setValue(installedAt).catch((err: unknown) => {
        captureError(err, { action: "onInstalled.recordInstalledAt" });
      });
    }

    // Redirect to a farewell / recovery reminder page when uninstalled.
    // Uses WXT_WEBSITE_URL (e.g. https://clipio.xyz) and the browser's UI
    // locale (en | es) to build a localised URL: /{locale}/uninstall
    {
      const websiteUrl = import.meta.env.WXT_WEBSITE_URL as string | undefined;
      if (websiteUrl) {
        const rawLocale =
          typeof browser.i18n?.getUILanguage === "function"
            ? browser.i18n.getUILanguage()
            : "en";
        void (async () => {
          try {
            // `buildUninstallUrl` derives the supported locale itself. A local
            // copy of that logic lived here and drifted the moment the helper
            // was extracted.
            await browser.runtime.setUninstallURL(
              buildUninstallUrl(websiteUrl, rawLocale)
            );
          } catch (err) {
            captureError(err, { action: "setUninstallUrl" });
          }
        })();
      }
    }

    // On extension update: clear the cached release *and* the throttle
    // timestamp. Clearing only the release left the new version invisible for
    // up to a day, because the checker saw a recent successful check and
    // refused to fetch again. Re-check immediately so the About panel and popup
    // banner react in this session rather than after the next restart.
    if (details.reason === "update") {
      void (async () => {
        await Promise.all([
          latestVersionItem.setValue(null),
          latestVersionCheckedAtItem.setValue(null),
        ]);
        await checkForUpdate();
      })().catch((err: unknown) => {
        captureError(err, { action: "onInstalled.refreshUpdateState" });
      });
      captureMessage("Extension updated", "info", {
        previousVersion: details.previousVersion,
      });
    }

    // Redirect to a farewell / recovery reminder page when uninstalled.
    // Uses WXT_WEBSITE_URL (e.g. https://clipio.xyz) and the browser's UI
    // locale (en | es) to build a localised URL: /{locale}/uninstall
    void registerContextMenus();
  });

  // ---------------------------------------------------------------------------
  // Context-menu click handler
  // ---------------------------------------------------------------------------
  /**
   * Run what a context-menu click means.
   *
   * The routing is `resolveContextMenuAction`; this is the doing. Split so the
   * table can be asserted exhaustively — it is a file nothing measured until now,
   * and one of its branches had already shipped broken.
   */
  browser.contextMenus.onClicked.addListener(async (info) => {
    let action: ContextMenuAction;
    try {
      action = resolveContextMenuAction({
        // Chrome types `menuItemId` as `string | number`; the ids are strings, and
        // a number cannot match any of them, so it resolves to `none` — which is
        // the right answer for an id this build does not know.
        menuItemId: String(info.menuItemId),
        selectionText: info.selectionText,
        pageUrl: info.pageUrl,
      });
    } catch (err) {
      // Only `hide-on-site` throws, on an unparseable page URL. Reported rather
      // than swallowed: the menu item would otherwise just never work, with no
      // sign of why.
      captureError(err, { action: "contextMenu.resolve" });
      return;
    }

    switch (action.kind) {
      case "none":
        return;

      case "save-selection": {
        try {
          // Stash the selected text so the popup can pre-fill the draft
          await contextMenuDraftItem.setValue(action.text);
          await browser.storage.session.remove(CONTEXT_MENU_DRAFT_SESSION_KEY);
        } catch (err) {
          captureError(err, { action: "saveSelection.persistDraft" });
          try {
            await browser.storage.session.set({
              [CONTEXT_MENU_DRAFT_SESSION_KEY]: action.text,
            });
          } catch (sessionErr) {
            captureError(sessionErr, { action: "saveSelection.sessionDraft" });
          }
        }

        await openPopupOrFallback("saveSelection");
        return;
      }

      case "create-snippet": {
        const route = popupRouteForAction(action);
        if (route === null) {
          // Unreachable while the table maps this action to a route, and the
          // point of reporting it is that a table edit which lost the mapping
          // would otherwise ship as a menu item that opens the last route the
          // popup happened to be showing — silent, and wrong.
          captureMessage(
            "create-snippet resolved to no popup route",
            "warning",
            {
              action: "createSnippet",
            }
          );
          return;
        }
        // Two paths, because this code controls one of them and not the other:
        // the popup surface is addressed through storage, the tab fallback
        // carries the route in its own URL.
        await requestPopupView(route);
        await openPopupOrFallback("createSnippet", popupHashRoute(route));
        return;
      }

      case "open-options": {
        // The route is named rather than left to the page's own redirect, so the
        // link says where it goes and the test can check it. `options.html` with no
        // hash was not a destination — it was a decision made somewhere this link
        // could not be checked, which is the same class of bug as `#feedback`.
        const optionsUrl = browser.runtime.getURL("/options.html");
        browser.tabs
          .create({ url: optionsUrl + OPTIONS_HOME_ROUTE })
          .catch((err: unknown) => {
            captureError(err, { action: "openOptions" });
          });
        return;
      }

      case "open-feedback": {
        const optionsUrl = browser.runtime.getURL("/options.html");
        browser.tabs
          .create({ url: optionsUrl + FEEDBACK_ROUTE })
          .catch((err: unknown) => {
            captureError(err, { action: "giveFeedback" });
          });
        return;
      }

      case "hide-on-site": {
        try {
          const current = await blockedSitesItem.getValue();
          await blockedSitesItem.setValue(
            addBlockedSite(current, action.hostname)
          );
        } catch (err) {
          captureError(err, { action: "hideOnSite" });
        }
        return;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Content-script cache refresh
  //
  // Also handles sign-out / sync-wipe detection, below.
  // ---------------------------------------------------------------------------

  /**
   * Coalescing handle for the cache refresh.
   *
   * `storage.sync` fires once per key, so a bulk import of hundreds of
   * snippets would otherwise trigger hundreds of full store reads.
   */
  let cacheRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  async function refreshContentScriptCacheFromSync(): Promise<void> {
    try {
      const snippets = await storageManager.getSnippets();
      await updateContentScriptCache(snippets);
      debugLog("storage", "cache:refreshFromSync", {
        count: snippets.length,
      }).catch(() => {});
    } catch (err) {
      // The cache write is best-effort and must never surface an error; the
      // content script will fall back to whatever it already had.
      console.warn("[Clipio] Failed to refresh content script cache:", err);
      captureError(err, { action: "cacheRefreshFromSync" });
    }
  }

  function scheduleCacheRefreshFromSync(): void {
    if (cacheRefreshTimer !== null) clearTimeout(cacheRefreshTimer);
    // Long enough to coalesce a burst of per-key events, short enough that a
    // user who just signed in does not have to wait to start typing.
    cacheRefreshTimer = setTimeout(() => {
      cacheRefreshTimer = null;
      void refreshContentScriptCacheFromSync();
    }, TIMING.CACHE_REFRESH_DEBOUNCE_MS);
  }

  // ---------------------------------------------------------------------------
  browser.storage.onChanged.addListener((changes, areaName) => {
    const reading = readSyncChange(changes as StorageChanges, areaName);

    // -----------------------------------------------------------------------
    // Refresh the content-script cache when sync gains or changes a snippet.
    //
    // The popup reads storage.sync directly, but the content script reads only
    // `local:cachedSnippets`, and the only thing that ever wrote it was
    // StorageManager.persistSnippets — i.e. a user action in the popup or the
    // options page.
    //
    // So whenever the browser populates storage.sync on its own — a Google
    // sign-in, or a sync from another device — no extension code runs, the
    // cache is never written, and the content script keeps serving whatever it
    // had. The user then sees their snippets listed in the popup and finds that
    // none of them will insert on any page, and that reloading the page does
    // not help because the reload re-reads the same stale cache.
    //
    // The background worker is the only context that both outlives a page and
    // can observe a sync-area change, so it is where this belongs.
    if (needsCacheRefresh(reading)) {
      scheduleCacheRefreshFromSync();
    }

    if (!reading.likelySignOut) return;

    const msg = `[Clipio] ${
      reading.removedKeys
    } sync keys removed at once — possible sign-out`;
    console.warn(msg);
    captureMessage("Sync storage wipe detected", "warning", {
      wipedKeyCount: reading.removedKeys,
    });
    syncDataLostItem.setValue(true).catch((err: unknown) => {
      captureError(err, { action: "syncDataLostFlag" });
    });
  });
});
