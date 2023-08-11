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
  const controllerRef = useRef<AbortController | null>(null);

  const appendSuggestion = (text: string) => {
    // // We'll assume for now that the autocomplete function might or might not respect the abort signal.
    // const suggestion = await autocompleteConfig.autocomplete(
    //   text,
    //   controllerRef.current?.signal
    // );
    // // Only append the suggestion if an abort has not been signaled.
    // if (suggestion && !controllerRef.current?.signal.aborted) {
    //   Transforms.insertText(editor, suggestion);
    // }

    if (text.endsWith("hello")) {
      const editorPosition = editor.selection;
      Transforms.insertFragment(editor, [
        {
          type: "suggestion",
          children: [
            {
              text: "world",
            },
          ],
        },
      ]);

      // restore cursor position
      if (editorPosition) {
        editor.selection = editorPosition;
      }
    } else {
      console.log("text is", text, "no suggestion");
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    appendSuggestion(editorToText(editor));

    // if (timer) clearTimeout(timer);

    // // If there's an ongoing autocomplete request, abort it
    // if (controllerRef.current) {
    //   controllerRef.current.abort();
    //   controllerRef.current = null;
    // }

    // setTimer(
    //   setTimeout(async () => {
    //     controllerRef.current = new AbortController();

    //     try {
    //       await appendSuggestion(editorToText(editor));
    //     } catch (error: any) {
    //       if (error.name === "AbortError") {
    //         console.log("Autocomplete request was aborted");
    //       } else {
    //         console.error("Error during autocomplete:", error);
    //       }
    //     }
    //   }, autocompleteConfig.debounceTime || defaultDebounceTime)
    // );
  };

  return handleKeyDown;
}

const defaultDebounceTime = 2;
