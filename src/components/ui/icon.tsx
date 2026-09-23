import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ICON_SIZE, ICON_STROKE } from "@/lib/icons";

/**
 * `<Icon>` — the single sanctioned way to render an inline lucide icon.
 *
 * Exactly two patterns exist in this codebase:
 *
 *   1. Render:     `<Icon icon={Settings} size="lg" stroke="emphasis" />`
 *   2. Pass around: `import type { LucideIcon }` + `icon: LucideIcon` prop
 *                   (data arrays such as nav items or slash-menu commands),
 *                   rendered through `<Icon>` at the call site.
 *
 * Direct rendering of lucide components
 * (`<Settings className="h-4 w-4" strokeWidth={1.5} />`) is forbidden.
 *
 * Guarantees on every render:
 *   - `aria-hidden="true"` — icons are decorative; accessible names belong
 *     on the wrapper button (`aria-label` or `sr-only` text), never here.
 *   - `shrink-0` — icons never compress in flex rows.
 *   - one `ICON_SIZE`-derived class — the only sizing mechanism; also makes
 *     shadcn's `[&_svg:not([class*='size-'])]:size-4` fallback skip us.
 *   - stroke from `ICON_STROKE` — 1.5 default, 2 only via `stroke="emphasis"`,
 *     2.5 only via `strokeWidth={ICON_STROKE.micro}` (10px micro-icons).
 *
 * `className` may add color/animation/spacing, or override size only for the
 * documented non-square exception (GripVertical drag handle: `className="h-8 w-3"`).
 */
interface IconProps {
  icon: LucideIcon;
  size?: keyof typeof ICON_SIZE;
  /** "default" = 1.5, "emphasis" = 2 (close / formatting / active overlays). */
  stroke?: "default" | "emphasis";
  /** Escape hatch: ONLY valid with `ICON_STROKE.micro` (2.5) on 10px micro-icons. */
  strokeWidth?: number;
  className?: string;
}

export function Icon({
  icon: LucideIcon,
  size = "md",
  stroke = "default",
  strokeWidth,
  className,
}: IconProps) {
  return (
    <LucideIcon
      className={cn("shrink-0", ICON_SIZE[size], className)}
      strokeWidth={strokeWidth ?? ICON_STROKE[stroke]}
      aria-hidden="true"
    />
  );
}
