import { useEffect } from "react";
import { uiFontItem } from "@/storage/items";
import { UI_FONT_ATTRIBUTE, normalizeUiFont, type UiFont } from "@/lib/ui-font";
import { captureError } from "@/lib/sentry";

/**
 * Applies the interface font choice to the document.
 *
 * Deliberately not a context: nothing in the tree needs to *read* the current
 * font, they just need it painted. A provider would re-render the whole options
 * page on every change for no consumer, whereas writing one attribute repaints
 * without touching React at all.
 *
 * Storage is the source of truth and is watched, so a change made in the popup
 * or restored from a sync peer is reflected without a reload. The registry entry
 * therefore stays a plain `select` with no `entry.id === "font"` special-casing
 * in SettingControl, unlike `theme`.
 *
 * spec: specs/ui-font.spec.md
 */
export function FontProvider() {
  useEffect(() => {
    const apply = (font: UiFont) => {
      document.documentElement.setAttribute(UI_FONT_ATTRIBUTE, font);
    };

    // Read first, then paint. Until the read resolves the document keeps
    // whatever --font-ui declares by default (Inter), so there is no flash of a
    // wrong font — at worst a brief moment of the default for a non-Inter user.
    uiFontItem
      .getValue()
      .then((stored) => {
        const font = normalizeUiFont(stored);

        // Self-heal: storage can hold a value from a hand edit, a restored
        // backup or a build with different options. Writing the normalisation
        // back means a corrupt value stops being re-read on every page load
        // instead of lingering forever.
        if (font !== stored) {
          uiFontItem
            .setValue(font)
            .catch((error) =>
              captureError(error, { action: "FontProvider.heal" })
            );
        }

        apply(font);
      })
      .catch((error) => {
        // Storage unavailable (extension context invalidated). Leave the
        // default attribute in place rather than tearing down the tree.
        captureError(error, { action: "FontProvider.load" });
        apply(normalizeUiFont(undefined));
      });

    const unwatch = uiFontItem.watch((stored) =>
      apply(normalizeUiFont(stored))
    );

    return () => unwatch();
  }, []);

  return null;
}
