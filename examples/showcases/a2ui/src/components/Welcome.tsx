import type { CopilotChatSuggestionViewProps } from "@copilotkit/react-core/v2";
import { forwardRef } from "react";
import type { ReactElement } from "react";
import { DISCLAIMER, STARTERS } from "../lib/starters";
import { StarterCarousel } from "./StarterCarousel";

/** The chat's welcome screen: one question, the composer, and the starters. */
export function Welcome({
  input,
  suggestionView,
}: {
  input: ReactElement;
  suggestionView: ReactElement;
}) {
  return (
    <div className="welcome">
      <div className="welcome__inner">
        <h1 className="welcome__title">What would you like to understand?</h1>
        <div className="welcome__input">{input}</div>
        {suggestionView}
        <p className="welcome__note">{DISCLAIMER}</p>
      </div>
    </div>
  );
}

/**
 * CopilotChat's suggestion view, as the starter carousel. CopilotChat hands
 * it the configured starters and the handler that sends one.
 */
export const StarterSuggestions = forwardRef<
  HTMLDivElement,
  CopilotChatSuggestionViewProps
>(function StarterSuggestions({ suggestions, onSelectSuggestion }, ref) {
  const starters = suggestions.map((suggestion, index) => {
    const starter = STARTERS.find((s) => s.title === suggestion.title);
    return {
      title: suggestion.title,
      icon: starter?.icon ?? "compass",
      view: starter?.view ?? "",
      pick: () => onSelectSuggestion?.(suggestion, index),
    };
  });
  return <StarterCarousel ref={ref} starters={starters} />;
});
