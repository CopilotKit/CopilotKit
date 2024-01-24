// This example is for an Editor with `ReactEditor` and `HistoryEditor`
import React from "react";
import { useMakeStandardAutosuggestionFunction } from "../../hooks/make-autosuggestions-function/use-make-standard-autosuggestions-function";
import { HTMLCopilotTextAreaElement } from "../../types";
import { BaseCopilotTextareaProps } from "../../types/base/base-copilot-textarea-props";
import {
  AutosuggestionsConfig,
  defaultAutosuggestionsConfig,
} from "../../types/autosuggestions-config";
import { BaseCopilotTextarea } from "../base-copilot-textarea/base-copilot-textarea";
import { useMakeStandardInsertionOrEditingFunction } from "../../hooks/make-autosuggestions-function/use-make-standard-insertion-function";
import merge from "lodash.merge";
import { AutosuggestionsConfigUserSpecified } from "../../types/autosuggestions-config/autosuggestions-config-user-specified";

// Like the base copilot textarea props,
// but with baseAutosuggestionsConfig replaced with autosuggestionsConfig.
export interface CopilotTextareaProps
  extends Omit<BaseCopilotTextareaProps, "baseAutosuggestionsConfig"> {
  autosuggestionsConfig: AutosuggestionsConfigUserSpecified;
}

/**
 * A copilot textarea that uses the standard autosuggestions function.
 */
export const CopilotTextarea = React.forwardRef(
  (props: CopilotTextareaProps, ref: React.Ref<HTMLCopilotTextAreaElement>) => {
    // separate the AutosuggestionsConfigUserSpecified from the rest of the props
    const { autosuggestionsConfig: autosuggestionsConfigUserSpecified, ...forwardedProps } = props;

    const autosuggestionsConfig: AutosuggestionsConfig = merge(
      defaultAutosuggestionsConfig,
      autosuggestionsConfigUserSpecified,
    );

    const autosuggestionsFunction = useMakeStandardAutosuggestionFunction(
      autosuggestionsConfig.textareaPurpose,
      autosuggestionsConfig.contextCategories,
      autosuggestionsConfig.chatApiConfigs.suggestionsApiConfig,
    );

    const insertionOrEditingFunction = useMakeStandardInsertionOrEditingFunction(
      autosuggestionsConfig.textareaPurpose,
      autosuggestionsConfig.contextCategories,
      autosuggestionsConfig.chatApiConfigs.insertionApiConfig,
      autosuggestionsConfig.chatApiConfigs.editingApiConfig,
    );

    return (
      <>
        <BaseCopilotTextarea
          ref={ref}
          {...forwardedProps}
          baseAutosuggestionsConfig={{
            ...autosuggestionsConfig,
            apiConfig: {
              insertionOrEditingFunction: insertionOrEditingFunction,
              autosuggestionsFunction: autosuggestionsFunction,
            },
          }}
        />
      </>
    );
  },
);
