import { useRef, useState } from "react";
import {
  AutocompleteConfig,
  CustomEditor,
} from "../components/copilot-textarea/copilot-textarea";
import { Descendant, Transforms } from "slate";

export function useAutocomplete(
  autocompleteConfig: AutocompleteConfig
): (editor: CustomEditor, newValue: string) => void {
  const [timer, setTimer] = useState<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const appendSuggestion = async (
    editor: CustomEditor,
    text: string,
    abortSignal: AbortSignal
  ) => {
    const suggestion = await autocompleteConfig.autocomplete(text, abortSignal);

    // We'll assume for now that the autocomplete function might or might not respect the abort signal.
    if (!suggestion || abortSignal.aborted) {
      return;
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

  const onChange = (editor: CustomEditor, newValue: string) => {
    if (timer) clearTimeout(timer);

    // If there's an ongoing autocomplete request, abort it
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }

    setTimer(
      setTimeout(async () => {
        controllerRef.current = new AbortController();

        try {
          await appendSuggestion(
            editor,
            newValue,
            controllerRef.current.signal
          );
        } catch (error: any) {
          if (error.name === "AbortError") {
            console.log("Autocomplete request was aborted");
          } else {
            console.error("Error during autocomplete:", error);
          }
        }
      }, autocompleteConfig.debounceTime || defaultDebounceTime)
    );
  };

  return onChange;
}

const defaultDebounceTime = 2;
