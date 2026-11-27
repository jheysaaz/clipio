import { Info } from "lucide-react";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function InfoTooltip({ text }: { text: string }) {
  const id = `info-tooltip-${text.slice(0, 10).replace(/\s+/g, "-")}`;

  return (
    <TooltipProvider>
      <Tooltip>
        {/* Accessible name lives on the trigger, not the icon (lucide a11y guide). */}
        <TooltipTrigger
          type="button"
          aria-label={text}
          aria-describedby={id}
          className="rounded-full text-muted-foreground cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Icon icon={Info} />
        </TooltipTrigger>
        <TooltipContent id={id} role="tooltip">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
