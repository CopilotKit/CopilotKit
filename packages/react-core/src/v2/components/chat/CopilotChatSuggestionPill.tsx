import React from "react";
import { Loader2 } from "lucide-react";
import { CopilotStyle } from "../../styles/copilot-style";

export interface CopilotChatSuggestionPillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Optional icon to render on the left side when not loading. */
  icon?: React.ReactNode;
  /** Whether the pill should display a loading spinner. */
  isLoading?: boolean;
}

const suggestionPillCss = /* css */ `
:where(.cpk-suggestion-pill) {
  display: inline-flex;
  height: 1.75rem;
  align-items: center;
  gap: 0.25rem;
  border: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
  border-radius: calc(infinity * 1px);
  background-color: var(--background);
  padding-inline: 0.625rem;
  font-size: 11px;
  line-height: 1;
  color: var(--foreground);
  cursor: pointer;
  pointer-events: auto;
  transition-property: color, background-color, border-color;
  transition-duration: 150ms;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}
@media (hover: hover) {
  :where(.cpk-suggestion-pill:hover) {
    background-color: color-mix(in oklab, var(--accent) 60%, transparent);
  }
}
:where(.cpk-suggestion-pill:focus-visible) {
  outline: none;
  box-shadow:
    0 0 0 2px var(--background),
    0 0 0 4px var(--ring);
}
:where(.cpk-suggestion-pill:disabled) {
  cursor: not-allowed;
  background-color: var(--background);
  color: var(--muted-foreground);
}
:where(.cpk-suggestion-pill-icon) {
  display: flex;
  width: 0.875rem;
  height: 0.875rem;
  align-items: center;
  justify-content: center;
  color: var(--muted-foreground);
}
:where(.cpk-suggestion-pill-spinner) {
  width: 100%;
  height: 100%;
  animation: cpk-spin 1s linear infinite;
}
:where(.cpk-suggestion-pill-label) {
  white-space: nowrap;
  font-weight: 500;
  line-height: 1;
}
@media (width >= 40rem) {
  :where(.cpk-suggestion-pill) {
    height: 2rem;
    gap: 0.375rem;
    padding-inline: 0.75rem;
    font-size: 0.75rem;
  }
  :where(.cpk-suggestion-pill-icon) {
    width: 1rem;
    height: 1rem;
  }
}
`;

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
      <CopilotStyle id="suggestion-pill" css={suggestionPillCss} />
      {isLoading ? (
        <span className="cpk-suggestion-pill-icon">
          <Loader2 className="cpk-suggestion-pill-spinner" aria-hidden="true" />
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
