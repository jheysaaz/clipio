import { useState } from "react";
import { Globe } from "lucide-react";
import { Icon } from "@/components/ui/icon";

export function SiteFavicon({ hostname }: { hostname: string }) {
  const domain = hostname.startsWith("*.") ? hostname.slice(2) : hostname;
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <Icon icon={Globe} className="text-muted-foreground" />;
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
      alt=""
      width={14}
      height={14}
      className="shrink-0 rounded-sm"
      onError={() => setFailed(true)}
    />
  );
}
