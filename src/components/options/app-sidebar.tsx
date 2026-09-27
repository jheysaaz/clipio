import { i18n } from "#i18n";
import { LayoutDashboard, FileText, Palette, Images, Code } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Icon } from "@/components/ui/icon";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";

interface NavItem {
  id: string;
  /**
   * A locale key, resolved with `i18n.t` at render time.
   *
   * These were hardcoded English strings ("Dashboard", "Snippets", …) while
   * `options.nav.*` existed in both en.yml and es.yml and was read by nobody —
   * so the sidebar was English for a Spanish user even though the translation
   * was sitting right there, translated and maintained. That pair of facts is
   * what the unused-key check in scripts/check-locales.mjs now reports.
   *
   * spec: specs/i18n.spec.md
   */
  labelKey: NavLabelKey;
  icon: LucideIcon;
}

/**
 * The nav labels, as a literal union.
 *
 * `i18n.t` is typed against the keys WXT generates from en.yml, so it rejects a
 * bare `string`. Spelling the union out satisfies that and makes a renamed or
 * deleted key a **compile error** rather than a silently untranslated label —
 * which is how these five were hardcoded English in the first place.
 */
type NavLabelKey =
  | "options.nav.dashboard"
  | "options.nav.snippets"
  | "options.nav.appearance"
  | "options.nav.images"
  | "options.nav.advanced";

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", labelKey: "options.nav.dashboard", icon: LayoutDashboard },
  { id: "snippets", labelKey: "options.nav.snippets", icon: FileText },
  { id: "appearance", labelKey: "options.nav.appearance", icon: Palette },
  { id: "images", labelKey: "options.nav.images", icon: Images },
  { id: "advanced", labelKey: "options.nav.advanced", icon: Code },
];

export function AppSidebar({
  activeSection,
  onNavigate,
}: {
  activeSection: string;
  onNavigate: (section: string) => void;
}) {
  return (
    <Sidebar variant="inset" collapsible="none">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <img src="/icon/128.png" alt="Clipio" className="h-6 w-6 shrink-0" />
          <span className="truncate text-sm font-semibold">Clipio</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label={i18n.t("options.a11y.optionsNav")}>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => {
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        data-testid={`options-nav-${item.id}`}
                        isActive={activeSection === item.id}
                        onClick={() => onNavigate(item.id)}
                        aria-current={
                          activeSection === item.id ? "page" : undefined
                        }
                      >
                        <Icon icon={item.icon} size="lg" />
                        <span>{i18n.t(item.labelKey)}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>
    </Sidebar>
  );
}
