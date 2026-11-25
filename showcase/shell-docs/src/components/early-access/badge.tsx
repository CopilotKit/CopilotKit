import { Badge } from "@/components/ui/badge";
import { EARLY_ACCESS_LABEL } from "@/lib/early-access/channels";
import { cn } from "@/lib/cn";

/**
 * "Early access" beside a channel's name: a lilac outline pill, since brand
 * color marks things and never fills them. The sidebar's frontend picker
 * shows it on every docs page, so its words come from the small channel list
 * (src/lib/early-access/channels.ts), not the landing pages' copy.
 */
export function EarlyAccessBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-edge-action font-medium text-primary dark:border-brand-lilac/45",
        className,
      )}
    >
      {EARLY_ACCESS_LABEL}
    </Badge>
  );
}
