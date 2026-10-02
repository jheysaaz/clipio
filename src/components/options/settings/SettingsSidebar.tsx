/**
 * Search-first sidebar for the options page.
 *
 * A pinned search field over a nav grouped by intent (Library / Behaviour /
 * Appearance / System). Typing filters the settings registry; the results
 * render each setting's live control, so a preference can be changed without
 * navigating to the section that holds it.
 *
 * `⌘K` / `Ctrl+K` focuses the field from anywhere on the page.
 *
 * spec: specs/options-redesign.spec.md
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Search,
  Command,
  Library,
  Images,
  Zap,
  Globe,
  Palette,
  Cloud,
  Code,
  Info,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { SidebarResizer } from "./SidebarResizer";
import { cn } from "@/lib/utils";
import { currentPlatform } from "@/lib/shortcuts";
import {
  SECTIONS,
  searchSettings,
  type GroupLabelKey,
  type SectionId,
  type SectionMeta,
  type SettingEntry,
} from "./registry";
import { i18n } from "#i18n";

const SECTION_ICONS: Record<string, LucideIcon> = {
  library: Library,
  images: Images,
  zap: Zap,
  globe: Globe,
  palette: Palette,
  cloud: Cloud,
  code: Code,
  info: Info,
};

export function SettingsSidebar({
  activeSection,
  onNavigate,
  query,
  onQueryChange,
  onPickSetting,
  width,
  onWidthChange,
}: {
  activeSection: SectionId;
  onNavigate: (section: SectionId) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onPickSetting: (entry: SettingEntry) => void;
  /** Current rail width in px; owned by OptionsPage so it can persist it. */
  width: number;
  onWidthChange: (next: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchSettings(query), [query]);
  const searching = query.trim().length > 0;
  const firstResult = results[0];

  // ⌘K / Ctrl+K focuses search. `/` is the secondary shortcut and is ignored
  // while the user is already typing in a field.
  const handleGlobalKey = useCallback((event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    const typing =
      target?.tagName === "INPUT" ||
      target?.tagName === "TEXTAREA" ||
      target?.isContentEditable;

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    if (event.key === "/" && !typing) {
      event.preventDefault();
      inputRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleGlobalKey);
    return () => document.removeEventListener("keydown", handleGlobalKey);
  }, [handleGlobalKey]);

  // Group sections by their heading so the nav renders "Behaviour" once with
  // Expansion and Blocked sites beneath it.
  const groups = useMemo(() => {
    const ordered: Array<{
      heading: GroupLabelKey | null;
      sections: SectionMeta[];
    }> = [];
    for (const section of SECTIONS) {
      const last = ordered[ordered.length - 1];
      if (last && last.heading === section.groupKey) {
        last.sections.push(section);
      } else {
        ordered.push({ heading: section.groupKey, sections: [section] });
      }
    }
    return ordered;
  }, []);

  return (
    <div
      // `select-none` on the whole rail: this is navigation chrome, and letting
      // a drag across it select label text makes it feel like broken document
      // content rather than a menu.
      className="relative flex h-full select-none flex-col border-r border-border bg-muted/20"
    >
      {/* Search */}
      <div className="px-3 pb-2 pt-3">
        <div className="relative">
          <Icon
            icon={Search}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onQueryChange("");
                e.currentTarget.blur();
                return;
              }
              // Enter opens the first match. Arrow keys are swallowed while
              // armed-typing rather than navigating, so a query is not lost to
              // a stray arrow press.
              if (e.key === "Enter" && firstResult) {
                e.preventDefault();
                onPickSetting(firstResult);
                return;
              }
              if (e.key === "ArrowDown" && firstResult) {
                // Move focus into the results so the whole flow is reachable
                // without a pointer.
                e.preventDefault();
                (
                  document.querySelector(
                    `[data-testid="option-setting-${firstResult.id}"]`
                  ) as HTMLElement | null
                )?.focus();
              }
            }}
            placeholder={i18n.t("options.search.placeholder")}
            aria-label={i18n.t("options.search.label")}
            data-testid="options-search"
            // `[&::-webkit-search-cancel-button]:appearance-none`:
            // `type="search"` gives the field a UA-supplied clear button. Chrome
            // renders it as a blue pill that ignores the theme entirely, so a
            // dark-mode options page showed a bright blue X. Clear is already
            // available from Escape and from selecting the text.
            className="h-9 border-border/80 bg-card pl-8 pr-14 text-sm shadow-xs placeholder:text-foreground/55 focus-visible:border-ring [user-select:none] [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
          />
          {/*
            Icon caps rather than the ⌘K / Ctrl K glyph string, matching the
            recorder. `text-foreground/70` not `text-muted-foreground`: muted on
            `bg-muted` at 10px measures 4.39:1, under the 4.5:1 WCAG AA floor.
            Caught by the axe scan in e2e/options.spec.ts.
          */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-foreground/70"
          >
            {isMacModifier() ? (
              <Icon icon={Command} className="size-2.5" />
            ) : (
              <span className="font-mono text-[9px] leading-none">Ctrl</span>
            )}
            <span className="font-mono text-[9px] leading-none">K</span>
          </span>
        </div>
      </div>

      <nav
        aria-label={i18n.t("options.a11y.optionsNav")}
        data-testid="options-nav"
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-4"
      >
        {/*
          While searching, the sidebar deliberately shows no list. The content
          pane already renders every match as a live row, and listing the same
          matches here would duplicate each setting's title in the same
          viewport — the redundancy this redesign set out to remove.
        */}
        {!searching &&
          groups.map((group) => (
            <div key={group.heading} className="mb-4 last:mb-0">
              {/*
                `font-normal` rather than `font-medium`: at 11px a 500 weight
                reads as bold and fights the section labels below it. The
                uppercase + tracking is what makes these read as headings, so
                the weight is dropped and the contrast carries the hierarchy.
              */}
              <p className="px-2 pb-1.5 text-[11px] font-normal uppercase tracking-[0.06em] text-muted-foreground">
                {group.heading ? i18n.t(group.heading) : ""}
              </p>
              <ul className="space-y-0.5">
                {group.sections.map((section) => {
                  const IconComponent = SECTION_ICONS[section.icon];
                  const active = activeSection === section.id;
                  return (
                    <li key={section.id}>
                      <button
                        data-testid={`options-nav-${section.id}`}
                        aria-current={active ? "page" : undefined}
                        onClick={() => onNavigate(section.id)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active
                            ? "bg-accent font-medium text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                        )}
                      >
                        {IconComponent && (
                          <Icon icon={IconComponent} size="lg" />
                        )}
                        <span className="truncate">
                          {i18n.t(section.labelKey)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
      </nav>

      <SidebarResizer
        width={width}
        onWidthChange={onWidthChange}
        ariaLabel={i18n.t("options.a11y.sidebarResizer")}
      />
    </div>
  );
}

/**
 * Whether to advertise the ⌘K hint. Shares `currentPlatform()` with the
 * recorder so the two can never disagree about which platform they are on.
 */
function isMacModifier(): boolean {
  return currentPlatform() === "mac";
}