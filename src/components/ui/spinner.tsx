import type * as React from "react";
import { LoaderCircleIcon } from "lucide-react";

import { i18n } from "#i18n";
import { cn } from "@/lib/utils";

/**
 * The shadcn Spinner is an icon-placeholder wrapper. This project renders
 * lucide directly here because the status icon needs its own accessible name;
 * `<Icon>` is aria-hidden by design and cannot expose one.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <LoaderCircleIcon
      data-slot="spinner"
      role="status"
      aria-label={i18n.t("common.loading")}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
