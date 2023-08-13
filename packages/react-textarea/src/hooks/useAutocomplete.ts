import { useCallback, useMemo, useRef, useState } from "react";
import {
  AutocompleteConfig,
  CustomEditor,
} from "../components/copilot-textarea/copilot-textarea";
import { Descendant, Transforms } from "slate";
import { Debouncer } from "../lib/debouncer";
import { getTextAroundCursor } from "../lib/getTextAroundCursor";

export function useAutocomplete(
  autocompleteConfig: AutocompleteConfig
): (editor: CustomEditor) => void {
  const [textBeforeCursor, setTextBeforeCursor] = useState("");
  const [textAfterCursor, setTextAfterCursor] = useState("");

  const awaitForAndAppendSuggestion = async (
    editor: CustomEditor,
    textBefore: string,
    textAfter: string,
    abortSignal: AbortSignal
  ) => {
    const suggestion = await autocompleteConfig.autocomplete(
      textBefore,
      textAfter,
      abortSignal
    );

    // We'll assume for now that the autocomplete function might or might not respect the abort signal.
    if (!suggestion || abortSignal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const editorPosition = editor.selection;

    Transforms.insertNodes(
      editor,
      [
        {
          type: "suggestion",
          inline: true,
          content: suggestion,
          children: [{ text: "" }],
        },
      ],
      {
        mode: "highest",
      }
    );

    // restore cursor position
    if (editorPosition) {
      editor.selection = editorPosition;
    }
  };

  const conditionallyAwaitForAndAppendSuggestion = useCallback(
    async (editor: CustomEditor, abortSignal: AbortSignal) => {
      const { before, after } = getTextAroundCursor(editor);
      if (before !== textBeforeCursor || after !== textAfterCursor) {
        setTextBeforeCursor(before);
        setTextAfterCursor(after);

        await awaitForAndAppendSuggestion(editor, before, after, abortSignal);
      }
    },
    [
      textBeforeCursor,
      textAfterCursor,
      setTextBeforeCursor,
      setTextAfterCursor,
      awaitForAndAppendSuggestion,
    ]
  );

  const debouncedFunction = useMemo(
    () =>
      new Debouncer<[editor: CustomEditor]>(autocompleteConfig.debounceTime),
    [autocompleteConfig.debounceTime]
  );

  const onChange = useCallback(
    (editor: CustomEditor) => {
      debouncedFunction.debounce(
        conditionallyAwaitForAndAppendSuggestion,
        editor
      );
    },
    [debouncedFunction, conditionallyAwaitForAndAppendSuggestion]
  );

  return onChange;
}
