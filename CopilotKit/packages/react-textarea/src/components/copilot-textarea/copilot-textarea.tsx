// This example is for an Editor with `ReactEditor` and `HistoryEditor`
import { useMakeStandardAutosuggestionFunction } from "../../hooks/make-autosuggestions-function/use-make-standard-autosuggestions-function";
import { BaseCopilotTextareaProps } from "../../types/base/base-copilot-textarea-props";
import {
  AutosuggestionsConfig,
  defaultAutosuggestionsConfig,
} from "../../types/standard-autosuggestions";
import { BaseCopilotTextarea } from "../base-copilot-textarea/base-copilot-textarea";

export interface CopilotTextareaProps extends BaseCopilotTextareaProps {
  autosuggestionsConfig: Partial<AutosuggestionsConfig> & {
    purposePrompt: string;
  };
}

export function CopilotTextarea(props: CopilotTextareaProps): JSX.Element {
  const autosuggestionsConfig: AutosuggestionsConfig = {
    ...defaultAutosuggestionsConfig,
    ...props.autosuggestionsConfig,
  };

  const autosuggestionsFunction = useMakeStandardAutosuggestionFunction(
    autosuggestionsConfig.purposePrompt,
    autosuggestionsConfig.apiEndpoint,
    autosuggestionsConfig.makeSystemPrompt,
    autosuggestionsConfig.fewShotMessages,
    autosuggestionsConfig.externalContextCategories,
    autosuggestionsConfig.forwardedParams
  );

  return (
    <BaseCopilotTextarea
      {...props}
      autosuggestionsConfig={autosuggestionsConfig}
      autosuggestionsFunction={autosuggestionsFunction}
    />
  );
}
