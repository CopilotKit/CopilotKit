// This example is for an Editor with `ReactEditor` and `HistoryEditor`
import { Descendant, Editor } from "slate";
import { Editable, RenderPlaceholderProps, Slate } from "slate-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
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
import { makeRenderPlaceholderFunction } from "./render-placeholder";
import { getFullEditorTextWithNewlines, getTextAroundCursor } from "../../lib/get-text-around-cursor";

export interface CopilotTextareaProps {
  className?: string;
  placeholder?: string;
  placeholderStyle?: React.CSSProperties;
  value?: string;
  onChange?: (value: string) => void;
  autosuggestionsConfig: Partial<AutosuggestionsConfig>;
}

export function CopilotTextarea(props: CopilotTextareaProps): JSX.Element {
  const autosuggestionsConfig: AutosuggestionsConfig = {
    ...defaultAutosuggestionsConfig,
    ...props.autosuggestionsConfig,
  };

  const valueOnInitialRender = useMemo(() => props.value ?? "", []);
  const initialValue: Descendant[] = useMemo(() => {
    return [
      {
        type: "paragraph",
        children: [{ text: valueOnInitialRender }],
      },
    ];
  }, [valueOnInitialRender]);

  const editor = useCopilotTextareaEditor();
  const autosuggestionsFunction = useMakeAutosuggestionFunction(
    autosuggestionsConfig.textareaPurpose,
    autosuggestionsConfig.apiEndpoint,
    autosuggestionsConfig.makeSystemMessage,
    autosuggestionsConfig.fewShotMessages,
    autosuggestionsConfig.contextCategories,
    autosuggestionsConfig.disableWhenEmpty
  );

  const insertText = useCallback(
    (autosuggestion: AutosuggestionState) => {
      Editor.insertText(editor, autosuggestion.text, {
        at: autosuggestion.point,
      });
    },
    [editor]
  );
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

  const renderElementMemoized = useCallback(renderElement, []);
  const renderPlaceholderMemoized = useMemo(() => {
    // For some reason slateJS specifies a top value of 0, which makes for strange styling. We override this here.
    const placeholderStyleSlatejsOverrides: React.CSSProperties = {
      top: undefined,
    };

    const placeholderStyleAugmented: React.CSSProperties = {
      ...placeholderStyleSlatejsOverrides,
      ...props.placeholderStyle,
    };

    return makeRenderPlaceholderFunction(placeholderStyleAugmented);
  }, [props.placeholderStyle]);

  return (
    // Add the editable component inside the context.
    <Slate
      editor={editor}
      initialValue={initialValue}
      onChange={(value) => {
        const newEditorState = getTextAroundCursor(editor)

        const fullEditorText = newEditorState
        ? newEditorState.textBeforeCursor + newEditorState.textAfterCursor
        : getFullEditorTextWithNewlines(editor); // we don't double-parse the editor. When `newEditorState` is null, we didn't parse the editor yet.

        setLastKnownFullEditorText(fullEditorText);
        onChangeHandlerForAutocomplete(newEditorState);
        props.onChange?.(fullEditorText);
      }}
    >
      <Editable
        className={props.className}
        placeholder={props.placeholder}
        renderElement={renderElementMemoized}
        renderPlaceholder={renderPlaceholderMemoized}
        onKeyDown={onKeyDownHandlerForAutocomplete}
      />
    </Slate>
  );
}
