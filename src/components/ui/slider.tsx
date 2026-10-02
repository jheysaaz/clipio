"use client";

import * as React from "react";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";

import { cn } from "@/lib/utils";

/**
 * A single-thumb slider.
 *
 * The options page previously used a bare `<input type="range">`, which has no
 * themable track or thumb: it rendered as the platform default, ignored the
 * design tokens, and gave no hook for the focus ring. This wraps Base UI's
 * Slider (the same primitive family as Switch/Select) so it matches the rest of
 * the UI and is keyboard- and screen-reader-operable.
 *
 * spec: specs/options-redesign.spec.md
 */
function Slider({
  className,
  value,
  defaultValue,
  onValueChange,
  disabled,
  min = 0,
  max = 100,
  step = 1,
  "aria-label": ariaLabel,
  ...props
}: Omit<React.ComponentProps<typeof SliderPrimitive.Root>, "children"> & {
  "aria-label"?: string;
}) {
  return (
    <SliderPrimitive.Root
      className={cn(
        "flex w-full touch-none select-none items-center py-2",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
      {...props}
    >
      <SliderPrimitive.Control
        className={cn(
          "relative flex w-full touch-none select-none items-center py-2",
          "focus-visible:outline-none"
        )}
      >
        <SliderPrimitive.Track
          className={cn(
            "relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted",
            // Base UI reflects state on the control as a bare `data-checked`-style
            // attribute set; see the note in switch.tsx for why these classes
            // are derived in JS rather than from a data variant.
            disabled ? "opacity-50" : null
          )}
        >
          <SliderPrimitive.Indicator className="h-full rounded-full bg-primary" />
        </SliderPrimitive.Track>

        <SliderPrimitive.Thumb
          aria-label={ariaLabel}
          className={cn(
            "block size-4 rounded-full border-2 border-primary bg-background shadow-sm",
            "transition-[color,box-shadow] duration-150",
            "hover:ring-4 hover:ring-ring/20",
            "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/30"
          )}
        />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
