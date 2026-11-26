import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * An action that reads as part of the sentence around it.
 *
 * These are buttons, not links: Undo and Retry change state and never navigate.
 * The underline is always visible so the affordance does not depend on hover.
 */
export function InlineAction({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      {...props}
      className={cn(
        "border-0 bg-transparent p-0 text-[length:inherit] text-primary underline underline-offset-4",
        "hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className
      )}
    />
  );
}
