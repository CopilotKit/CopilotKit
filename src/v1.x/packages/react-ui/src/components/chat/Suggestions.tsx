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
