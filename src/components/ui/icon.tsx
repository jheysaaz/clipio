import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface IconProps {
  icon: LucideIcon;
  size?: "sm" | "md" | "lg" | "xl";
  strokeWidth?: number;
  className?: string;
}

const sizeMap = {
  sm: "size-3",
  md: "size-3.5",
  lg: "size-4",
  xl: "size-5",
} as const;

const defaultStrokeWidth = 2;

export function Icon({
  icon: LucideIcon,
  size = "md",
  strokeWidth = defaultStrokeWidth,
  className,
}: IconProps) {
  return (
    <LucideIcon
      className={cn("shrink-0", sizeMap[size], className)}
      strokeWidth={strokeWidth}
      aria-hidden="true"
    />
  );
}
