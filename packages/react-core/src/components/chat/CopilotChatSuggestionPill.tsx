import React from "react";
import { CopilotIcon } from "../icons/CopilotIcon";

export interface CopilotChatSuggestionPillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Optional icon to render on the left side when not loading. */
  icon?: React.ReactNode;
  /** Whether the pill should display a loading spinner. */
  isLoading?: boolean;
}

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
      className={
        className ? `cpk-suggestion-pill ${className}` : "cpk-suggestion-pill"
      }
      type={type ?? "button"}
      aria-busy={isLoading || undefined}
      disabled={isLoading || props.disabled}
      {...props}
    >
      {isLoading ? (
        <span className="cpk-suggestion-pill-icon">
          <CopilotIcon
            name="Loader2"
            className="cpk-suggestion-pill-spinner"
            aria-hidden="true"
          />
        </span>
      ) : (
        showIcon && <span className="cpk-suggestion-pill-icon">{icon}</span>
      )}
      <span className="cpk-suggestion-pill-label">{children}</span>
    </button>
  );
});

CopilotChatSuggestionPill.displayName = "CopilotChatSuggestionPill";

export default CopilotChatSuggestionPill;
