import { LayoutDashboard, FileText, Palette, Images, Code } from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "snippets", label: "Snippets", icon: FileText },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "images", label: "Images", icon: Images },
  { id: "advanced", label: "Advanced", icon: Code },
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
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={activeSection === item.id}
                      onClick={() => onNavigate(item.id)}
                    >
                      <Icon className="size-4 shrink-0" strokeWidth={1.5} />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
