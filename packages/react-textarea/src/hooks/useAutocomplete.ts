import { useRef, useState } from "react";
import {
  AutocompleteConfig,
  CustomEditor,
} from "../components/copilot-textarea/copilot-textarea";
import { Descendant, Transforms } from "slate";

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

type AsyncFunction<T extends any[]> = (
  ...args: [...T, AbortSignal]
) => Promise<void>;

class Debouncer<T extends any[]> {
  private timeoutId?: number;
  private activeAbortController?: AbortController;

  constructor(private func: AsyncFunction<T>, private wait: number) {}

  debounce = async (...args: T) => {
    // Abort the previous promise immediately
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = undefined;
    }

    if (this.timeoutId !== undefined) {
      clearTimeout(this.timeoutId);
    }

    this.timeoutId = setTimeout(async () => {
      try {
        this.activeAbortController = new AbortController();

        // Pass the signal to the async function, assuming it supports it
        await this.func(...args, this.activeAbortController.signal);

        this.activeAbortController = undefined;
      } catch (error: unknown) {
        if ((error as Error).name !== "AbortError") {
          console.error(error);
        }
      }
    }, this.wait);
  };
}
