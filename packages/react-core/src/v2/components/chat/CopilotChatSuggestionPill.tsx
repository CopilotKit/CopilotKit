import React, { useId } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

export interface CopilotChatSuggestionPillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Optional icon to render on the left side when not loading. */
  icon?: React.ReactNode;
  /** Whether the pill should display a loading spinner. */
  isLoading?: boolean;
  /**
   * `"pill"` (default) is a compact chip. `"card"` is a larger tile with the
   * label as a header and `description` as its body, used on welcome screens.
   */
  appearance?: "pill" | "card";
  /** Body text shown under the label when `appearance` is `"card"`. */
  description?: React.ReactNode;
}

const baseClasses =
  "group cpk:inline-flex cpk:h-8 cpk:items-center cpk:gap-1.5 cpk:rounded-full cpk:border cpk:border-input cpk:bg-card cpk:px-3.5 cpk:text-[13px] cpk:leading-none cpk:text-foreground/80 cpk:shadow-[0_1px_2px_0_rgb(0_0_0/0.03)] cpk:transition-colors cpk:cursor-pointer cpk:hover:bg-accent cpk:hover:text-foreground cpk:focus-visible:outline-none cpk:focus-visible:ring-2 cpk:focus-visible:ring-ring cpk:focus-visible:ring-offset-2 cpk:focus-visible:ring-offset-background cpk:disabled:cursor-not-allowed cpk:disabled:text-muted-foreground cpk:disabled:hover:bg-card cpk:disabled:hover:text-muted-foreground cpk:pointer-events-auto";

const labelClasses = "cpk:whitespace-nowrap cpk:font-medium cpk:leading-none";

const cardClasses =
  "group cpk:flex cpk:h-full cpk:w-full cpk:min-w-0 cpk:flex-col cpk:items-start cpk:gap-1 cpk:rounded-2xl cpk:border cpk:border-input cpk:bg-card cpk:px-3.5 cpk:py-3 cpk:text-left cpk:shadow-[0_1px_2px_0_rgb(0_0_0/0.03)] cpk:transition-colors cpk:cursor-pointer cpk:hover:bg-accent cpk:focus-visible:outline-none cpk:focus-visible:ring-2 cpk:focus-visible:ring-ring cpk:focus-visible:ring-offset-2 cpk:focus-visible:ring-offset-background cpk:disabled:cursor-not-allowed cpk:disabled:opacity-60 cpk:disabled:hover:bg-card cpk:pointer-events-auto";

export const CopilotChatSuggestionPill = React.forwardRef<
  HTMLButtonElement,
  CopilotChatSuggestionPillProps
>(function CopilotChatSuggestionPill(
  {
    className,
    children,
    icon,
    isLoading,
    appearance = "pill",
    description,
    type,
    ...props
  },
  ref,
) {
  const showIcon = !isLoading && icon;
  const cardId = useId();

  if (appearance === "card") {
    // Named by its title alone, like a pill; the body is its description.
    const titleId = `${cardId}-title`;
    const descriptionId = description ? `${cardId}-description` : undefined;
    return (
      <button
        ref={ref}
        data-copilotkit
        data-testid="copilot-suggestion"
        data-slot="suggestion-card"
        className={cn(cardClasses, className)}
        type={type ?? "button"}
        aria-busy={isLoading || undefined}
        // aria-labelledby would override an app's own aria-label.
        aria-labelledby={props["aria-label"] ? undefined : titleId}
        aria-describedby={descriptionId}
        disabled={isLoading || props.disabled}
        {...props}
      >
        <span className="cpk:flex cpk:w-full cpk:min-w-0 cpk:items-center cpk:gap-1.5 cpk:text-sm cpk:font-medium cpk:leading-snug cpk:text-foreground">
          {isLoading ? (
            <Loader2
              className="cpk:size-3.5 cpk:shrink-0 cpk:animate-spin cpk:text-muted-foreground"
              aria-hidden="true"
            />
          ) : (
            showIcon && (
              <span className="cpk:flex cpk:size-3.5 cpk:shrink-0 cpk:items-center cpk:justify-center cpk:text-muted-foreground">
                {icon}
              </span>
            )
          )}
          <span id={titleId} className="cpk:truncate">
            {children}
          </span>
        </span>
        {description && (
          <span
            id={descriptionId}
            className="cpk:line-clamp-2 cpk:text-[13px] cpk:leading-snug cpk:text-muted-foreground"
          >
            {description}
          </span>
        )}
      </button>
    );
  }

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
        <span className="cpk:flex cpk:size-3.5 cpk:items-center cpk:justify-center cpk:text-muted-foreground">
          <Loader2
            className="cpk:size-3.5 cpk:animate-spin"
            aria-hidden="true"
          />
        </span>
      ) : (
        showIcon && (
          <span className="cpk:flex cpk:size-3.5 cpk:items-center cpk:justify-center cpk:text-muted-foreground">
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
