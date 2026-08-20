/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-ui — RenderSuggestionsList:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import { Suggestion } from "./Suggestion";
import { RenderSuggestionsListProps } from "./props";

export function Suggestions({
  suggestions,
  onSuggestionClick,
  isLoading,
}: RenderSuggestionsListProps) {
  return (
    <div className="suggestions">
      {suggestions.map((suggestion, index) => (
        <Suggestion
          key={index}
          title={suggestion.title}
          message={suggestion.message}
          partial={suggestion.isLoading ?? suggestion.partial ?? isLoading}
          className={suggestion.className}
          onClick={() => onSuggestionClick(suggestion.message)}
        />
      ))}
    </div>
  );
}
