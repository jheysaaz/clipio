import { FLAGS } from "~/config/constants";
import { initSentry, captureMessage } from "~/lib/sentry";
import { registerSentryRelayListener } from "~/lib/sentry-relay";

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
      browser.storage.local.set({ [FLAGS.SYNC_DATA_LOST]: true });
    }
  });
});
