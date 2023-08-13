import { useRef, useState } from "react";
import {
  AutocompleteConfig,
  CustomEditor,
} from "../components/copilot-textarea/copilot-textarea";
import { Descendant, Transforms } from "slate";
import { Debouncer } from "../lib/debouncer";

export function useAutocomplete(
  autocompleteConfig: AutocompleteConfig
): (editor: CustomEditor, textBefore: string, textAfter: string) => void {
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

  const debouncedFunction = new Debouncer(
    awaitForAndAppendSuggestion,
    autocompleteConfig.debounceTime
  );

  const onChange = (
    editor: CustomEditor,
    textBefore: string,
    textAfter: string
  ) => {
    debouncedFunction.debounce(editor, textBefore, textAfter);
  };

  return onChange;
}
