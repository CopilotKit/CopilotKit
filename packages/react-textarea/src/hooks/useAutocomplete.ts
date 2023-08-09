import { useRef, useState } from "react";
import {
  AutocompleteConfig,
  CustomEditor,
} from "../components/copilot-textarea/copilot-textarea";
import { Transforms } from "slate";
import { editorToText } from "../lib/editorToText";

export function useAutocomplete(
  editor: CustomEditor,
  autocompleteConfig: AutocompleteConfig
) {
  const [timer, setTimer] = useState<number | null>(null);
  const waitingForSuggestionRef = useRef(false);

  const appendSuggestion = (suggestion: string) => {
    Transforms.insertText(editor, suggestion);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (timer) clearTimeout(timer);

    waitingForSuggestionRef.current = false;

    setTimer(
      setTimeout(async () => {
        waitingForSuggestionRef.current = true;
        const suggestion = await autocompleteConfig.autocomplete(
          editorToText(editor)
        );
        if (waitingForSuggestionRef.current) {
          appendSuggestion(suggestion);
          waitingForSuggestionRef.current = false;
        }
      }, autocompleteConfig.debounceTime || 0)
    );
  };

  return handleKeyDown;
}
