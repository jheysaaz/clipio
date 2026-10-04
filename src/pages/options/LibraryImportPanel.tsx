/**
 * `/library/import` — the Library section with the import/export panel brought
 * into view.
 *
 * The panel is part of the Library section either way; what this route adds is
 * *addressability*. A user arriving from the popup's empty state, or from a
 * link, should land looking at the importer rather than having to scroll to it.
 *
 * So it scrolls the panel into view and moves focus to it, and otherwise renders
 * nothing of its own — the section above it does the drawing. An empty element
 * that only repositions the page would be surprising; the alternative (a second
 * copy of the card) would be worse.
 */

import { useEffect, useRef } from "react";

/** Matches the `id` the Library panel puts on its import/export card. */
export const IMPORT_PANEL_ANCHOR = "import-export-panel";

export function LibraryImportPanel() {
  const requested = useRef(false);

  useEffect(() => {
    // Ref-guarded because this component stays mounted while the user moves
    // around inside `/library/import`, and yanking the page back to the panel on
    // every re-render would fight them.
    if (requested.current) return;
    requested.current = true;

    const target = document.getElementById(IMPORT_PANEL_ANCHOR);
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    // Focus moves too: a deep link that only scrolls leaves a keyboard or screen
    // reader user at the top of the document with no indication the page moved.
    target.focus({ preventScroll: true });
  }, []);

  return null;
}
