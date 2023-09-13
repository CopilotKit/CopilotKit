// This example is for an Editor with `ReactEditor` and `HistoryEditor`
import React from "react";
import { useMakeStandardAutosuggestionFunction } from "../../hooks/make-autosuggestions-function/use-make-standard-autosuggestions-function";
import { HTMLCopilotTextAreaElement } from "../../types";
import { BaseCopilotTextareaProps } from "../../types/base/base-copilot-textarea-props";
import {
  AutosuggestionsConfig,
  ChatlikeApiEndpoint,
  defaultAutosuggestionsConfig,
} from "../../types/autosuggestions-config";
import { BaseCopilotTextarea } from "../base-copilot-textarea/base-copilot-textarea";
import { useMakeStandardInsertionFunction } from "../../hooks/make-autosuggestions-function/use-make-standard-insertion-function";
import merge from "lodash.merge";
import { AutosuggestionsConfigPartialOverrides } from "../../types/autosuggestions-config/autosuggestions-config";

export interface CopilotTextareaProps
  extends Omit<BaseCopilotTextareaProps, "autosuggestionsConfig"> {
  autosuggestionsConfig: Partial<AutosuggestionsConfigPartialOverrides> & {
    textareaPurpose: string;
  };
}

export const CopilotTextarea = React.forwardRef(
  (
    props: CopilotTextareaProps,
    ref: React.Ref<HTMLCopilotTextAreaElement>
  ): JSX.Element => {
    const autosuggestionsConfig: AutosuggestionsConfig = merge(
      defaultAutosuggestionsConfig,
      props.autosuggestionsConfig
    );

    const autosuggestionsFunction = useMakeStandardAutosuggestionFunction(
      autosuggestionsConfig.textareaPurpose,
      autosuggestionsConfig.externalContextCategories,
      autosuggestionsConfig.apiConfigs.suggestionsApiConfig
    );

    const insertionFunction = useMakeStandardInsertionFunction(
      autosuggestionsConfig.textareaPurpose,
      autosuggestionsConfig.externalContextCategories,
      autosuggestionsConfig.apiConfigs.insertionApiConfig
    );

    return (
      <>
        <BaseCopilotTextarea
          ref={ref}
          {...props}
          autosuggestionsConfig={{
            ...autosuggestionsConfig,
            apiConfig: {
              insertionSuggestionFunction: insertionFunction,
              autosuggestionsFunction: autosuggestionsFunction,
            },
          }}
        />
      </>
    );
  }
);
