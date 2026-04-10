import type { BaseAutosuggestionsConfig } from "../base";
import { defaultBaseAutosuggestionsConfig } from "../base";
import type { SuggestionsApiConfig } from "./suggestions-api-config";
import { defaultSuggestionsApiConfig } from "./suggestions-api-config";
import type { InsertionsApiConfig } from "./insertions-api-config";
import { defaultInsertionsApiConfig } from "./insertions-api-config";
import type { EditingApiConfig } from "./editing-api-config";
import { defaultEditingApiConfig } from "./editing-api-config";
import { defaultCopilotContextCategories } from "@copilotkit/react-core";

// Like the base autosuggestions config, with 2 additional fields:
// 1. contextCategories: string[] | undefined;
// 2. instead of apiConfigs, we have chatApiConfigs: a higher-level abstraction that uses a ChatGPT-like API endpoint.
export interface AutosuggestionsConfig extends Omit<
  BaseAutosuggestionsConfig,
  "apiConfig"
> {
  contextCategories: string[];
  chatApiConfigs: {
    suggestionsApiConfig: SuggestionsApiConfig;
    insertionApiConfig: InsertionsApiConfig;
    editingApiConfig: EditingApiConfig;
  };
}

export const defaultAutosuggestionsConfig: Omit<
  AutosuggestionsConfig,
  "textareaPurpose" | "apiEndpoint"
> = {
  ...defaultBaseAutosuggestionsConfig,
  contextCategories: defaultCopilotContextCategories,
  chatApiConfigs: {
    suggestionsApiConfig: defaultSuggestionsApiConfig,
    insertionApiConfig: defaultInsertionsApiConfig,
    editingApiConfig: defaultEditingApiConfig,
  },
};
