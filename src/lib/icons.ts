/**
 * Shared icon size and stroke constants — the single source of truth for
 * inline icon sizing and stroke width.
 *
 * Used exclusively by the `<Icon>` wrapper (`src/components/ui/icon.tsx`).
 * There is intentionally NO barrel re-export of lucide icon components here:
 * import icon components directly (`import { X } from "lucide-react"`) so
 * tree-shaking keeps working, then render them through `<Icon>`.
 */

/** Tailwind size classes, ascending. Tokens are the only sizing mechanism. */
export const ICON_SIZE = {
  xs: "size-2.5", // 10px — editor placeholders / micro status icons
  sm: "size-3", // 12px
  md: "size-3.5", // 14px — default
  lg: "size-4", // 16px
  xl: "size-5", // 20px
  "2xl": "size-6", // 24px
  "3xl": "size-8", // 32px — empty-state hero icons
} as const;

/**
 * Stroke widths collapse to two sanctioned values plus one exception:
 *
 * - `default` (1.5): everything — chrome, nav, info, actions.
 * - `emphasis` (2): explicit emphasized state only — close buttons,
 *   formatting toolbar, hover/active overlay controls. Opt in via the
 *   wrapper's `stroke="emphasis"` prop; never via ad hoc className.
 * - `micro` (2.5): EXCEPTION, 10px micro-icons only (editor placeholders
 *   and 10px status checks). Do NOT generalize to any other size.
 */
export const ICON_STROKE = {
  default: 1.5,
  emphasis: 2,
  micro: 2.5,
} as const;
