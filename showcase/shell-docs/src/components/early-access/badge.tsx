import { Badge } from "@/components/ui/badge";
import { SHARED_EARLY_ACCESS_COPY } from "@/lib/early-access/copy";
import { cn } from "@/lib/cn";

/**
 * "Early access" beside a channel's name: a lilac outline pill, since brand
 * color marks things and never fills them.
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
      {SHARED_EARLY_ACCESS_COPY.eyebrow}
    </Badge>
  );
}
