"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/utils";

function Switch({
  className,
  checked,
  onCheckedChange,
  disabled,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  /*
   * The on/off appearance is derived from the `checked` prop in JS rather than
   * from a `data-[checked]:` CSS variant.
   *
   * Base UI emits a bare `data-checked` attribute, so the Radic-style
   * `data-[state=checked]:` this component originally used never matched at
   * all — the switch was permanently drawn in its "off" colours while
   * `aria-checked` said otherwise. Correcting that to `data-[checked]:` still
   * did not paint: the generated rule
   * (`.data-\[checked\]\:bg-primary[data-checked]`) matched the live element
   * yet the computed background stayed `var(--input)`.
   *
   * Deriving the classes from the prop removes the dependency on variant
   * generation entirely, and is verifiable in a unit test without a browser.
   */
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "group relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
        className
      )}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg",
          "transition-transform duration-200",
          checked ? "translate-x-4" : "translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };