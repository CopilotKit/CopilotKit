import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Northstar star brand mark: a rounded-square badge (primary background,
 * white filled star) with an optional "Northstar AI CRM" wordmark.
 * When `collapsed` is true only the badge renders (for the collapsed nav rail).
 */
export function Logo({
  collapsed = false,
  className,
}: {
  collapsed?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        aria-hidden
        className="grid h-7 w-7 shrink-0 place-items-center rounded-[0.5rem] bg-primary text-primary-foreground shadow-sm"
      >
        <Star className="h-4 w-4" fill="currentColor" strokeWidth={1.5} />
      </span>
      {!collapsed && (
        <span className="text-base font-semibold tracking-tight">
          Northstar AI CRM
        </span>
      )}
    </div>
  );
}
