/**
 * A routed options section: heading, panel, setting rows, footer.
 *
 * The section is derived from the matched path rather than passed in. That is
 * what lets every section route share this one component instead of each
 * wrapping it in a closure of its own — eight identical arrow functions, eight
 * identical entry points, and a route module whose only "logic" was component
 * bindings.
 *
 * The fallback is `library` because that is where a path with no recognisable
 * section should land *if it renders at all* — but in practice it does not: an
 * unknown path is answered by the root route's `notFoundComponent`, which is the
 * point of having one.
 */

import { Outlet, useRouterState } from "@tanstack/react-router";

import { i18n } from "#i18n";
import {
  rowsForSection,
  SECTION_LABEL_KEYS,
  type SectionId,
} from "@/components/options/settings/registry";
import {
  SectionContent,
  SectionFooter,
} from "@/components/options/SectionContent";
import { SettingControl } from "@/components/options/settings/SettingControl";
import { sectionIdFromPath } from "@/routes/options";

export function SectionView() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const section: SectionId = sectionIdFromPath(pathname) ?? "library";

  const rows = rowsForSection(section);

  return (
    <>
      <header className="mb-1">
        <h1 className="text-lg font-semibold text-foreground">
          {i18n.t(SECTION_LABEL_KEYS[section])}
        </h1>
      </header>

      <SectionContent section={section} />

      {rows.length > 0 && (
        <div data-testid={`section-${section}-rows`}>
          {rows.map((entry) => (
            <SettingControl key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      <SectionFooter section={section} />

      {/*
        Where a sub-route renders — `/library/import` brings the import card into
        view, `/about/feedback` opens the form. Without this an `Outlet` the child
        route mounts nowhere: the parent matched, the child counted as rendered,
        and nothing appeared.
      */}
      <Outlet />
    </>
  );
}
