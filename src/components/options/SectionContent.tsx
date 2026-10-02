/**
 * Bespoke per-section content.
 *
 * Split in two because the order matters: `SectionContent` renders above the
 * registry rows, `SectionFooter` below them. The debug log has to sit *after*
 * the switch that turns it on — showing an empty log box above the toggle that
 * enables it asks the user to interpret a panel they have not switched on yet.
 *
 * Only the parts of a section that are *not* a simple preference live here:
 * the blocked-site list, the storage meter, the media library, the health
 * check and the debug log. Everything else is a `SettingControl`.
 *
 * spec: specs/options-redesign.spec.md
 */

import { BlockedSitesPanel } from "./settings/panels/BlockedSitesPanel";
import { StoragePanel } from "./settings/panels/StoragePanel";
import { DiagnosticsPanel } from "./settings/panels/DiagnosticsPanel";
import { DebugLogPanel } from "./settings/panels/DebugLogPanel";
import { LibraryPanel } from "./settings/panels/LibraryPanel";
import { ImagesPanel } from "./settings/panels/ImagesPanel";
import { AboutPanel } from "./settings/panels/AboutPanel";
import type { SectionId } from "./settings/registry";

export function SectionContent({ section }: { section: SectionId }) {
  switch (section) {
    case "blocked-sites":
      return <BlockedSitesPanel />;
    case "storage":
      return <StoragePanel />;
    case "diagnostics":
      return <DiagnosticsPanel />;
    case "library":
      return <LibraryPanel />;
    case "images":
      return <ImagesPanel />;
    case "about":
      return <AboutPanel />;
    case "expansion":
    case "appearance":
      return null;
  }
}

/** Rendered after the registry rows. */
export function SectionFooter({ section }: { section: SectionId }) {
  if (section === "diagnostics") return <DebugLogPanel />;
  return null;
}