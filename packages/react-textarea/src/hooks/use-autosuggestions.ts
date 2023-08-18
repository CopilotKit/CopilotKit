import { useCallback, useMemo, useRef, useState } from "react";
import { AutosuggestionsConfig } from "../types/autosuggestions-config";
import { CustomEditor } from "../types/custom-editor";
import { Descendant, Transforms } from "slate";
import { Debouncer } from "../lib/debouncer";
import { getTextAroundCursor } from "../lib/get-text-around-cursor";
import {
  EditorAutocompleteState,
  areEqual_autocompleteState,
} from "../types/editor-autocomplete-state";
import { nullableCompatibleEqualityCheck } from "../lib/utils";
import { AutosuggestionState } from "../types/autosuggestion-state";

export interface UseAutosuggestionsResult {
  currentAutocompleteSuggestion: AutosuggestionState | null;
  onChangeHandler: (newEditorState: EditorAutocompleteState | null) => void;
  onKeyDownHandler: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}

export type AutosuggestionsBareFunction = (
  textBefore: string,
  textAfter: string,
  abortSignal: AbortSignal
) => Promise<string>;

export function useAutosuggestions(
  debounceTime: number,
  acceptAutosuggestionKey: string,
  autosuggestionFunction: AutosuggestionsBareFunction,
  insertAutocompleteSuggestion: (suggestion: AutosuggestionState) => void,
  disableWhenEmpty: boolean
): UseAutosuggestionsResult {
  const [previousAutocompleteState, setPreviousAutocompleteState] =
    useState<EditorAutocompleteState | null>(null);

  const [currentAutocompleteSuggestion, setCurrentAutocompleteSuggestion] =
    useState<AutosuggestionState | null>(null);

  const awaitForAndAppendSuggestion: (
    editorAutocompleteState: EditorAutocompleteState,
    abortSignal: AbortSignal
  ) => Promise<void> = useCallback(
    async (
      editorAutocompleteState: EditorAutocompleteState,
      abortSignal: AbortSignal
    ) => {
      if (
        disableWhenEmpty &&
        editorAutocompleteState.textBeforeCursor === "" &&
        editorAutocompleteState.textAfterCursor === ""
      ) {
        return;
      }

      const suggestion = await autosuggestionFunction(
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
    [autosuggestionFunction, setCurrentAutocompleteSuggestion, disableWhenEmpty]
  );

  const debouncedFunction = useMemo(
    () =>
      new Debouncer<[editorAutocompleteState: EditorAutocompleteState]>(
        debounceTime
      ),
    [debounceTime]
  );

  const onChange = useCallback(
    (newEditorState: EditorAutocompleteState | null) => {
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

  const keyDownHandler = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (currentAutocompleteSuggestion) {
        if (event.key === acceptAutosuggestionKey) {
          event.preventDefault();
          insertAutocompleteSuggestion(currentAutocompleteSuggestion);
          setCurrentAutocompleteSuggestion(null);
        }
      }
    },
    [
      currentAutocompleteSuggestion,
      setCurrentAutocompleteSuggestion,
      insertAutocompleteSuggestion,
      acceptAutosuggestionKey,
    ]
  );

  return {
    currentAutocompleteSuggestion,
    onChangeHandler: onChange,
    onKeyDownHandler: keyDownHandler,
  };
}
