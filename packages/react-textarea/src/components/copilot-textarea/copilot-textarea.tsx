// This example is for an Editor with `ReactEditor` and `HistoryEditor`
import { useMakeAutosuggestionFunction as useMakeStandardAutosuggestionFunction } from "../../hooks";
import {
  AutosuggestionsConfig,
  defaultAutosuggestionsConfig,
} from "../../types/autosuggestions-config";
import {
  BaseCopilotTextarea,
  BaseCopilotTextareaProps,
} from "./base-copilot-textarea/base-copilot-textarea";

export interface CopilotTextareaProps extends BaseCopilotTextareaProps {
  autosuggestionsConfig: Partial<AutosuggestionsConfig>;
}

export function CopilotTextarea(props: CopilotTextareaProps): JSX.Element {
  const autosuggestionsConfig: AutosuggestionsConfig = {
    ...defaultAutosuggestionsConfig,
    ...props.autosuggestionsConfig,
  };

  const autosuggestionsFunction = useMakeStandardAutosuggestionFunction(
    autosuggestionsConfig.textareaPurpose,
    autosuggestionsConfig.apiEndpoint,
    autosuggestionsConfig.makeSystemMessage,
    autosuggestionsConfig.fewShotMessages,
    autosuggestionsConfig.contextCategories
  );

  return (
    <BaseCopilotTextarea
      {...props}
      autosuggestionsConfig={autosuggestionsConfig}
      autosuggestionsFunction={autosuggestionsFunction}
    />
  );
}
