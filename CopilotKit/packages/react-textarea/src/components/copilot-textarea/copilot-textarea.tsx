// This example is for an Editor with `ReactEditor` and `HistoryEditor`
import React from "react";
import { useMakeStandardAutosuggestionFunction } from "../../hooks/make-autosuggestions-function/use-make-standard-autosuggestions-function";
import { HTMLCopilotTextAreaElement } from "../../types";
import { BaseCopilotTextareaProps } from "../../types/base/base-copilot-textarea-props";
import {
  AutosuggestionsConfig,
  ChatlikeApiEndpoint,
  defaultAutosuggestionsConfig,
} from "../../types/standard-autosuggestions";
import { BaseCopilotTextarea } from "../base-copilot-textarea/base-copilot-textarea";

export interface CopilotTextareaProps extends BaseCopilotTextareaProps {
  autosuggestionsConfig: Partial<AutosuggestionsConfig> & {
    textareaPurpose: string;
    apiEndpoint: ChatlikeApiEndpoint;
  };
}

export const CopilotTextarea = React.forwardRef(
  (
    props: CopilotTextareaProps,
    ref: React.Ref<HTMLCopilotTextAreaElement>
  ): JSX.Element => {
    const autosuggestionsConfig: AutosuggestionsConfig = {
      ...defaultAutosuggestionsConfig,
      ...props.autosuggestionsConfig,
    };

    const autosuggestionsFunction = useMakeStandardAutosuggestionFunction(
      autosuggestionsConfig.textareaPurpose,
      autosuggestionsConfig.apiEndpoint,
      autosuggestionsConfig.makeSystemPrompt,
      autosuggestionsConfig.fewShotMessages,
      autosuggestionsConfig.externalContextCategories,
      autosuggestionsConfig.forwardedParams
    );

    return (
      <>
        <BaseCopilotTextarea
          ref={ref}
          {...props}
          autosuggestionsConfig={autosuggestionsConfig}
          autosuggestionsFunction={autosuggestionsFunction}
        />
      </>
    );
  }
);
