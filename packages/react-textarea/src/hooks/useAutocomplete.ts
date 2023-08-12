import { useRef, useState } from "react";
import {
  AutocompleteConfig,
  CustomEditor,
} from "../components/copilot-textarea/copilot-textarea";
import { Descendant, Transforms } from "slate";
import { Debouncer } from "../lib/debouncer";

export function useAutocomplete(
  autocompleteConfig: AutocompleteConfig
): (editor: CustomEditor, newValue: string) => void {
  const awaitForAndAppendSuggestion = async (
    editor: CustomEditor,
    text: string,
    abortSignal: AbortSignal
  ) => {
    const suggestion = await autocompleteConfig.autocomplete(text, abortSignal);

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
          children: [
            {
              text: suggestion,
            },
          ],
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

  const debouncedFunction = new Debouncer(
    awaitForAndAppendSuggestion,
    autocompleteConfig.debounceTime
  );

  const onChange = (editor: CustomEditor, newValue: string) => {
    debouncedFunction.debounce(editor, newValue);
  };

  return onChange;
}
