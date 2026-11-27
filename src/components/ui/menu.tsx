import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The shared look for every in-app menu: a solid popover surface, a hairline
 * border, compact rows, and the same neutral hover/focus treatment. The code-
 * block language picker and the slash-command menu use it so they cannot drift
 * into two different visual languages.
 */
export const MENU_SURFACE_CLASS =
  "z-[70] flex w-auto min-w-[10rem] max-w-[13rem] flex-col overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden";

export const MenuSurface = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn(MENU_SURFACE_CLASS, className)} {...props} />
));
MenuSurface.displayName = "MenuSurface";

export const MenuItem = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
>(({ className, active, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    data-active={active || undefined}
    className={cn(
      "flex min-h-7 w-full items-center gap-2 rounded-md px-2.5 py-1 text-left text-ui-xs! text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[active]:bg-accent data-[active]:text-foreground disabled:pointer-events-none disabled:opacity-50",
      className
    )}
    {...props}
  />
));
MenuItem.displayName = "MenuItem";
