import { useState } from "react";
import { Globe } from "lucide-react";

import { Icon } from "@/components/ui/icon";
import { getFaviconDomain } from "@/lib/blocked-sites";
import { cn } from "@/lib/utils";

/**
 * Favicon for a blocked-site entry.
 *
 * The domain is derived on every render so the same component can preview what
 * the user is typing. A failed fetch is remembered by domain, not by a bare
 * boolean: typing a new hostname must retry instead of staying on the globe.
 */
export function SiteFavicon({
  hostname,
  className,
}: {
  hostname: string;
  className?: string;
}) {
  const domain = getFaviconDomain(hostname);
  const [failedDomain, setFailedDomain] = useState<string | null>(null);
  const failed = domain !== null && failedDomain === domain;

  if (!domain || failed) {
    return (
      <Icon icon={Globe} className={cn("text-muted-foreground", className)} />
    );
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      alt=""
      width={24}
      height={24}
      className={cn("size-6 shrink-0 rounded", className)}
      onError={() => setFailedDomain(domain)}
    />
  );
}
