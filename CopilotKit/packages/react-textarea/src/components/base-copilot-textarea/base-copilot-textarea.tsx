import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Descendant, Editor } from "slate";
import { Editable, Slate } from "slate-react";
import { twMerge } from "tailwind-merge";
import { useAutosuggestions } from "../../hooks/base-copilot-textarea-implementation/use-autosuggestions";
import { useCopilotTextareaEditor } from "../../hooks/base-copilot-textarea-implementation/use-copilot-textarea-editor";
import { usePopulateCopilotTextareaRef } from "../../hooks/base-copilot-textarea-implementation/use-populate-copilot-textarea-ref";
import {
  getFullEditorTextWithNewlines,
  getTextAroundCollapsedCursor,
} from "../../lib/get-text-around-cursor";
import { addAutocompletionsToEditor } from "../../lib/slatejs-edits/add-autocompletions";
import { clearAutocompletionsFromEditor } from "../../lib/slatejs-edits/clear-autocompletions";
import { replaceEditorText } from "../../lib/slatejs-edits/replace-text";
import {
  BaseAutosuggestionsConfig,
  defaultBaseAutosuggestionsConfig,
} from "../../types/base";
import { AutosuggestionState } from "../../types/base/autosuggestion-state";
import { BaseCopilotTextareaProps } from "../../types/base/base-copilot-textarea-props";
import "./base-copilot-textarea.css";
import { HoveringToolbar } from "../hovering-toolbar/hovering-toolbar";
import { makeRenderElementFunction } from "./render-element";
import { makeRenderPlaceholderFunction } from "./render-placeholder";
import { useAddBrandingCss } from "./use-add-branding-css";
import {
  HoveringEditorProvider,
  useHoveringEditorContext,
} from "../hovering-toolbar/hovering-editor-provider";
import { EditableProps } from "slate-react/dist/components/editable";
import {
  CopilotTextareaApiConfig,
  Generator_InsertionSuggestion,
} from "../../types/base/autosuggestions-bare-function";

export interface HTMLCopilotTextAreaElement extends HTMLElement {
  value: string;
  focus: () => void;
  blur: () => void;
}

const BaseCopilotTextareaWithHoveringContext = React.forwardRef(
  (
    props: BaseCopilotTextareaProps,
    ref: React.Ref<HTMLCopilotTextAreaElement>
  ): JSX.Element => {
    const autosuggestionsConfig: BaseAutosuggestionsConfig = {
      ...defaultBaseAutosuggestionsConfig,
      ...props.autosuggestionsConfig,
    };

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

    const {
      isDisplayed: hoveringEditorIsDisplayed,
      setIsDisplayed: setHoveringEditorIsDisplayed,
    } = useHoveringEditorContext();

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
      autosuggestionsConfig.apiConfig.autosuggestionsFunction,
      insertText,
      autosuggestionsConfig.disableWhenEmpty,
      autosuggestionsConfig.disabled || hoveringEditorIsDisplayed // disable autosuggestions when the hovering editor is displayed
    );

    const onKeyDownHandlerForHoveringEditor = useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        // if command-k, toggle the hovering editor
        if (event.key === "k" && event.metaKey) {
          event.preventDefault();
          setHoveringEditorIsDisplayed(!hoveringEditorIsDisplayed);
        }
      },
      [hoveringEditorIsDisplayed, setHoveringEditorIsDisplayed]
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

    const suggestionStyleAugmented: React.CSSProperties = useMemo(() => {
      return {
        fontStyle: "italic",
        color: "gray",
        ...props.suggestionsStyle,
      };
    }, [props.suggestionsStyle]);

    const renderElementMemoized = useMemo(() => {
      return makeRenderElementFunction(suggestionStyleAugmented);
    }, [suggestionStyleAugmented]);

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

    // separate into TextareaHTMLAttributes<HTMLDivElement> and CopilotTextareaProps
    const {
      placeholderStyle,
      value,
      onValueChange,
      autosuggestionsConfig: autosuggestionsConfigFromProps,
      className,
      onChange,
      onKeyDown,
      disableBranding,
      ...propsToForward
    } = props;

    useAddBrandingCss(suggestionStyleAugmented, disableBranding);
    usePopulateCopilotTextareaRef(editor, ref);

    const moddedClassName = (() => {
      const baseClassName = "copilot-textarea";
      const brandingClass = disableBranding ? "no-branding" : "with-branding";
      const defaultTailwindClassName = "bg-white overflow-y-auto resize-y";
      const mergedClassName = twMerge(
        defaultTailwindClassName,
        className ?? ""
      );
      return `${baseClassName} ${brandingClass} ${mergedClassName}`;
    })();

    return (
      <Slate
        editor={editor}
        initialValue={initialValue}
        onChange={(value) => {
          const newEditorState = getTextAroundCollapsedCursor(editor);

          const fullEditorText = newEditorState
            ? newEditorState.textBeforeCursor + newEditorState.textAfterCursor
            : getFullEditorTextWithNewlines(editor); // we don't double-parse the editor. When `newEditorState` is null, we didn't parse the editor yet.

          setLastKnownFullEditorText(fullEditorText);
          onChangeHandlerForAutocomplete(newEditorState);

          props.onValueChange?.(fullEditorText);
          props.onChange?.(makeSemiFakeReactTextAreaEvent(fullEditorText));
        }}
      >
        <HoveringToolbar apiConfig={autosuggestionsConfig.apiConfig} />
        <Editable
          renderElement={renderElementMemoized}
          renderPlaceholder={renderPlaceholderMemoized}
          onKeyDown={(event) => {
            onKeyDownHandlerForHoveringEditor(event); // forward the event for internal use
            onKeyDownHandlerForAutocomplete(event); // forward the event for internal use
            props.onKeyDown?.(event); // forward the event for external use
          }}
          className={moddedClassName}
          {...propsToForward}
        />
      </Slate>
    );
  }
);

// Consumers of <textarea> expect a `onChange: (React.ChangeEvent<HTMLTextAreaElement>) => void` event handler to be passed in.
// This is *extremely* common, and we want to support it.
//
// We can't support the full functionality, but in 99% of cases, the consumer only cares about the `event.target.value` property --
// that's how they get the new value of the textarea.
//
// So, the tradeoff we are making is minimizing compiler complaint, with a small chance of runtime error.
// The alternative would be defining a different onChange entrypoint (we actually do have that in `onValueChange`),
// And starting to explain subtleties to users the moment they try to use the component for the first time for very basic functionality.
//
// If this proves problematic, we can always revisit this decision.
function makeSemiFakeReactTextAreaEvent(
  currentText: string
): React.ChangeEvent<HTMLTextAreaElement> {
  return {
    target: {
      value: currentText,
      type: "copilot-textarea",
    },
    currentTarget: {
      value: currentText,
      type: "copilot-textarea",
    },
  } as React.ChangeEvent<HTMLTextAreaElement>;
}

export const BaseCopilotTextarea = React.forwardRef(
  (
    props: BaseCopilotTextareaProps,
    ref: React.Ref<HTMLCopilotTextAreaElement>
  ): JSX.Element => {
    return (
      <HoveringEditorProvider>
        <BaseCopilotTextareaWithHoveringContext {...props} ref={ref} />
      </HoveringEditorProvider>
    );
  }
);
