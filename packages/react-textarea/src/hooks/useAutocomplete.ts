import { useCallback, useMemo, useRef, useState } from "react";
import { AutocompleteConfig } from "../components/copilot-textarea/copilot-textarea";
import { CustomEditor } from "../types/custom-editor";
import { BasePoint, Descendant, Transforms } from "slate";
import { Debouncer } from "../lib/debouncer";
import { getTextAroundCursor } from "../lib/getTextAroundCursor";
import {
  EditorAutocompleteState,
  areEqual_autocompleteState,
} from "../types/types";
import { nullableCompatibleEqualityCheck } from "../lib/utils";

export interface AutocompleteSuggestion {
  text: string;
  point: BasePoint;
}

export interface UseAutocompleteResult {
  currentAutocompleteSuggestion: AutocompleteSuggestion | null;
  onChangeHandler: (editor: CustomEditor) => void;
}

export function useAutocomplete(
  autocompleteConfig: AutocompleteConfig
): UseAutocompleteResult {
  const [previousAutocompleteState, setPreviousAutocompleteState] =
    useState<EditorAutocompleteState | null>(null);

  const [currentAutocompleteSuggestion, setCurrentAutocompleteSuggestion] =
    useState<AutocompleteSuggestion | null>(null);

  const awaitForAndAppendSuggestion: (
    editorAutocompleteState: EditorAutocompleteState,
    abortSignal: AbortSignal
  ) => Promise<void> = useCallback(
    async (
      editorAutocompleteState: EditorAutocompleteState,
      abortSignal: AbortSignal
    ) => {
      const suggestion = await autocompleteConfig.autocomplete(
        editorAutocompleteState.textBeforeCursor,
        editorAutocompleteState.textAfterCursor,
        abortSignal
      );

      // We'll assume for now that the autocomplete function might or might not respect the abort signal.
      if (!suggestion || abortSignal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      setCurrentAutocompleteSuggestion({
        text: suggestion,
        point: editorAutocompleteState.cursorPoint,
      });
    },
    [autocompleteConfig.autocomplete, setCurrentAutocompleteSuggestion]
  );

  const debouncedFunction = useMemo(
    () =>
      new Debouncer<[editorAutocompleteState: EditorAutocompleteState]>(
        autocompleteConfig.debounceTime
      ),
    [autocompleteConfig.debounceTime]
  );

  const onChange = useCallback(
    (editor: CustomEditor) => {
      const newEditorState = getTextAroundCursor(editor);
      const editorStateHasChanged = !nullableCompatibleEqualityCheck(
        areEqual_autocompleteState,
        previousAutocompleteState,
        newEditorState
      );
      setPreviousAutocompleteState(newEditorState);

      // if no change, do nothing
      if (!editorStateHasChanged) {
        return;
      }

      // if change, then first null out the current suggestion
      setCurrentAutocompleteSuggestion(null);

      // then try to get a new suggestion, debouncing to avoid too many requests while typing
      if (newEditorState) {
        debouncedFunction.debounce(awaitForAndAppendSuggestion, newEditorState);
      } else {
        debouncedFunction.cancel();
      }
    },
    [
      previousAutocompleteState,
      setPreviousAutocompleteState,
      debouncedFunction,
      awaitForAndAppendSuggestion,
      setCurrentAutocompleteSuggestion,
    ]
  );

  return {
    currentAutocompleteSuggestion,
    onChangeHandler: onChange,
  };
}
