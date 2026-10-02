/**
 * Images — the media library.
 *
 * Split out of Library: the media list is a management surface with its own
 * storage meter and per-row actions, and burying it under import/export made
 * both harder to find.
 *
 * spec: specs/options-redesign.spec.md
 */

import { ImagesSection } from "@/components/options/ImagesSection";

export function ImagesPanel() {
  return (
    <div className="mb-6" data-testid="panel-images">
      <ImagesSection />
    </div>
  );
}
