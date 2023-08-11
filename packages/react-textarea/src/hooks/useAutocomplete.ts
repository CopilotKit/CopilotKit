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

  const appendSuggestion = async (text: string, abortSignal: AbortSignal) => {
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
              text: "world",
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

  const handleKeyDown = (event: React.KeyboardEvent) => {
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
            editorToText(editor),
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

  return handleKeyDown;
}

const defaultDebounceTime = 2;
