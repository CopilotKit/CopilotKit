// This example is for an Editor with `ReactEditor` and `HistoryEditor`
import { Descendant, Editor } from "slate";
import { Editable, RenderPlaceholderProps, Slate } from "slate-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  TextareaHTMLAttributes,
} from "react";
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
import {
  getFullEditorTextWithNewlines,
  getTextAroundCursor,
} from "../../lib/get-text-around-cursor";
import { replaceEditorText } from "../../lib/slatejs-edits/replace-text";

export interface CopilotTextareaProps
  extends TextareaHTMLAttributes<HTMLDivElement> {
  placeholderStyle?: React.CSSProperties;
  value?: string;
  onValueChange?: (value: string) => void;
  autosuggestionsConfig: Partial<AutosuggestionsConfig>;
}

export function CopilotTextarea(props: CopilotTextareaProps): JSX.Element {
  const autosuggestionsConfig: AutosuggestionsConfig = {
    ...defaultAutosuggestionsConfig,
    ...props.autosuggestionsConfig,
  };

  // separate into TextareaHTMLAttributes<HTMLDivElement> and CopilotTextareaProps
  const {
    placeholderStyle,
    value,
    onValueChange,
    autosuggestionsConfig: autosuggestionsConfigFromProps,
    ...textareaLikeProps
  } = props;

  const valueOnInitialRender = useMemo(() => props.value ?? "", []);
  const [lastKnownFullEditorText, setLastKnownFullEditorText] =
    useState(valueOnInitialRender);

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

  // update the editor text, but only when the value changes from outside the component
  useEffect(() => {
    if (props.value === lastKnownFullEditorText) {
      return;
    }

    setLastKnownFullEditorText(props.value ?? "");
    replaceEditorText(editor, props.value ?? "");
  }, [props.value]);

  return (
    // Add the editable component inside the context.
    <Slate
      editor={editor}
      initialValue={initialValue}
      onChange={(value) => {
        const newEditorState = getTextAroundCursor(editor);

        const fullEditorText = newEditorState
          ? newEditorState.textBeforeCursor + newEditorState.textAfterCursor
          : getFullEditorTextWithNewlines(editor); // we don't double-parse the editor. When `newEditorState` is null, we didn't parse the editor yet.

        setLastKnownFullEditorText(fullEditorText);
        onChangeHandlerForAutocomplete(newEditorState);
        props.onValueChange?.(fullEditorText);
      }}
    >
      <Editable
        renderElement={renderElementMemoized}
        renderPlaceholder={renderPlaceholderMemoized}
        onKeyDown={onKeyDownHandlerForAutocomplete}
        {...textareaLikeProps}
      />
    </Slate>
  );
}
