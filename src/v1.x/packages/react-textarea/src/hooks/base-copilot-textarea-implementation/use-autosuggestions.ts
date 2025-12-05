import { useCallback, useEffect, useMemo, useState } from "react";
import { Debouncer } from "../../lib/debouncer";
import { nullableCompatibleEqualityCheck } from "../../lib/utils";
import { AutosuggestionsBareFunction } from "../../types/base";
import { AutosuggestionState } from "../../types/base/autosuggestion-state";
import {
  EditorAutocompleteState,
  areEqual_autocompleteState,
} from "../../types/base/editor-autocomplete-state";

export interface UseAutosuggestionsResult {
  currentAutocompleteSuggestion: AutosuggestionState | null;
  onChangeHandler: (newEditorState: EditorAutocompleteState | null) => void;
  onKeyDownHandler: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onTouchStartHandler: (event: React.TouchEvent<HTMLDivElement>) => void;
}

export function useAutosuggestions(
  debounceTime: number,
  shouldAcceptAutosuggestionOnKeyPress: (event: React.KeyboardEvent<HTMLDivElement>) => boolean,
  shouldAcceptAutosuggestionOnTouch: (event: React.TouchEvent<HTMLDivElement>) => boolean,
  autosuggestionFunction: AutosuggestionsBareFunction,
  insertAutocompleteSuggestion: (suggestion: AutosuggestionState) => void,
  disableWhenEmpty: boolean,
  disabled: boolean,
): UseAutosuggestionsResult {
  const [previousAutocompleteState, setPreviousAutocompleteState] =
    useState<EditorAutocompleteState | null>(null);

  const [currentAutocompleteSuggestion, setCurrentAutocompleteSuggestion] =
    useState<AutosuggestionState | null>(null);

  const awaitForAndAppendSuggestion: (
    editorAutocompleteState: EditorAutocompleteState,
    abortSignal: AbortSignal,
  ) => Promise<void> = useCallback(
    async (editorAutocompleteState: EditorAutocompleteState, abortSignal: AbortSignal) => {
      // early return if disabled
      if (disabled) {
        return;
      }

      if (
        disableWhenEmpty &&
        editorAutocompleteState.textBeforeCursor === "" &&
        editorAutocompleteState.textAfterCursor === ""
      ) {
        return;
      }

      // fetch the suggestion
      const suggestion = await autosuggestionFunction(editorAutocompleteState, abortSignal);

      // We'll assume for now that the autocomplete function might or might not respect the abort signal.
      if (!suggestion || abortSignal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      setCurrentAutocompleteSuggestion({
        text: suggestion,
        point: editorAutocompleteState.cursorPoint,
      });
    },
    [autosuggestionFunction, setCurrentAutocompleteSuggestion, disableWhenEmpty, disabled],
  );

  const debouncedFunction = useMemo(
    () => new Debouncer<[editorAutocompleteState: EditorAutocompleteState]>(debounceTime),
    [debounceTime],
  );

  // clean current state when unmounting or disabling
  useEffect(() => {
    return () => {
      debouncedFunction.cancel();
      setCurrentAutocompleteSuggestion(null);
    };
  }, [debouncedFunction, disabled]);

  const onChange = useCallback(
    (newEditorState: EditorAutocompleteState | null) => {
      const editorStateHasChanged = !nullableCompatibleEqualityCheck(
        areEqual_autocompleteState,
        previousAutocompleteState,
        newEditorState,
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
    ],
  );

  const keyDownOrTouchHandler = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
      if (currentAutocompleteSuggestion) {
        const shouldAcceptSuggestion =
          event.type === "touchstart"
            ? shouldAcceptAutosuggestionOnTouch(event as React.TouchEvent<HTMLDivElement>)
            : shouldAcceptAutosuggestionOnKeyPress(event as React.KeyboardEvent<HTMLDivElement>);

        if (shouldAcceptSuggestion) {
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
      shouldAcceptAutosuggestionOnKeyPress,
    ],
  );

  return {
    currentAutocompleteSuggestion,
    onChangeHandler: onChange,
    onKeyDownHandler: keyDownOrTouchHandler,
    onTouchStartHandler: keyDownOrTouchHandler,
  };
}
