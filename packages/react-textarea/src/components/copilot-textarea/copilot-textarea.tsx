// This example is for an Editor with `ReactEditor` and `HistoryEditor`
import { Descendant, Editor } from "slate";
import { Editable, Slate } from "slate-react";
import { useCallback, useEffect, useRef } from "react";
import { useAutosuggestions } from "../../hooks/use-autosuggestions";
import { AutosuggestionState } from "../../types/autosuggestion-state";
import { clearAutocompletionsFromEditor } from "../../lib/slatejs-edits/clear-autocompletions";
import { addAutocompletionsToEditor } from "../../lib/slatejs-edits/add-autocompletions";
import { useCopilotTextareaEditor } from "../../hooks/use-copilot-textarea-editor";
import { renderElement } from "./render-element";
import { useMakeAutosuggestionFunction } from "../../hooks";
import {
  AutosuggestionsConfig,
  defaultAutosuggestionsConfig,
} from "../../types/autosuggestions-config";

export interface CopilotTextareaProps {
  className?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  autosuggestionsConfig: Partial<AutosuggestionsConfig>;
}

export function CopilotTextarea(props: CopilotTextareaProps): JSX.Element {
  const initialValue: Descendant[] = [
    {
      type: "paragraph",
      children: [{ text: "" }],
    },
  ];

  const autosuggestionsConfig: AutosuggestionsConfig = {
    ...defaultAutosuggestionsConfig,
    ...props.autosuggestionsConfig,
  };

  const editor = useCopilotTextareaEditor();
  const autosuggestionsFunction = useMakeAutosuggestionFunction(
    autosuggestionsConfig.apiEndpoint,
    autosuggestionsConfig.makeSystemMessage,
    autosuggestionsConfig.fewSuggestionsMessages,
    autosuggestionsConfig.contextCategories
  );

  const insertText = useCallback(
    (autosuggestion: AutosuggestionState) => {
      Editor.insertText(editor, autosuggestion.text, {
        at: autosuggestion.point,
      });
    },
    [editor]
  );

  const renderElementMemoized = useCallback(renderElement, []);
  const {
    currentAutocompleteSuggestion,
    onChangeHandler: onChangeHandlerForAutocomplete,
    onKeyDownHandler: onKeyDownHandlerForAutocomplete,
  } = useAutosuggestions(
    autosuggestionsConfig.debounceTime,
    autosuggestionsConfig.acceptAutosuggestionKey,
    autosuggestionsFunction,
    insertText
  );

  // sync autosuggestions state with the editor
  useEffect(() => {
    clearAutocompletionsFromEditor(editor);
    if (currentAutocompleteSuggestion) {
      addAutocompletionsToEditor(
        editor,
        currentAutocompleteSuggestion.text,
        currentAutocompleteSuggestion.point
      );
    }
  }, [currentAutocompleteSuggestion]);

  return (
    // Add the editable component inside the context.
    <Slate
      editor={editor}
      initialValue={initialValue}
      onChange={(value) => {
        onChangeHandlerForAutocomplete(editor);
      }}
    >
      <Editable
        className={props.className}
        renderElement={renderElementMemoized}
        onKeyDown={onKeyDownHandlerForAutocomplete}
      />
    </Slate>
  );
}
