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
import { InsertionsApiConfig } from "../../types/autosuggestions-config/insertions-api-config";
import { SuggestionsApiConfig } from "../../types/autosuggestions-config/suggestions-api-config";

export interface AutosuggestionsConfigUserSpecified
  extends Partial<Omit<AutosuggestionsConfig, "chatApiConfigs">> {
  chatApiConfigs: {
    suggestionsApiConfig?: Partial<SuggestionsApiConfig>;
    insertionApiConfig?: Partial<InsertionsApiConfig>;
  };
}

// Like the base copilot textarea props,
// but with baseAutosuggestionsConfig replaced with autosuggestionsConfig.
export interface CopilotTextareaProps
  extends Omit<BaseCopilotTextareaProps, "baseAutosuggestionsConfig"> {
  autosuggestionsConfig: Partial<AutosuggestionsConfigUserSpecified> & {
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
      autosuggestionsConfig.chatApiConfigs.suggestionsApiConfig
    );

    const insertionFunction = useMakeStandardInsertionFunction(
      autosuggestionsConfig.textareaPurpose,
      autosuggestionsConfig.externalContextCategories,
      autosuggestionsConfig.chatApiConfigs.insertionApiConfig
    );

    return (
      <>
        <BaseCopilotTextarea
          ref={ref}
          {...props}
          baseAutosuggestionsConfig={{
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
