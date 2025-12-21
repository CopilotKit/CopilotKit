import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CopilotChatSuggestionPillProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Optional icon to render on the left side when not loading. */
  icon?: React.ReactNode;
  /** Whether the pill should display a loading spinner. */
  isLoading?: boolean;
}

const baseClasses =
  "group inline-flex h-7 sm:h-8 items-center gap-1 sm:gap-1.5 rounded-full border border-border/60 bg-background px-2.5 sm:px-3 text-[11px] sm:text-xs leading-none text-foreground transition-colors cursor-pointer hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:bg-background disabled:hover:text-muted-foreground pointer-events-auto";

const labelClasses = "whitespace-nowrap font-medium leading-none";

export const CopilotChatSuggestionPill = React.forwardRef<
  HTMLButtonElement,
  CopilotChatSuggestionPillProps
>(function CopilotChatSuggestionPill(
  { className, children, icon, isLoading, type, ...props },
  ref
) {
  const showIcon = !isLoading && icon;

  return (
    <button
      ref={ref}
      data-slot="suggestion-pill"
      className={cn(baseClasses, className)}
      type={type ?? "button"}
      aria-busy={isLoading || undefined}
      disabled={isLoading || props.disabled}
      {...props}
    >
      {isLoading ? (
        <span className="flex h-3.5 sm:h-4 w-3.5 sm:w-4 items-center justify-center text-muted-foreground">
          <Loader2 className="h-3.5 sm:h-4 w-3.5 sm:w-4 animate-spin" aria-hidden="true" />
        </span>
      ) : (
        showIcon && (
          <span className="flex h-3.5 sm:h-4 w-3.5 sm:w-4 items-center justify-center text-muted-foreground">{icon}</span>
        )
      )}
      <span className={labelClasses}>{children}</span>
    </button>
  );
});

CopilotChatSuggestionPill.displayName = "CopilotChatSuggestionPill";

export default CopilotChatSuggestionPill;
