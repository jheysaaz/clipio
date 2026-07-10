import { MessageSquareText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";

const SECTION_TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  snippets: "Snippets",
  appearance: "Appearance",
  images: "Images",
  advanced: "Advanced",
};

export function SiteHeader({
  activeSection,
  onFeedback,
}: {
  activeSection: string;
  onFeedback: () => void;
}) {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b bg-background/95 px-4 backdrop-blur-sm supports-backdrop-filter:bg-background/60">
      <SidebarTrigger />
      <div className="flex-1">
        <h1 className="text-sm font-semibold">
          {SECTION_TITLES[activeSection]}
        </h1>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onFeedback}
        aria-label="Feedback"
      >
        <MessageSquareText className="size-4" strokeWidth={1.5} />
      </Button>
    </header>
  );
}
