import { Badge } from "@/components/ui/badge";
import { EARLY_ACCESS_LABEL } from "@/lib/frontends";
import { cn } from "@/lib/cn";

/**
 * "Early access" beside the name of a frontend in early access, wherever its
 * row or card is drawn: a lilac outline pill, since brand color marks things
 * and never fills them. Its words come from the frontend list
 * (src/lib/frontends.ts), not the landing pages' copy.
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
