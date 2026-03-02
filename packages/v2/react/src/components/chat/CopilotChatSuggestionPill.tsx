import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CopilotChatSuggestionPillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Optional icon to render on the left side when not loading. */
  icon?: React.ReactNode;
  /** Whether the pill should display a loading spinner. */
  isLoading?: boolean;
}

const baseClasses =
  "group cpk:inline-flex cpk:h-7 cpk:sm:h-8 cpk:items-center cpk:gap-1 cpk:sm:gap-1.5 cpk:rounded-full cpk:border cpk:border-border/60 cpk:bg-background cpk:px-2.5 cpk:sm:px-3 cpk:text-[11px] cpk:sm:text-xs cpk:leading-none cpk:text-foreground cpk:transition-colors cpk:cursor-pointer cpk:hover:bg-accent/60 cpk:hover:text-foreground cpk:focus-visible:outline-none cpk:focus-visible:ring-2 cpk:focus-visible:ring-ring cpk:focus-visible:ring-offset-2 cpk:focus-visible:ring-offset-background cpk:disabled:cursor-not-allowed cpk:disabled:text-muted-foreground cpk:disabled:hover:bg-background cpk:disabled:hover:text-muted-foreground cpk:pointer-events-auto";

const labelClasses = "cpk:whitespace-nowrap cpk:font-medium cpk:leading-none";

export const CopilotChatSuggestionPill = React.forwardRef<
  HTMLButtonElement,
  CopilotChatSuggestionPillProps
>(function CopilotChatSuggestionPill(
  { className, children, icon, isLoading, type, ...props },
  ref,
) {
  const showIcon = !isLoading && icon;

  return (
    <button
      ref={ref}
      data-copilotkit
      data-testid="copilot-suggestion"
      data-slot="suggestion-pill"
      className={cn(baseClasses, className)}
      type={type ?? "button"}
      aria-busy={isLoading || undefined}
      disabled={isLoading || props.disabled}
      {...props}
    >
      {isLoading ? (
        <span className="cpk:flex cpk:h-3.5 cpk:sm:h-4 cpk:w-3.5 cpk:sm:w-4 cpk:items-center cpk:justify-center cpk:text-muted-foreground">
          <Loader2
            className="cpk:h-3.5 cpk:sm:h-4 cpk:w-3.5 cpk:sm:w-4 cpk:animate-spin"
            aria-hidden="true"
          />
        </span>
      ) : (
        showIcon && (
          <span className="cpk:flex cpk:h-3.5 cpk:sm:h-4 cpk:w-3.5 cpk:sm:w-4 cpk:items-center cpk:justify-center cpk:text-muted-foreground">
            {icon}
          </span>
        )
      )}
      <span className={labelClasses}>{children}</span>
    </button>
  );
});

CopilotChatSuggestionPill.displayName = "CopilotChatSuggestionPill";

export default CopilotChatSuggestionPill;
